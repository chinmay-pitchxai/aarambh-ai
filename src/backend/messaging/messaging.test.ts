import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { detectIntent } from "./intent";
import { processInboundMessage } from "./inbound";
import { recordInboxEvent } from "./webhook-security";
import { handleWhatsAppWebhook } from "./whatsapp";
import { sendWhatsApp } from "./service";
import type { Db } from "./types";

// Never touch the real dialer during tests.
vi.mock("../agents/booking-confirmer", () => ({
  confirmBooking: vi.fn().mockResolvedValue({ booked: true }),
}));

// ── Mock DB (fluent drizzle-shaped, table-routed, conflict-aware) ──

type Row = Record<string, unknown>;

const TABLES = [
  "leads",
  "client_leads",
  "consent",
  "retry_queue",
  "messages",
  "inbound_messages",
  "webhook_events",
  "inbox_events",
  "queue_jobs",
] as const;

function tableKey(table: unknown): string {
  if (typeof table === "string") return table;
  const t = table as Record<symbol, unknown> & { name?: unknown };
  const sym = t[Symbol.for("drizzle:Name")];
  if (typeof sym === "string") return sym;
  if (typeof t.name === "string") return t.name;
  return String(table);
}

interface MockDb {
  state: Record<string, Row[]>;
  calls: Array<{ op: string; table: string }>;
  select: (table: unknown) => { from: (t: unknown) => unknown };
  insert: (table: unknown) => unknown;
  update: (table: unknown) => unknown;
}

function createMockDb(seed: Record<string, Row[]> = {}): MockDb {
  const state: Record<string, Row[]> = {};
  for (const t of TABLES) state[t] = [...(seed[t] ?? [])].map((r) => ({ ...r }));
  const calls: Array<{ op: string; table: string }> = [];
  let seq = 0;

  function conflict(table: string, row: Row): boolean {
    if (table === "inbox_events") {
      return state.inbox_events.some(
        (r) => r.source === row.source && r.externalId === row.externalId && r.tenantId === row.tenantId,
      );
    }
    if (table === "messages") {
      return state.messages.some(
        (r) => r.idempotencyKey != null && r.idempotencyKey === row.idempotencyKey,
      );
    }
    if (table === "consent") {
      return state.consent.some((r) => r.leadId === row.leadId && r.clientId === row.clientId);
    }
    return false;
  }

  function selectBuilder(table: string) {
    const p = Promise.resolve(state[table].slice()) as Promise<Row[]> & Record<string, unknown>;
    p.where = () => p;
    p.orderBy = () => p;
    p.limit = async (n?: number) => state[table].slice(0, n);
    p.get = async () => state[table][0] ?? null;
    return p;
  }

  const db: MockDb = {
    state,
    calls,
    select: () => ({
      from: (t: unknown) => {
        const key = tableKey(t);
        calls.push({ op: "select", table: key });
        return selectBuilder(key);
      },
    }),
    insert: (table: unknown) => {
      const key = tableKey(table);
      calls.push({ op: "insert", table: key });
      return {
        values: (row: Row) => {
          const normalized: Row = { ...row };
          if (!normalized.id) normalized.id = `id-${seq++}`;
          const hasConflict = conflict(key, normalized);
          if (!hasConflict) state[key].push(normalized);
          const returning = async () => (hasConflict ? [] : [normalized]);
          const chain: Record<string, unknown> = {
            onConflictDoNothing: () => ({ returning }),
            returning,
          };
          return Object.assign(Promise.resolve(normalized), chain);
        },
      };
    },
    update: (table: unknown) => {
      const key = tableKey(table);
      calls.push({ op: "update", table: key });
      return {
        set: (values: Row) => ({
          where: async () => {
            for (const r of state[key]) Object.assign(r, values);
          },
        }),
      };
    },
  };

  return db;
}

const asDb = (mock: MockDb): Db => mock as unknown as Db;

