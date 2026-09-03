const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "unknown";
}

export function rateLimit(
  req: Request,
  { windowMs, maxAttempts, key }: { windowMs: number; maxAttempts: number; key: string },
): { allowed: boolean; retryAfterMs: number } {
  const ip = getClientIp(req);
  const storeKey = `${key}:${ip}`;
  const now = Date.now();
  const entry = rateLimitStore.get(storeKey);

  if (entry && entry.resetAt > now) {
    if (entry.count >= maxAttempts) {
      return { allowed: false, retryAfterMs: entry.resetAt - now };
    }
    entry.count++;
    return { allowed: true, retryAfterMs: 0 };
  }

  rateLimitStore.set(storeKey, { count: 1, resetAt: now + windowMs });
  return { allowed: true, retryAfterMs: 0 };
}

export function verifyCsrf(req: Request): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const method = req.method;

  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return true;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return true;

  const allowedOrigin = appUrl.replace(/\/$/, "").toLowerCase();

  if (origin) {
    return origin.replace(/\/$/, "").toLowerCase() === allowedOrigin;
  }

  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const refererOrigin = `${refererUrl.protocol}//${refererUrl.host}`.toLowerCase();
      return refererOrigin === allowedOrigin;
    } catch {
      return false;
    }
  }

  return false;
}
