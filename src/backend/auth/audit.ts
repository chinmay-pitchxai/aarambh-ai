export type AuthEvent =
  | "login_success"
  | "login_failed"
  | "signup_success"
  | "signup_failed"
  | "logout"
  | "session_invalid"
  | "session_rotated"
  | "oauth_callback"
  | "oauth_failed"
  | "rate_limited"
  | "csrf_rejected";

interface AuthAuditEntry {
  event: AuthEvent;
  userId?: string;
  email?: string;
  ip?: string;
  userAgent?: string;
  timestamp: string;
  details?: string;
}

export function logAuthEvent(
  event: AuthEvent,
  req?: Request,
  details?: { userId?: string; email?: string; error?: string },
): void {
  const entry: AuthAuditEntry = {
    event,
    userId: details?.userId,
    email: details?.email,
    ip: req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req?.headers.get("x-real-ip")
      || undefined,
    userAgent: req?.headers.get("user-agent") || undefined,
    timestamp: new Date().toISOString(),
    details: details?.error,
  };

  console.info(`[AUTH_AUDIT] ${JSON.stringify(entry)}`);
}
