/**
 * End-to-end API test suite for AarambhAI.
 *
 * Tests the complete flow: auth → onboarding → chat → leads → notifications
 * → calendar → meetings. Uses mocked DB via test-utils/setup.ts.
 *
 * Run: npx vitest run src/backend/services/e2e-test.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockDb,
  mockCookieStore,
  mockInsertResolving,
  mockSelectReturning,
  mockSelectSequential,
  mockUpdateResolving,
  mockDeleteResolving,
} from "@/test-utils/mocks";
import { mockUsers, mockLeads, mockOrgs } from "@/test-utils/fixtures";

// ── Re-mock next/server to return proper NextResponse-like objects ──
vi.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    body: unknown;
    constructor(body: unknown, init?: { status?: number }) {
      this.status = init?.status ?? 200;
      this.body = body;
    }
    static json(body: unknown, init?: { status?: number }) {
      return { status: init?.status ?? 200, body };
    }
  }

  return { NextResponse: MockNextResponse };
});

// ── Helpers ──
function jsonBody(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object" && "body" in result) {
    return (result as { body: Record<string, unknown> }).body;
  }
  return result as Record<string, unknown>;
}

function jsonStatus(result: unknown): number {
  if (result && typeof result === "object" && "status" in result) {
    return (result as { status: number }).status;
  }
  return 200;
}

function makeRequest(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }) as Request;
}

// Helper to call route handlers with mismatched types (test-only)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callHandler(handler: any, ...args: any[]): Promise<unknown> {
  return handler(...args);
}

// ── Shared session mock for authenticated routes ──
function setupAuthSession() {
  mockCookieStore.get.mockReturnValue({ value: "test-session-id" });
  mockDb.query.sessions.findFirst.mockResolvedValue({
    id: "test-session-id",
    userId: "user-1",
    activeOrganizationId: "org-1",
    tokenHash: "hash",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  mockDb.query.users.findFirst.mockResolvedValue(mockUsers[0]);
  mockDb.query.organizationMembers.findFirst.mockResolvedValue({
    organizationId: "org-1",
    userId: "user-1",
    role: "owner",
  });
  mockUpdateResolving();
}

// ═════════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ═════════════════════════════════════════════════════════════════════════════

describe("E2E: Auth Flow", () => {
  it("POST /api/auth/signup - validates email+password required", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");
    const req = makeRequest("POST", "http://localhost:3000/api/auth/signup", {
      email: "",
      password: "",
    });
    const result = await POST(req);
    expect(jsonStatus(result)).toBe(400);
    expect(jsonBody(result)).toHaveProperty("error");
  });

  it("POST /api/auth/signup - rejects short password", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");
    const req = makeRequest("POST", "http://localhost:3000/api/auth/signup", {
      email: "test@example.com",
      password: "short",
    });
    const result = await POST(req);
    expect(jsonStatus(result)).toBe(400);
  });

  it("POST /api/auth/signup - rejects invalid email", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");
    const req = makeRequest("POST", "http://localhost:3000/api/auth/signup", {
      email: "not-an-email",
      password: "validpassword",
    });
    const result = await POST(req);
    expect(jsonStatus(result)).toBe(400);
  });

  it("POST /api/auth/signup - rejects duplicate email", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");
    mockDb.query.users.findFirst.mockResolvedValue(mockUsers[0]);
    const req = makeRequest("POST", "http://localhost:3000/api/auth/signup", {
      email: "alice@acme.com",
      password: "validpassword123",
    });
    const result = await POST(req);
    expect(jsonStatus(result)).toBe(409);
  });

  it("POST /api/auth/login - validates email+password required", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    const req = makeRequest("POST", "http://localhost:3000/api/auth/login", {
      email: "",
      password: "",
    });
    const result = await POST(req);
    expect(jsonStatus(result)).toBe(400);
  });

  it("POST /api/auth/login - rejects wrong password", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    mockDb.query.users.findFirst.mockResolvedValue({
      ...mockUsers[0],
      passwordHash: "$2a$12$hashplaceholder1234567890",
    });
    const req = makeRequest("POST", "http://localhost:3000/api/auth/login", {
      email: "alice@acme.com",
      password: "wrongpassword",
    });
    const result = await POST(req);
    expect(jsonStatus(result)).toBe(401);
  });

  it("POST /api/auth/login - rejects nonexistent user", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    mockDb.query.users.findFirst.mockResolvedValue(undefined);
    const req = makeRequest("POST", "http://localhost:3000/api/auth/login", {
      email: "nobody@example.com",
      password: "password123",
    });
    const result = await POST(req);
    expect(jsonStatus(result)).toBe(401);
  });
});

describe("E2E: Onboarding Flow", () => {
  beforeEach(() => {
    setupAuthSession();
  });

  it("POST /api/v1/onboarding/submit - validates input", async () => {
    const { POST } = await import("@/app/api/v1/onboarding/submit/route");
    const req = makeRequest("POST", "http://localhost:3000/api/v1/onboarding/submit", {
      companyName: "",
      website: "",
    });
    const result = await POST(req);
    expect(jsonStatus(result)).toBe(400);
  });

  it("POST /api/v1/auto-onboard - validates companyName required", async () => {
    const { POST } = await import("@/app/api/v1/auto-onboard/route");
    const req = makeRequest("POST", "http://localhost:3000/api/v1/auto-onboard", {
      companyName: "",
      website: "https://acme.com",
    });
    const result = await callHandler(POST, req);
    expect(jsonStatus(result)).toBe(400);
  });

  it("POST /api/v1/auto-onboard - validates website required", async () => {
    const { POST } = await import("@/app/api/v1/auto-onboard/route");
    const req = makeRequest("POST", "http://localhost:3000/api/v1/auto-onboard", {
      companyName: "Acme Corp",
      website: "",
    });
    const result = await callHandler(POST, req);
    expect(jsonStatus(result)).toBe(400);
  });

  it("POST /api/v1/onboarding/confirm/[threadId] - requires auth", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    const { POST } = await import("@/app/api/v1/onboarding/confirm/[threadId]/route");
    const req = makeRequest("POST", "http://localhost:3000/api/v1/onboarding/confirm/test-thread");
    const result = await callHandler(POST, req, { params: { threadId: "test-thread" } });
    expect(jsonStatus(result)).toBe(401);
  });

  it("POST /api/v1/onboarding/complete/[threadId] - requires auth", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    const { POST } = await import("@/app/api/v1/onboarding/complete/[threadId]/route");
    const req = makeRequest("POST", "http://localhost:3000/api/v1/onboarding/complete/test-thread");
    const result = await callHandler(POST, req, { params: { threadId: "test-thread" } });
    expect(jsonStatus(result)).toBe(401);
  });
});

describe("E2E: Notifications Flow", () => {
  beforeEach(() => {
    setupAuthSession();
  });

  it("GET /api/v1/notifications - returns notifications list", async () => {
    // The route runs 3 parallel queries via Promise.all; mockSelectReturning
    // returns the same result for every select().from().where()... chain.
    mockSelectReturning([{ id: "n1", type: "hot_lead", title: "Hot Lead", read: false }]);
    // Also mock the count query shape that getUnreadCount expects
    mockDb.select.mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      const methods = [
        "from", "where", "limit", "offset", "orderBy", "returning",
        "values", "set", "onConflictDoUpdate", "innerJoin", "leftJoin",
      ];
      for (const m of methods) {
        chain[m] = vi.fn(() => chain);
      }
      // Make terminal resolve to an array with a value property (for count queries)
      (chain as unknown as { then: (resolve: (v: unknown) => unknown) => unknown }).then = (
        resolve: (v: unknown) => unknown,
      ) => Promise.resolve([{ value: 1 }]).then(resolve);
      return chain;
    });
    const { GET } = await import("@/app/api/v1/notifications/route");
    const req = makeRequest("GET", "http://localhost:3000/api/v1/notifications");
    const result = await callHandler(GET, req);
    expect(jsonStatus(result)).toBe(200);
    const body = jsonBody(result);
    expect(body).toHaveProperty("notifications");
    expect(body).toHaveProperty("unreadCount");
  });

  it("GET /api/v1/notifications - requires auth", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    const { GET } = await import("@/app/api/v1/notifications/route");
    const req = makeRequest("GET", "http://localhost:3000/api/v1/notifications");
    const result = await callHandler(GET, req);
    expect(jsonStatus(result)).toBe(401);
  });

  it("GET /api/v1/notifications/unread - returns unread count", async () => {
    mockSelectReturning([{ value: 3 }]);
    const { GET } = await import("@/app/api/v1/notifications/unread/route");
    const req = makeRequest("GET", "http://localhost:3000/api/v1/notifications/unread");
    const result = await callHandler(GET, req);
    expect(jsonStatus(result)).toBe(200);
    expect(jsonBody(result)).toHaveProperty("unreadCount");
  });

  it("GET /api/v1/notifications/unread - requires auth", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    const { GET } = await import("@/app/api/v1/notifications/unread/route");
    const req = makeRequest("GET", "http://localhost:3000/api/v1/notifications/unread");
    const result = await callHandler(GET, req);
    expect(jsonStatus(result)).toBe(401);
  });

  it("PATCH /api/v1/notifications - validates action", async () => {
    const { PATCH } = await import("@/app/api/v1/notifications/route");
    const req = makeRequest("PATCH", "http://localhost:3000/api/v1/notifications", {
      action: "invalid",
    });
    const result = await callHandler(PATCH, req);
    expect(jsonStatus(result)).toBe(400);
  });

  it("PATCH /api/v1/notifications - mark_all_read", async () => {
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "n1" }, { id: "n2" }]),
        }),
      }),
    });
    const { PATCH } = await import("@/app/api/v1/notifications/route");
    const req = makeRequest("PATCH", "http://localhost:3000/api/v1/notifications", {
      action: "mark_all_read",
    });
    const result = await callHandler(PATCH, req);
    expect(jsonStatus(result)).toBe(200);
  });
});

describe("E2E: Calendar Flow", () => {
  beforeEach(() => {
    setupAuthSession();
  });

  it("GET /api/v1/calendar - requires auth", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    const { GET } = await import("@/app/api/v1/calendar/route");
    const req = makeRequest("GET", "http://localhost:3000/api/v1/calendar");
    const result = await callHandler(GET, req);
    expect(jsonStatus(result)).toBe(401);
  });

  it("GET /api/v1/calendar/slots - validates date param", async () => {
    const { GET } = await import("@/app/api/v1/calendar/slots/route");
    const req = makeRequest("GET", "http://localhost:3000/api/v1/calendar/slots");
    const result = await callHandler(GET, req);
    expect(jsonStatus(result)).toBe(400);
  });

  it("GET /api/v1/calendar/slots - requires auth", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    const { GET } = await import("@/app/api/v1/calendar/slots/route");
    const req = makeRequest("GET", "http://localhost:3000/api/v1/calendar/slots?date=2026-09-04");
    const result = await callHandler(GET, req);
    expect(jsonStatus(result)).toBe(401);
  });
});

describe("E2E: Meetings Flow", () => {
  beforeEach(() => {
    setupAuthSession();
  });

  it("GET /api/v1/meetings - returns meetings list", async () => {
    mockSelectReturning([]);
    const { GET } = await import("@/app/api/v1/meetings/route");
    const req = makeRequest("GET", "http://localhost:3000/api/v1/meetings");
    const result = await callHandler(GET, req);
    expect(jsonStatus(result)).toBe(200);
    expect(jsonBody(result)).toHaveProperty("meetings");
  });

  it("GET /api/v1/meetings - requires auth", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    const { GET } = await import("@/app/api/v1/meetings/route");
    const req = makeRequest("GET", "http://localhost:3000/api/v1/meetings");
    const result = await callHandler(GET, req);
    expect(jsonStatus(result)).toBe(401);
  });

  it("POST /api/v1/meetings - validates leadId required", async () => {
    const { POST } = await import("@/app/api/v1/meetings/route");
    const req = makeRequest("POST", "http://localhost:3000/api/v1/meetings", {
      startTime: "2026-09-04T10:00:00Z",
    });
    const result = await callHandler(POST, req);
    expect(jsonStatus(result)).toBe(400);
  });

  it("POST /api/v1/meetings - validates startTime required", async () => {
    const { POST } = await import("@/app/api/v1/meetings/route");
    const req = makeRequest("POST", "http://localhost:3000/api/v1/meetings", {
      leadId: "lead-1",
    });
    const result = await callHandler(POST, req);
    expect(jsonStatus(result)).toBe(400);
  });

  it("GET /api/v1/meetings/available-slots - requires auth", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    const { GET } = await import("@/app/api/v1/meetings/available-slots/route");
    const req = makeRequest("GET", "http://localhost:3000/api/v1/meetings/available-slots");
    const result = await callHandler(GET, req);
    expect(jsonStatus(result)).toBe(401);
  });
});

describe("E2E: Leads Timeline Flow", () => {
  beforeEach(() => {
    setupAuthSession();
  });

  it("GET /api/v1/leads/[id]/timeline - requires auth", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    const { GET } = await import("@/app/api/v1/leads/[id]/timeline/route");
    const req = makeRequest("GET", "http://localhost:3000/api/v1/leads/lead-1/timeline");
    const result = await GET(req as import("next/server").NextRequest, {
      params: { id: "lead-1" },
    });
    expect(jsonStatus(result)).toBe(401);
  });
});

describe("E2E: Chat Flow", () => {
  beforeEach(() => {
    setupAuthSession();
  });

  it("POST /api/v1/chat - validates missing message", async () => {
    const { POST } = await import("@/app/api/v1/chat/route");
    const req = makeRequest("POST", "http://localhost:3000/api/v1/chat", {});
    const result = await callHandler(POST, req);
    expect(jsonStatus(result)).toBe(400);
  });

  it("POST /api/v1/chat - requires auth", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    const { POST } = await import("@/app/api/v1/chat/route");
    const req = makeRequest("POST", "http://localhost:3000/api/v1/chat", {
      message: "Hello",
    });
    const result = await callHandler(POST, req);
    expect(jsonStatus(result)).toBe(401);
  });

  it("GET /api/v1/chat/history - returns history", async () => {
    mockSelectReturning([
      { id: "msg-1", role: "user", content: "Hi", tenantId: "org-1", userId: "user-1", createdAt: new Date(), metadata: null },
    ]);
    const { GET } = await import("@/app/api/v1/chat/history/route");
    const req = makeRequest("GET", "http://localhost:3000/api/v1/chat/history?limit=50");
    const result = await callHandler(GET, req);
    expect(jsonStatus(result)).toBe(200);
    expect(jsonBody(result)).toHaveProperty("messages");
  });

  it("GET /api/v1/chat/history - requires auth", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    const { GET } = await import("@/app/api/v1/chat/history/route");
    const req = makeRequest("GET", "http://localhost:3000/api/v1/chat/history?limit=50");
    const result = await callHandler(GET, req);
    expect(jsonStatus(result)).toBe(401);
  });
});

describe("E2E: Leads API Flow", () => {
  beforeEach(() => {
    setupAuthSession();
  });

  it("GET /api/leads - returns leads list", async () => {
    mockSelectSequential([
      [{ id: "cl-1", leadId: "lead-1", score: 85, band: "hot", status: "new" }],
      [{ value: 1 }],
    ]);
    const { GET } = await import("@/app/api/leads/route");
    const req = makeRequest("GET", "http://localhost:3000/api/leads?page=1&limit=100");
    const result = await callHandler(GET, req);
    expect(jsonStatus(result)).toBe(200);
    const body = jsonBody(result);
    expect(body).toHaveProperty("leads");
    expect(body).toHaveProperty("total");
  });

  it("GET /api/leads - requires auth", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    const { GET } = await import("@/app/api/leads/route");
    const req = makeRequest("GET", "http://localhost:3000/api/leads?page=1&limit=100");
    const result = await callHandler(GET, req);
    expect(jsonStatus(result)).toBe(401);
  });

  it("GET /api/leads/[id] - returns lead detail", async () => {
    mockSelectSequential([
      [{ id: "cl-1", leadId: "lead-1", score: 85, band: "hot", status: "new", reusedFrom: null, assignedAt: new Date(), attemptCount: 0, lastCallAt: null }],
      [{ id: "lead-1", firstName: "Priya", lastName: "Sharma", email: "priya@acme.com", phoneE164: "+919800000001", company: "Acme", title: "VP Sales", city: "Bangalore", industry: "SaaS", companySize: "100", icpTags: [] }],
      [], // calls
      [], // messages
      [], // bookings
      [], // retries
    ]);
    const { GET } = await import("@/app/api/leads/[id]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/leads/lead-1");
    const result = await GET(req as import("next/server").NextRequest, {
      params: { id: "lead-1" },
    });
    expect(jsonStatus(result)).toBe(200);
    const body = jsonBody(result);
    expect(body).toHaveProperty("lead");
    expect(body).toHaveProperty("calls");
    expect(body).toHaveProperty("messages");
  });

  it("GET /api/leads/[id] - requires auth", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    const { GET } = await import("@/app/api/leads/[id]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/leads/lead-1");
    const result = await GET(req as import("next/server").NextRequest, {
      params: { id: "lead-1" },
    });
    expect(jsonStatus(result)).toBe(401);
  });
});

describe("E2E: Service Layer Integration", () => {
  it("notifications service: formatNotificationMessage returns strings", async () => {
    const { formatNotificationMessage } = await import("@/backend/services/notifications");

    expect(formatNotificationMessage("hot_lead", { leadName: "Priya", company: "Acme" })).toContain("Priya");
    expect(formatNotificationMessage("meeting_booked", { meetingTime: "2026-09-04T10:00:00Z" })).toContain("Meeting");
    expect(formatNotificationMessage("call_completed", { callOutcome: "booked", durationSec: 120 })).toContain("Call");
    expect(formatNotificationMessage("system", {})).toBeTruthy();
    expect(formatNotificationMessage("dnc", { leadName: "Bob" })).toContain("Do Not Contact");
  });

  it("notifications service: getNotifications returns shape", async () => {
    const { getNotifications } = await import("@/backend/services/notifications");
    mockSelectSequential([
      [{ id: "n1", type: "hot_lead", title: "Hot Lead" }],
      [{ value: 5 }],
    ]);
    const result = await getNotifications(mockDb as never, "org-1", "user-1");
    expect(result).toHaveProperty("notifications");
    expect(result).toHaveProperty("total");
  });
});

describe("E2E: Auth Middleware", () => {
  it("requireAuth returns 401 without session", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    const { requireAuth } = await import("@/backend/auth/middleware");
    const result = await requireAuth();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("requireAuth returns 403 for non-member", async () => {
    mockCookieStore.get.mockReturnValue({ value: "session-1" });
    mockDb.query.sessions.findFirst.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      activeOrganizationId: "org-1",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    mockDb.query.users.findFirst.mockResolvedValue(mockUsers[0]);
    mockDb.query.organizationMembers.findFirst.mockResolvedValue(undefined);
    mockUpdateResolving();

    const { requireAuth } = await import("@/backend/auth/middleware");
    const result = await requireAuth();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });

  it("requireAuth succeeds with valid session", async () => {
    setupAuthSession();
    const { requireAuth } = await import("@/backend/auth/middleware");
    const result = await requireAuth();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ctx.userId).toBe("user-1");
      expect(result.ctx.tenantId).toBe("org-1");
      expect(result.ctx.role).toBe("owner");
    }
  });
});

describe("E2E: API Endpoint Inventory", () => {
  it("all documented v1 endpoints are importable", async () => {
    const endpoints = [
      "@/app/api/v1/notifications/route",
      "@/app/api/v1/notifications/unread/route",
      "@/app/api/v1/onboarding/submit/route",
      "@/app/api/v1/auto-onboard/route",
      "@/app/api/v1/calendar/route",
      "@/app/api/v1/calendar/slots/route",
      "@/app/api/v1/meetings/route",
      "@/app/api/v1/meetings/available-slots/route",
      "@/app/api/v1/leads/[id]/timeline/route",
      "@/app/api/v1/onboarding/confirm/[threadId]/route",
      "@/app/api/v1/onboarding/complete/[threadId]/route",
      "@/app/api/v1/onboarding/draft/[threadId]/route",
      "@/app/api/v1/onboarding/edit/[threadId]/route",
      "@/app/api/v1/onboarding/status/[threadId]/route",
      "@/app/api/v1/onboarding/runs/route",
      "@/app/api/auth/signup/route",
      "@/app/api/auth/login/route",
      "@/app/api/v1/chat/route",
      "@/app/api/v1/chat/history/route",
      "@/app/api/leads/route",
      "@/app/api/leads/[id]/route",
    ];

    for (const endpoint of endpoints) {
      try {
        const mod = await import(endpoint);
        expect(mod).toBeDefined();
        const hasMethod = ["GET", "POST", "PUT", "PATCH", "DELETE"].some(
          (m) => m in mod,
        );
        expect(hasMethod).toBe(true);
      } catch (error) {
        console.error(`[E2E] Failed to import ${endpoint}:`, error);
        throw new Error(`Endpoint ${endpoint} is not importable`);
      }
    }
  });
});
