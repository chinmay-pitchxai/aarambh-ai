import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDb, mockSelectReturning } from "../../test-utils/mocks";

const { mockExecute } = vi.hoisted(() => ({ mockExecute: vi.fn() }));

vi.mock("../integrations/composio2", () => ({
  composio2Service: {
    getClient: () => ({ tools: { execute: mockExecute } }),
    resolveConnectedAccount: async () => null,
  },
}));

vi.mock("../db", async () => {
  const { mockDb, mockSchema } = await import("../../test-utils/mocks");
  return { db: mockDb, schema: mockSchema };
});

import {
  createMeeting,
  getUpcomingMeetings,
  getAvailableSlots,
  cancelMeeting,
  toNaiveLocalISO,
} from "./calendar-composio";

const TENANT = "tenant-1";
const ACCOUNT_ID = "ca_test123";

function mockActiveConnection() {
  mockSelectReturning([{ composioConnectionId: ACCOUNT_ID }]);
}

function lastExecuteArgs(): { slug: string; body: Record<string, unknown> } {
  const call = mockExecute.mock.calls[mockExecute.mock.calls.length - 1] as [
    string,
    Record<string, unknown>,
  ];
  return { slug: call[0], body: call[1] };
}

function toolArgs(): Record<string, unknown> {
  return lastExecuteArgs().body["arguments"] as Record<string, unknown>;
}

beforeEach(() => {
  mockExecute.mockReset();
  mockActiveConnection();
});

describe("toNaiveLocalISO", () => {
  it("formats a UTC instant as naive wall time in the given timezone", () => {
    // 04:30 UTC == 10:00 IST (Asia/Kolkata, fixed +05:30, no DST).
    expect(toNaiveLocalISO(new Date("2026-09-04T04:30:00.000Z"), "Asia/Kolkata")).toBe(
      "2026-09-04T10:00:00"
    );
  });
});