// ── Env guard: keep provider API calls on the stub path ──

const ORIGINAL_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ["WHATSAPP_PHONE_ID", "WHATSAPP_API_TOKEN", "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"]) {
    ORIGINAL_ENV[key] = process.env[key];
    process.env[key] = "";
  }
});

afterEach(() => {
  for (const key of Object.keys(ORIGINAL_ENV)) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
});

// ── Tests ──

describe("detectIntent", () => {
  it("detects interest keywords", () => {
    expect(detectIntent("I am interested, best time to call is noon")).toBe("interested");
    expect(detectIntent("What is the pricing for your product?")).toBe("interested");
    expect(detectIntent("Can we schedule a meeting?")).toBe("meeting_request");
    expect(detectIntent("Please send a demo")).toBe("interested");
  });

  it("detects DNC / opt-out keywords", () => {
    expect(detectIntent("stop")).toBe("dnc");
    expect(detectIntent("Please stop contacting me")).toBe("dnc");
    expect(detectIntent("I am not interested, do not call me")).toBe("dnc");
    expect(detectIntent("unsubscribe")).toBe("dnc");
    expect(detectIntent("Add me to your DNC list")).toBe("dnc");
    expect(detectIntent("opt out")).toBe("dnc");
  });

  it("treats ambiguous or empty text as neutral", () => {
    expect(detectIntent("Hello")).toBe("neutral");
    expect(detectIntent("")).toBe("neutral");
    expect(detectIntent("Thanks, will think about it")).toBe("neutral");
  });

  it("gives DNC priority over interest keywords", () => {
    expect(detectIntent("I'm not interested even though the pricing is nice")).toBe("dnc");
    expect(detectIntent("interested but please stop calling")).toBe("dnc");
  });
});

describe("processInboundMessage", () => {
  it("opt-out updates consent, flags the lead DNC and cancels pending outreach", async () => {
    const mock = createMockDb({
      leads: [{ id: "lead-1", phoneE164: "+919999999999", dnc: 0 }],
      client_leads: [{ id: "cl-1", leadId: "lead-1", clientId: "client-1", status: "contacted", nextRetryAt: new Date() }],
      retry_queue: [{ id: "retry-1", leadId: "lead-1", clientId: "client-1", status: "pending" }],
      queue_jobs: [{ id: "job-1", tenantId: "client-1", queue: "inbound", jobType: "booking.confirm", payload: { leadId: "lead-1" }, status: "pending" }],
    });
    const db = asDb(mock);

    const result = await processInboundMessage(db, {
      channel: "whatsapp",
      message: { messageId: "wa-msg-1", leadId: "lead-1", clientId: "client-1", body: "Please stop contacting me" },
    });

    expect(result.intent).toBe("dnc");
    expect(result.action).toBe("dnc");

    expect(mock.state.consent[0]).toMatchObject({
      leadId: "lead-1",
      clientId: "client-1",
      status: "opted_out",
      source: "inbound_message",
    });
    expect(mock.state.leads[0].dnc).toBe(1);
    expect(mock.state.client_leads[0].status).toBe("dnc");
    expect(mock.state.client_leads[0].nextRetryAt).toBeNull();
    expect(mock.state.retry_queue[0].status).toBe("cancelled");
    expect(mock.state.queue_jobs[0].status).toBe("cancelled");
    expect(mock.state.inbound_messages).toHaveLength(1);
    expect(mock.state.inbound_messages[0].detectedInterest).toBe(false);
  });

  it("persists neutral messages without changing lead status", async () => {
    const mock = createMockDb({
      leads: [{ id: "lead-1", phoneE164: "+919999999999", dnc: 0 }],
      client_leads: [{ id: "cl-1", leadId: "lead-1", clientId: "client-1", status: "contacted" }],
    });
    const db = asDb(mock);

    const result = await processInboundMessage(db, {
      channel: "whatsapp",
      message: { messageId: "wa-2", leadId: "lead-1", clientId: "client-1", body: "Ok thanks" },
    });

    expect(result.intent).toBe("neutral");
    expect(mock.state.inbound_messages).toHaveLength(1);
    expect(mock.state.client_leads[0].status).toBe("contacted");
    expect(mock.state.leads[0].dnc).toBe(0);
  });
});

