import { describe, expect, it } from "vitest";
import { createSession, deleteSession, getSession, hashPassword, verifyPassword } from "./index";
import { requireAuth } from "./middleware";
import {
  mockCookieStore,
  mockDb,
  mockDeleteResolving,
  mockInsertResolving,
  mockUpdateResolving,
} from "@/test-utils/mocks";

describe("password hashing", () => {
  it("round-trips hash + verify", async () => {
    const hash = await hashPassword("s3cret-password");
    expect(hash).not.toBe("s3cret-password");
    await expect(verifyPassword("s3cret-password", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("s3cret-password");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });
});

describe("sessions", () => {
  it("creates a session, persists it and sets an httpOnly cookie", async () => {
    mockDb.query.organizationMembers.findFirst.mockResolvedValue({ organizationId: "org-1" });
    mockInsertResolving();

    const sessionId = await createSession("user-1");

    expect(sessionId).toBeTruthy();
    expect(mockDb.query.organizationMembers.findFirst).toHaveBeenCalled();
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "session",
      sessionId,
      expect.objectContaining({ httpOnly: true, sameSite: "lax" }),
    );
  });

  it("validates an active session", async () => {
    const sessionId = "session-active";
    const tokenHash = await hashPassword(sessionId);
    mockCookieStore.get.mockReturnValue({ value: sessionId });
    mockDb.query.sessions.findFirst.mockResolvedValue({
      id: sessionId,
      userId: "user-1",
      activeOrganizationId: "org-1",
      tokenHash,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    mockDb.query.users.findFirst.mockResolvedValue({ id: "user-1", email: "alice@acme.com" });
    mockDb.query.organizationMembers.findFirst.mockResolvedValue({ organizationId: "org-1", userId: "user-1" });
    mockUpdateResolving();

    const session = await getSession();

    expect(session).not.toBeNull();
    expect(session?.userId).toBe("user-1");
    expect(session?.email).toBe("alice@acme.com");
  });

  it("rejects an expired session", async () => {
    const sessionId = "session-expired";
    const tokenHash = await hashPassword(sessionId);
    mockCookieStore.get.mockReturnValue({ value: sessionId });
    mockDb.query.sessions.findFirst.mockResolvedValue({
      id: sessionId,
      userId: "user-1",
      activeOrganizationId: "org-1",
      tokenHash,
      expiresAt: new Date(Date.now() - 1_000),
    });

    const session = await getSession();

    expect(session).toBeNull();
  });

  it("returns null when there is no session cookie", async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    await expect(getSession()).resolves.toBeNull();
  });

  it("deletes the session row and clears the cookie", async () => {
    mockCookieStore.get.mockReturnValue({ value: "session-1" });
    mockDeleteResolving();

    await deleteSession();

    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockCookieStore.delete).toHaveBeenCalledWith("session");
  });
});

describe("fail-closed authentication", () => {
  it("throws when the db fails instead of granting demo access", async () => {
    mockCookieStore.get.mockReturnValue({ value: "session-1" });
    mockDb.query.sessions.findFirst.mockRejectedValue(new Error("database unavailable"));

    await expect(requireAuth()).rejects.toThrow("database unavailable");
  });

  it("returns 401 when there is no session cookie", async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    const result = await requireAuth();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("rejects when the user is not a member of the active organization", async () => {
    const sessionId = "session-orphan";
    const tokenHash = await hashPassword(sessionId);
    mockCookieStore.get.mockReturnValue({ value: sessionId });
    mockDb.query.sessions.findFirst.mockResolvedValue({
      id: sessionId,
      userId: "user-1",
      activeOrganizationId: "org-1",
      tokenHash,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    mockDb.query.users.findFirst.mockResolvedValue({ id: "user-1", email: "alice@acme.com" });
    mockDb.query.organizationMembers.findFirst.mockResolvedValue(undefined);
    mockUpdateResolving();

    const result = await requireAuth();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });
});
