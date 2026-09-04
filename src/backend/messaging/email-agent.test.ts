import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockListThreads, mockGetThreadMessages, mockSendEmail, mockOfferSlots } = vi.hoisted(() => ({
  mockListThreads: vi.fn(),
  mockGetThreadMessages: vi.fn(),
  mockSendEmail: vi.fn(),
  mockOfferSlots: vi.fn(),
}));

vi.mock("../integrations/composio-gmail", () => ({
  getConnection: vi.fn().mockResolvedValue("conn-1"),
  listThreads: mockListThreads,
  getThreadMessages: mockGetThreadMessages,
  sendEmail: mockSendEmail,
}));

vi.mock("./conversational-ai", () => ({
  generateReply: vi.fn().mockResolvedValue({ reply: "Thanks for reaching out, I'll get back to you shortly.", usedRag: false }),
}));

vi.mock("../calendar/booking", () => ({
  offerSlots: mockOfferSlots,
}));

import { replyToThread, pollAndReply } from "./email-agent";
import type { Db } from "./types";

const TENANT = "tenant-1";
const THREAD = "thread-1";

function makeThreadMessage(overrides: { body: string; from?: string; id?: string }): Record<string, unknown> {
  return {
    id: overrides.id ?? "msg-customer",
    threadId: THREAD,
    from: overrides.from ?? "lead@example.com",
    to: "sales@example.com",
    subject: "Hello",
    body: overrides.body,
  };
}

// ── Mock DB (fluent drizzle-shaped, table-routed) ──

type RowRecord = Record<string, unknown>;

function tableKey(table: unknown): string {
  if (typeof table === "string") return table;
  const t = table as Record<symbol, unknown> & { name?: unknown };
  const sym = t[Symbol.for("drizzle:Name")];
  if (typeof sym === "string") return sym;
  if (typeof t.name === "string") return t.name;
  return String(table);
}

interface MockDb {
  state: Record<string, RowRecord[]>;
  calls: Array<{ op: string; table: string }>;
}

function createMockDb(seed: Record<string, RowRecord[]> = {}) {
  const tables = ["leads", "client_leads", "messages", "inbox_events", "inbound_messages", "consent"] as const;
  const state: Record<string, RowRecord[]> = {};
  for (const t of tables) state[t] = [...(seed[t] ?? [])].map((r) => ({ ...r }));
  const calls: Array<{ op: string; table: string }> = [];

  const db: MockDb = {
    state,
    calls,
  };

  (db as unknown as Record<string, unknown>).select = () => ({
    from: (t: unknown) => {
      const key = tableKey(t);
      calls.push({ op: "select", table: key });
      const row = state[key];
      const promise = Promise.resolve([...(row ?? [])]) as Promise<RowRecord[]> & Record<string, unknown>;
      promise.where = () => promise;
      promise.orderBy = () => promise;
      promise.limit = async () => [...(row ?? [])];
      return promise;
    },
  });

  (db as unknown as Record<string, unknown>).insert = (t: unknown) => {
    const key = tableKey(t);
    calls.push({ op: "insert", table: key });
    return {
      values: (valuesRow: RowRecord) => {
        const hasConflict =
          key === "inbox_events" &&
          state[key].some(
            (r) =>
              r.source === valuesRow.source &&
              r.externalId === valuesRow.externalId &&
              r.tenantId === valuesRow.tenantId,
          );
        if (!hasConflict) state[key].push({ ...valuesRow });
        const returning = async () =>
          key === "inbox_events" && hasConflict ? [] : [{ id: "id-1" }];
        return {
          onConflictDoNothing: () => ({ returning }),
          returning,
        };
      },
    };
  };

  (db as unknown as Record<string, unknown>).update = (t: unknown) => {
    const key = tableKey(t);
    calls.push({ op: "update", table: key });
    return {
      set: (values: RowRecord) => ({
        where: async () => {
          for (const r of state[key]) Object.assign(r, values);
        },
      }),
    };
  };

  return db as unknown as Db & { state: Record<string, RowRecord[]>; calls: Array<{ op: string; table: string }> };
}

beforeEach(() => {
  mockListThreads.mockReset();
  mockGetThreadMessages.mockReset();
  mockSendEmail.mockReset();
  mockOfferSlots.mockReset();
  mockGetThreadMessages.mockResolvedValue([
    makeThreadMessage({ body: "I am interested in learning more" }),
  ]);
  mockSendEmail.mockResolvedValue({ id: "sent-default", threadId: THREAD });
  mockOfferSlots.mockResolvedValue([]);
});

