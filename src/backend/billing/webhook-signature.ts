import { createHmac, timingSafeEqual } from "node:crypto";

export class WebhookSecretNotConfiguredError extends Error {
  constructor() {
    super("BILLING_WEBHOOK_SECRET is not configured");
    this.name = "WebhookSecretNotConfiguredError";
  }
}

function getSecret(secret?: string): string {
  const resolved = secret ?? process.env.BILLING_WEBHOOK_SECRET;
  if (!resolved || resolved.length === 0) throw new WebhookSecretNotConfiguredError();
  return resolved;
}

function normalizeSignature(signature: string): string {
  const value = signature.trim();
  const prefix = "sha256=";
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/**
 * Verifies an HMAC-SHA256 signature over the raw request body.
 *
 * Accepts either a raw hex signature or the common `sha256=<hex>` form. When
 * `secret` is omitted the value of `process.env.BILLING_WEBHOOK_SECRET` is
 * used; a missing secret always throws.
 */
export function verifyPaymentWebhook(rawBody: string, signature: string, secret?: string): boolean {
  const webhookSecret = getSecret(secret);
  const expected = createHmac("sha256", webhookSecret).update(rawBody, "utf8").digest("hex");
  const received = normalizeSignature(signature);
  if (!received) return false;

  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(received, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}