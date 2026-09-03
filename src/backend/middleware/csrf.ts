import { NextResponse } from "next/server";

export class CsrfError extends Error {
  public readonly status = 403;

  constructor(message = "CSRF validation failed") {
    super(message);
    this.name = "CsrfError";
  }
}

export type CsrfCheck =
  | { ok: true }
  | { ok: false; response: NextResponse };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function parseHost(value: string): string {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    throw new CsrfError("Invalid Origin/Referer header");
  }
}

// Verifies that state-changing requests originate from the configured app
// origin. Throws a 403 CsrfError on mismatch or when no Origin/Referer is sent.
export function validateCsrf(request: Request): void {
  const method = request.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return;

  let allowedHost: string;
  try {
    allowedHost = new URL(appUrl).host.toLowerCase();
  } catch {
    throw new CsrfError("Invalid NEXT_PUBLIC_APP_URL configuration");
  }

  const origin = request.headers.get("origin");
  if (origin) {
    if (parseHost(origin) !== allowedHost) throw new CsrfError("Cross-origin request rejected");
    return;
  }

  const referer = request.headers.get("referer");
  if (referer) {
    if (parseHost(referer) !== allowedHost) throw new CsrfError("Cross-origin request rejected");
    return;
  }

  throw new CsrfError("Missing Origin or Referer header");
}

// Route-handler helper: returns a 403 NextResponse on failure, null otherwise.
export function csrfMiddleware(): (request: Request) => CsrfCheck {
  return (request) => {
    try {
      validateCsrf(request);
      return { ok: true };
    } catch (error) {
      const message = error instanceof CsrfError ? error.message : "CSRF validation failed";
      return { ok: false, response: NextResponse.json({ error: message }, { status: 403 }) };
    }
  };
}