import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "../db";
import { users, sessions, organizations, organizationMembers } from "../db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "./nanoid";

const SECRET = new TextEncoder().encode(process.env.APP_SECRET || "aarambhai-dev-secret-change-in-production");
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── Password Hashing ──
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ── JWT ──
export async function signToken(payload: { userId: string; email: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<{ userId: string; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return { userId: payload.userId as string, email: payload.email as string };
  } catch {
    return null;
  }
}

// ── Session Management ──
export async function createSession(userId: string): Promise<string> {
  const sessionId = nanoid();
  const tokenHash = await hashPassword(sessionId);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  const member = await db.query.organizationMembers.findFirst({
    where: eq(organizationMembers.userId, userId),
  });

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    tokenHash,
    activeOrganizationId: member?.organizationId || "default",
    expiresAt,
  });

  // Set HTTP-only cookie
  const cookieStore = await cookies();
  cookieStore.set("session", sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_MS / 1000,
  });

  return sessionId;
}

export async function getSession(): Promise<{ userId: string; email: string; sessionId: string } | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session")?.value;
  if (!sessionId) return null;

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });

  if (!session || session.expiresAt < new Date()) {
    return null;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  if (!user) return null;

  return { userId: user.id, email: user.email, sessionId };
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session")?.value;
  if (sessionId) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  }
  cookieStore.delete("session");
}

// ── User Creation ──
export async function createUser(email: string, password: string, name?: string) {
  const passwordHash = await hashPassword(password);
  const userId = nanoid();

  await db.insert(users).values({
    id: userId,
    email,
    passwordHash,
    name: name || email.split("@")[0],
  });

  // Create default organization
  const orgId = nanoid();
  const slug = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "-");

  await db.insert(organizations).values({
    id: orgId,
    name: name || email.split("@")[0],
    slug,
  });

  // Add user as owner
  await db.insert(organizationMembers).values({
    id: nanoid(),
    organizationId: orgId,
    userId,
    role: "owner",
  });

  return { userId, orgId };
}

export async function findUserByEmail(email: string) {
  return db.query.users.findFirst({
    where: eq(users.email, email),
  });
}

export async function getUserOrganization(userId: string) {
  const member = await db.query.organizationMembers.findFirst({
    where: eq(organizationMembers.userId, userId),
  });
  if (!member) return null;

  return db.query.organizations.findFirst({
    where: eq(organizations.id, member.organizationId),
  });
}
