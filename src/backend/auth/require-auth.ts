import { NextResponse } from "next/server";
import { and, eq, type SQL } from "drizzle-orm";
import { type AnyPgColumn } from "drizzle-orm/pg-core";
import { getSession } from "./index";
import { db } from "../db";
import { organizationMembers } from "../db/schema";
import { hasPermission, ROLE_PERMISSIONS, type Role } from "./rbac";

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: Role;
}

export type Permission = keyof typeof ROLE_PERMISSIONS["owner"];

export class AuthError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

/**
 * Resolves the authenticated user from the session cookie and validates that
 * they are still a member of the session's active organization. Throws
 * `AuthError` (401 when unauthenticated, 403 when not a tenant member).
 */
export async function requireAuth(): Promise<AuthContext> {
  const session = await getSession();
  if (!session) {
    throw new AuthError(401, "Authentication required");
  }

  const membership = await db.query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.userId, session.userId),
      eq(organizationMembers.organizationId, session.activeOrganizationId),
    ),
  });

  if (!membership) {
    throw new AuthError(403, "Not a member of this organization");
  }

  return {
    userId: session.userId,
    tenantId: session.activeOrganizationId,
    role: membership.role ?? "member",
  };
}

/**
 * Requires an authenticated session AND the given role permission (see
 * `ROLE_PERMISSIONS` in rbac.ts). Throws 403 when the user's role does not
 * grant the permission.
 */
export async function requireRole(permission: Permission): Promise<AuthContext> {
  const auth = await requireAuth();
  if (!hasPermission(auth.role, permission)) {
    throw new AuthError(403, `Insufficient permissions: requires "${permission}"`);
  }
  return auth;
}

/**
 * Guards an explicitly-supplied tenant id against the session tenant. Throws
 * 403 when the requested tenant does not match the authenticated session.
 */
export async function assertTenantAccess(tenantId: string, auth?: AuthContext): Promise<void> {
  const ctx = auth ?? (await requireAuth());
  if (ctx.tenantId !== tenantId) {
    throw new AuthError(403, "Access denied for this tenant");
  }
}

/**
 * Convenience helper that returns a tenant-scoped equality condition for any
 * column (client_id / tenant_id / organization_id). Combine with `and(...)`.
 *
 * @example
 *   where(and(eq(schema.calls.id, id), withTenant(tenantId)(schema.calls.clientId)))
 */
export function withTenant(tenantId: string): (column: AnyPgColumn) => SQL {
  return (column) => eq(column, tenantId);
}

/**
 * Converts a thrown `AuthError` into a JSON `NextResponse`. Any other error is
 * rethrown so unexpected failures surface to the framework (500).
 */
export function authErrorResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  throw err;
}

/**
 * Runs an auth helper (`requireAuth` / `requireRole`) and converts a thrown
 * `AuthError` into a JSON `NextResponse`. Unexpected errors are rethrown.
 *
 * @example
 *   const auth = await withAuthError(() => requireAuth());
 *   if (auth instanceof NextResponse) return auth;
 *   const { tenantId } = auth;
 */
export async function withAuthError<T>(fn: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await fn();
  } catch (err) {
    return authErrorResponse(err);
  }
}