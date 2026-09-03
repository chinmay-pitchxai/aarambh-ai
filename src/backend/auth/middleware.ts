import { NextResponse } from "next/server";
import { getSession } from "./index";
import { db } from "../db";
import { organizationMembers } from "../db/schema";
import { and, eq } from "drizzle-orm";

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: string;
  email: string;
}

export type Role = "owner" | "admin" | "member" | "viewer";

const ROLE_HIERARCHY: Record<Role, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

export function hasPermission(userRole: string, requiredRole: Role): boolean {
  const userLevel = ROLE_HIERARCHY[userRole as Role] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole];
  return userLevel >= requiredLevel;
}

export async function requireAuth(): Promise<
  { ok: true; ctx: AuthContext } | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 }),
    };
  }

  const membership = await db.query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.userId, session.userId),
      eq(organizationMembers.organizationId, session.activeOrganizationId),
    ),
  });

  if (!membership) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not a member of this organization" }, { status: 403 }),
    };
  }

  return {
    ok: true,
    ctx: {
      userId: session.userId,
      tenantId: session.activeOrganizationId,
      role: membership.role ?? "member",
      email: session.email,
    },
  };
}

export async function requireRole(
  minimumRole: Role,
): Promise<
  { ok: true; ctx: AuthContext } | { ok: false; response: NextResponse }
> {
  const auth = await requireAuth();
  if (!auth.ok) return auth;

  if (!hasPermission(auth.ctx.role, minimumRole)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Requires ${minimumRole} role or higher` },
        { status: 403 },
      ),
    };
  }

  return auth;
}