describe("webhook deduplication", () => {
  it("dedupes duplicate events by source + externalId", async () => {
    const mock = createMockDb();
    const db = asDb(mock);

    const first = await recordInboxEvent(db, {
      tenantId: "tenant-1",
      source: "whatsapp",
      externalId: "wa-msg-123",
      eventType: "message.inbound",
      payload: {},
    });
    const second = await recordInboxEvent(db, {
      tenantId: "tenant-1",
      source: "whatsapp",
      externalId: "wa-msg-123",
      eventType: "message.inbound",
      payload: {},
    });
    const different = await recordInboxEvent(db, {
      tenantId: "tenant-1",
      source: "whatsapp",
      externalId: "wa-msg-456",
      eventType: "message.inbound",
      payload: {},
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(different).toBe(true);
    expect(mock.state.inbox_events).toHaveLength(2);
  });

  it("dedupes inbound WhatsApp messages by provider message id", async () => {
    const mock = createMockDb({
      leads: [{ id: "lead-1", phoneE164: "+919999999999", dnc: 0 }],
      client_leads: [{ id: "cl-1", leadId: "lead-1", clientId: "client-1", status: "new" }],
    });
    const db = asDb(mock);

    const body = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "entry-1",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                messages: [
                  {
                    id: "wa-msg-1",
                    from: "+919999999999",
                    timestamp: "1725200000",
                    type: "text",
                    text: { body: "I am interested in a demo" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const first = await handleWhatsAppWebhook(db, body);
    expect(first.processed).toBe(1);
    expect(first.duplicates).toBe(0);
    expect(mock.state.messages.length).toBeGreaterThanOrEqual(1);
    expect(mock.state.messages[0]).toMatchObject({
      leadId: "lead-1",
      clientId: "client-1",
      channel: "whatsapp",
      direction: "inbound",
      waMessageId: "wa-msg-1",
    });

    const second = await handleWhatsAppWebhook(db, body);
    expect(second.processed).toBe(0);
    expect(second.duplicates).toBe(1);
  });
});

describe("sendWhatsApp", () => {
  it("is idempotent by idempotency key and rejects unapproved templates", async () => {
    const mock = createMockDb({
      leads: [{ id: "lead-1", phoneE164: "+919999999999", dnc: 0 }],
      client_leads: [{ id: "cl-1", leadId: "lead-1", clientId: "client-1", status: "new" }],
    });
    const db = asDb(mock);

    const input = {
      tenantId: "client-1",
      to: "+919999999999",
      templateName: "info_send_v1",
      params: ["there", "Acme"],
      leadId: "lead-1",
      clientId: "client-1",
      idempotencyKey: "wa:fixed-key",
    };

    const first = await sendWhatsApp(db, input);
    expect(first.ok).toBe(true);
    expect(first.idempotent).toBeUndefined();
    expect(mock.state.messages).toHaveLength(1);

    const second = await sendWhatsApp(db, input);
    expect(second.ok).toBe(true);
    expect(second.idempotent).toBe(true);
    expect(mock.state.messages).toHaveLength(1);
  });

  it("throws for template names outside the approved list", async () => {
    const mock = createMockDb();
    const db = asDb(mock);

    await expect(
      sendWhatsApp(db, {
        tenantId: "client-1",
        to: "+919999999999",
        templateName: "promo_discount_2026",
        params: [],
        leadId: "lead-1",
        clientId: "client-1",
      }),
    ).rejects.toThrow(/not approved/);
  });
});
