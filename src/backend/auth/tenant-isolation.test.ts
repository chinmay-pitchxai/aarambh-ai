import { describe, expect, it, vi, beforeEach } from "vitest";
import { requireAuth, requireRole, assertTenantAccess, AuthError } from "./require-auth";
import {
  mockCookieStore,
  mockDb,
  mockUpdateResolving,
} from "@/test-utils/mocks";
import { hashPassword } from "./index";

// ── Test fixtures ────────────────────────────────────────────────────────────
const TENANT_A = "org-tenant-a";
const TENANT_B = "org-tenant-b";

const USER_A = { id: "user-a", email: "alice@acme.com" };
const USER_B = { id: "user-b", email: "bob@othercorp.com" };

const SESSION_A = {
  id: "session-a",
  userId: USER_A.id,
  activeOrganizationId: TENANT_A,
  tokenHash: "", // set in beforeEach
  expiresAt: new Date(Date.now() + 3_600_000),
};

const SESSION_B = {
  id: "session-b",
  userId: USER_B.id,
  activeOrganizationId: TENANT_B,
  tokenHash: "",
  expiresAt: new Date(Date.now() + 3_600_000),
};

beforeEach(async () => {
  SESSION_A.tokenHash = await hashPassword(SESSION_A.id);
  SESSION_B.tokenHash = await hashPassword(SESSION_B.id);
  vi.clearAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function mockSessionCookie(sessionId: string) {
  mockCookieStore.get.mockReturnValue({ value: sessionId });
}

function mockSessionLookup(
  session: typeof SESSION_A,
  user: typeof USER_A,
  role: string,
) {
  mockDb.query.sessions.findFirst.mockResolvedValue(session);
  mockDb.query.users.findFirst.mockResolvedValue(user);
  mockDb.query.organizationMembers.findFirst.mockResolvedValue({
    organizationId: session.activeOrganizationId,
    userId: user.id,
    role,
  });
  mockUpdateResolving();
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("requireAuth — session-derived tenant", () => {
  it("returns tenant from session, not request body", async () => {
    mockSessionCookie(SESSION_A.id);
    mockSessionLookup(SESSION_A, USER_A, "owner");

    const ctx = await requireAuth();

    expect(ctx.tenantId).toBe(TENANT_A);
    expect(ctx.userId).toBe(USER_A.id);
  });
});

describe("tenant isolation — cross-tenant access blocked", () => {
  it("user from tenant A cannot access tenant B data", async () => {
    mockSessionCookie(SESSION_A.id);
    mockSessionLookup(SESSION_A, USER_A, "owner");

    const ctx = await requireAuth();

    // The session-derived tenant must not leak to tenant B
    expect(ctx.tenantId).toBe(TENANT_A);
    expect(ctx.tenantId).not.toBe(TENANT_B);
  });

  it("assertTenantAccess rejects when tenant mismatch", async () => {
    mockSessionCookie(SESSION_A.id);
    mockSessionLookup(SESSION_A, USER_A, "owner");

    const ctx = await requireAuth();

    await expect(assertTenantAccess(TENANT_B, ctx)).rejects.toThrow(AuthError);
    await expect(assertTenantAccess(TENANT_B, ctx)).rejects.toThrow("Access denied");
  });

  it("assertTenantAccess passes when tenant matches", async () => {
    mockSessionCookie(SESSION_A.id);
    mockSessionLookup(SESSION_A, USER_A, "owner");

    const ctx = await requireAuth();

    await expect(assertTenantAccess(TENANT_A, ctx)).resolves.toBeUndefined();
  });
});

describe("requireRole — RBAC enforcement", () => {
  it("owner can write", async () => {
    mockSessionCookie(SESSION_A.id);
    mockSessionLookup(SESSION_A, USER_A, "owner");

    const ctx = await requireRole("canWrite");
    expect(ctx.tenantId).toBe(TENANT_A);
  });

  it("member can write", async () => {
    mockSessionCookie(SESSION_A.id);
    mockSessionLookup(SESSION_A, USER_A, "member");

    const ctx = await requireRole("canWrite");
    expect(ctx.tenantId).toBe(TENANT_A);
  });

  it("viewer is rejected for write operations", async () => {
    mockSessionCookie(SESSION_A.id);
    mockSessionLookup(SESSION_A, USER_A, "viewer");

    await expect(requireRole("canWrite")).rejects.toThrow(AuthError);
    await expect(requireRole("canWrite")).rejects.toThrow('Insufficient permissions: requires "canWrite"');
  });

  it("viewer is rejected for delete operations", async () => {
    mockSessionCookie(SESSION_A.id);
    mockSessionLookup(SESSION_A, USER_A, "viewer");

    await expect(requireRole("canDelete")).rejects.toThrow(AuthError);
  });

  it("viewer is rejected for manage integrations", async () => {
    mockSessionCookie(SESSION_A.id);
    mockSessionLookup(SESSION_A, USER_A, "viewer");

    await expect(requireRole("canManageIntegrations")).rejects.toThrow(AuthError);
  });

  it("viewer is rejected for pipeline runs", async () => {
    mockSessionCookie(SESSION_A.id);
    mockSessionLookup(SESSION_A, USER_A, "viewer");

    await expect(requireRole("canRunPipeline")).rejects.toThrow(AuthError);
  });

  it("viewer can read", async () => {
    mockSessionCookie(SESSION_A.id);
    mockSessionLookup(SESSION_A, USER_A, "viewer");

    const ctx = await requireRole("canRead");
    expect(ctx.tenantId).toBe(TENANT_A);
  });

  it("member is rejected for delete operations", async () => {
    mockSessionCookie(SESSION_A.id);
    mockSessionLookup(SESSION_A, USER_A, "member");

    await expect(requireRole("canDelete")).rejects.toThrow(AuthError);
  });

  it("admin can delete", async () => {
    mockSessionCookie(SESSION_A.id);
    mockSessionLookup(SESSION_A, USER_A, "admin");

    const ctx = await requireRole("canDelete");
    expect(ctx.tenantId).toBe(TENANT_A);
  });

  it("member cannot manage members", async () => {
    mockSessionCookie(SESSION_A.id);
    mockSessionLookup(SESSION_A, USER_A, "member");

    await expect(requireRole("canManageMembers")).rejects.toThrow(AuthError);
  });
});

describe("requireAuth — unauthenticated and invalid sessions", () => {
  it("throws 401 when no session cookie", async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    await expect(requireAuth()).rejects.toThrow(AuthError);
    try {
      await requireAuth();
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).status).toBe(401);
    }
  });

  it("throws 403 when user is not a member of the active org", async () => {
    mockSessionCookie(SESSION_A.id);
    mockDb.query.sessions.findFirst.mockResolvedValue(SESSION_A);
    mockDb.query.users.findFirst.mockResolvedValue(USER_A);
    mockDb.query.organizationMembers.findFirst.mockResolvedValue(undefined);
    mockUpdateResolving();

    await expect(requireAuth()).rejects.toThrow(AuthError);
  });
});