describe("replyToThread", () => {
  it("generates and sends a reply for an interested lead", async () => {
    const db = createMockDb({
      leads: [{ id: "lead-1", email: "lead@example.com", firstName: "Aisha", dnc: 0 }],
      client_leads: [{ id: "cl-1", leadId: "lead-1", clientId: TENANT, status: "new" }],
    });
    mockOfferSlots.mockResolvedValue([]);
    mockSendEmail.mockResolvedValue({ id: "sent-1", threadId: THREAD });

    const result = await replyToThread(db as never, TENANT, THREAD);

    expect(result).toMatchObject({ threadId: THREAD, intent: "interested", replied: true });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const sendArgs = mockSendEmail.mock.calls[0][1];
    expect(sendArgs.to).toBe("lead@example.com");
    expect(sendArgs.inReplyToThreadId).toBe(THREAD);
    expect(sendArgs.body).toMatch(/Thanks for your interest/);

    const outbound = db.state.messages.find((m) => m.direction === "outbound");
    expect(outbound).toBeDefined();
    expect(outbound).toMatchObject({ leadId: "lead-1", clientId: TENANT, channel: "gmail" });
  });

  it("offers calendar slots for a meeting_request and replies", async () => {
    const db = createMockDb({
      leads: [{ id: "lead-1", email: "lead@example.com", firstName: "Ravi", dnc: 0 }],
      client_leads: [{ id: "cl-1", leadId: "lead-1", clientId: TENANT, status: "new" }],
    });
    mockGetThreadMessages.mockResolvedValue([
      makeThreadMessage({ body: "Can we schedule a meeting next week?" }),
    ]);
    mockOfferSlots.mockResolvedValue([
      { start: new Date("2026-09-08T04:00:00.000Z"), end: new Date("2026-09-08T04:30:00.000Z") },
    ]);
    mockSendEmail.mockResolvedValue({ id: "sent-2", threadId: THREAD });

    const result = await replyToThread(db as never, TENANT, THREAD);

    expect(result?.intent).toBe("meeting_request");
    expect(result?.replied).toBe(true);
    expect(mockOfferSlots).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][1].body).toMatch(/available time slots/);
  });

  it("flags a do-not-contact lead without sending a reply", async () => {
    const db = createMockDb({
      leads: [{ id: "lead-1", email: "lead@example.com", firstName: "Sam", dnc: 0 }],
      client_leads: [{ id: "cl-1", leadId: "lead-1", clientId: TENANT, status: "contacted" }],
    });
    mockGetThreadMessages.mockResolvedValue([makeThreadMessage({ body: "please stop contacting me" })]);
    const result = await replyToThread(db as never, TENANT,
THREAD);

    expect(result?.intent).toBe("dnc");
    expect(result?.replied).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(db.state.leads[0].dnc).toBe(1);
    expect(db.state.client_leads[0].status).toBe("dnc");
  });

  it("skips threads that were already processed (dedupe)", async () => {
    const db = createMockDb({
      leads: [{ id: "lead-1", email: "lead@example.com", firstName: "Aisha", dnc: 0 }],
      client_leads: [{ id: "cl-1", leadId: "lead-1", clientId: TENANT, status: "new" }],
    });
    mockOfferSlots.mockResolvedValue([]);
    mockSendEmail.mockResolvedValue({ id: "sent-1", threadId: THREAD });
    await replyToThread(db as never, TENANT, THREAD);
    const second = await replyToThread(db as never, TENANT, THREAD);

    expect(second?.replied).toBe(false);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });
});

describe("pollAndReply", () => {
  it("scans unread threads and replies to each", async () => {
    const db = createMockDb({
      leads: [{ id: "lead-1", email: "lead@example.com", firstName: "Aisha", dnc: 0 }],
      client_leads: [{ id: "cl-1", leadId: "lead-1", clientId: TENANT, status: "new" }],
    });
    mockListThreads.mockResolvedValue([{ id: THREAD }]);
    mockGetThreadMessages.mockResolvedValue([
      makeThreadMessage({ body: "I am interested, send me more info" }),
    ]);
    mockOfferSlots.mockResolvedValue([]);
    mockSendEmail.mockResolvedValue({ id: "sent-3", threadId: THREAD });

    const { replied, scanned } = await pollAndReply(db as never, TENANT, { query: "is:unread" });

    expect(scanned).toBe(1);
    expect(replied).toBe(1);
    expect(mockListThreads).toHaveBeenCalledWith(TENANT, "is:unread", 20);
  });
});