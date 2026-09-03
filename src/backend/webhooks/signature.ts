import { createHmac, timingSafeEqual } from "node:crypto";

export type HmacAlgorithm = "sha256" | "sha512" | "sha1";

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

// Constant-time HMAC comparison. Returns false for missing/invalid input so
// callers can never leak whether a signature prefix matched.
export function verifyHmacSignature(
  secret: string,
  payload: string | Buffer,
  signature: string | null | undefined,
  algorithm: HmacAlgorithm = "sha256",
): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac(algorithm, secret).update(payload).digest();
  const received = Buffer.from(signature, "hex");
  return safeEqual(expected, received);
}

// WhatsApp Cloud API: X-Hub-Signature-256 = sha256=<hex HMAC-SHA256(app_secret, raw body)>
export function verifyWhatsAppSignature(
  token: string | undefined,
  body: string | Buffer,
  xHubSignature256: string | null | undefined,
): boolean {
  if (!token || !xHubSignature256) return false;
  const signature = xHubSignature256.startsWith("sha256=")
    ? xHubSignature256.slice("sha256=".length)
    : xHubSignature256;
  return verifyHmacSignature(token, body, signature, "sha256");
}

// Vobiz webhooks: HMAC-SHA256(secret, raw body), hex-encoded signature.
export function verifyVobizSignature(
  secret: string | undefined,
  body: string | Buffer,
  signature: string | null | undefined,
): boolean {
  return verifyHmacSignature(secret ?? "", body, signature, "sha256");
}

// Gmail push webhooks: HMAC-SHA256(secret, raw body), hex-encoded signature.
export function verifyGmailSignature(
  secret: string | undefined,
  body: string | Buffer,
  signature: string | null | undefined,
): boolean {
  return verifyHmacSignature(secret ?? "", body, signature, "sha256");
}