describe("createMeeting", () => {
  const input = {
    title: "Demo call",
    start: new Date("2026-09-04T04:30:00.000Z"), // 10:00 IST
    end: new Date("2026-09-04T05:00:00.000Z"), // 10:30 IST
    attendees: ["lead@example.com"],
    description: "Intro call",
  };

  it("maps args to GOOGLECALENDAR_CREATE_EVENT (start_datetime/timezone/calendar_id)", async () => {
    mockExecute.mockResolvedValue({
      successful: true,
      data: { response_data: { id: "evt_123", htmlLink: "https://cal.example/e/evt_123" } },
    });

    const event = await createMeeting(TENANT, input);

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const { slug, body } = lastExecuteArgs();
    expect(slug).toBe("GOOGLECALENDAR_CREATE_EVENT");
    expect(body["connectedAccountId"]).toBe(ACCOUNT_ID);
    expect(body["dangerouslySkipVersionCheck"]).toBe(true);
    expect(toolArgs()).toMatchObject({
      summary: "Demo call",
      start_datetime: "2026-09-04T10:00:00",
      timezone: "Asia/Kolkata",
      calendar_id: "primary",
      event_duration_minutes: 30,
      create_meeting_room: true,
    });
    expect(toolArgs()["attendees"]).toEqual(["lead@example.com"]);
    expect(event.id).toBe("evt_123");
    expect(event.htmlLink).toBe("https://cal.example/e/evt_123");
  });

  it("defaults the timezone to Asia/Kolkata when none is given", async () => {
    mockExecute.mockResolvedValue({ successful: true, data: { id: "evt_1" } });
    const { title, start, end, attendees, description } = input;
    await createMeeting(TENANT, { title, start, end, attendees, description });
    expect(toolArgs()["timezone"]).toBe("Asia/Kolkata");
  });

  it("parses a JSON-string data payload with nested response_data", async () => {
    mockExecute.mockResolvedValue({
      successful: true,
      data: JSON.stringify({
        response_data: { id: "evt_9", htmlLink: "https://cal.example/e/evt_9" },
      }),
    });

    const event = await createMeeting(TENANT, input);
    expect(event.id).toBe("evt_9");
    expect(event.htmlLink).toBe("https://cal.example/e/evt_9");
    // Attendees/description fall back to the input when the response omits them.
    expect(event.attendees).toEqual(["lead@example.com"]);
    expect(event.description).toBe("Intro call");
  });

  it("throws a clear error naming the missing connection", async () => {
    mockSelectReturning([]);
    await expect(createMeeting(TENANT, input)).rejects.toThrow(/not connected/i);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("rejects an end-before-start window", async () => {
    await expect(
      createMeeting(TENANT, { ...input, end: new Date("2026-09-04T04:00:00.000Z") })
    ).rejects.toThrow(/end must be after start/i);
  });
});

describe("getUpcomingMeetings", () => {
  it("queries GOOGLECALENDAR_EVENTS_LIST and maps Google event resources", async () => {
    mockExecute.mockResolvedValue({
      successful: true,
      data: {
        response_data: {
          items: [
            {
              id: "e1",
              summary: "Standup",
              start: { dateTime: "2026-09-04T10:00:00+05:30" },
              end: { dateTime: "2026-09-04T10:30:00+05:30" },
              attendees: [{ email: "a@example.com" }, "b@example.com"],
              htmlLink: "https://cal.example/e/e1",
              status: "confirmed",
            },
          ],
        },
      },
    });

    const meetings = await getUpcomingMeetings(TENANT);

    const { slug } = lastExecuteArgs();
    expect(slug).toBe("GOOGLECALENDAR_EVENTS_LIST");
    expect(toolArgs()).toMatchObject({
      calendarId: "primary",
      singleEvents: true,
      orderBy: "startTime",
    });
    expect(typeof toolArgs()["timeMin"]).toBe("string");
    expect(typeof toolArgs()["timeMax"]).toBe("string");
    expect(meetings).toHaveLength(1);
    expect(meetings[0]).toMatchObject({
      id: "e1",
      title: "Standup",
      attendees: ["a@example.com", "b@example.com"],
      htmlLink: "https://cal.example/e/e1",
      status: "confirmed",
    });
    expect(meetings[0].start.toISOString()).toBe("2026-09-04T04:30:00.000Z");
  });

  it("parses a JSON-string list payload defensively", async () => {
    mockExecute.mockResolvedValue({
      successful: true,
      data: JSON.stringify({
        response_data: {
          items: [
            {
              id: "e2",
              summary: "Sync",
              start: { dateTime: "2026-09-05T10:00:00+05:30" },
              end: { dateTime: "2026-09-05T10:30:00+05:30" },
            },
          ],
        },
      }),
    });

    const meetings = await getUpcomingMeetings(TENANT);
    expect(meetings).toHaveLength(1);
    expect(meetings[0].id).toBe("e2");
  });

  it("skips malformed entries instead of crashing", async () => {
    mockExecute.mockResolvedValue({
      successful: true,
      data: { items: [{ id: "bad" }, null, "nope"] },
    });
    await expect(getUpcomingMeetings(TENANT)).resolves.toEqual([]);
  });
});

describe("getAvailableSlots", () => {
  const friday = new Date("2026-09-04"); // Friday
  const busyEvent = {
    id: "busy1",
    summary: "Busy",
    start: { dateTime: "2026-09-04T10:00:00+05:30" },
    end: { dateTime: "2026-09-04T10:30:00+05:30" },
  };

  it("computes free 9–18 IST slots around busy events", async () => {
    mockExecute.mockResolvedValue({ successful: true, data: { items: [busyEvent] } });

    const slots = await getAvailableSlots(TENANT, friday, 30);

    // 18 half-hour slots in 9:00–18:00 IST minus the one overlapping 10:00–10:30.
    expect(slots).toHaveLength(17);
    const starts = slots.map((s) => s.start.toISOString());
    expect(starts).not.toContain("2026-09-04T04:30:00.000Z"); // 10:00 IST — busy
    expect(starts).toContain("2026-09-04T04:00:00.000Z"); // 09:30 IST — free
    expect(starts).toContain("2026-09-04T05:00:00.000Z"); // 10:30 IST — free
    expect(starts[0]).toBe("2026-09-04T03:30:00.000Z"); // 09:00 IST
  });

  it("returns every slot when the day is free", async () => {
    mockExecute.mockResolvedValue({ successful: true, data: { items: [] } });
    const slots = await getAvailableSlots(TENANT, friday, 30);
    expect(slots).toHaveLength(18);
  });

  it("skips weekends without calling Composio", async () => {
    const saturday = new Date("2026-09-05");
    await expect(getAvailableSlots(TENANT, saturday, 30)).resolves.toEqual([]);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("treats all-day events as whole-day busy", async () => {
    mockExecute.mockResolvedValue({
      successful: true,
      data: { items: [{ id: "ooo", summary: "OOO", start: { date: "2026-09-04" }, end: { date: "2026-09-05" } }] },
    });
    await expect(getAvailableSlots(TENANT, friday, 30)).resolves.toEqual([]);
  });
});

describe("cancelMeeting", () => {
  it("calls GOOGLECALENDAR_DELETE_EVENT with event_id + calendar_id", async () => {
    mockExecute.mockResolvedValue({ successful: true, data: {} });
    await expect(cancelMeeting(TENANT, "evt_123")).resolves.toEqual({ success: true });
    const { slug } = lastExecuteArgs();
    expect(slug).toBe("GOOGLECALENDAR_DELETE_EVENT");
    expect(toolArgs()).toMatchObject({ event_id: "evt_123", calendar_id: "primary" });
  });

  it("throws a clear error when the calendar is not connected", async () => {
    mockSelectReturning([]);
    await expect(cancelMeeting(TENANT, "evt_123")).rejects.toThrow(/not connected/i);
  });
});

describe("db wiring", () => {
  it("looks up the active google_calendar connection", async () => {
    mockExecute.mockResolvedValue({ successful: true, data: { items: [] } });
    await getUpcomingMeetings(TENANT);
    expect(mockDb.select).toHaveBeenCalled();
  });
});
