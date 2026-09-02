import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schema";

// Injected DB handle so adapters/services are testable with a mock.
export type Db = PostgresJsDatabase<typeof schema>;

export type MessageChannel = "whatsapp" | "gmail";
export type MessageDirection = "inbound" | "outbound";
export type Intent = "interested" | "dnc" | "neutral";

/** Normalized inbound message used across adapters and the inbound router. */
export interface InboundMessage {
  /** Provider-side unique id (WhatsApp message id / Gmail message id / historyId). */
  messageId: string;
  threadId?: string;
  /** Pre-resolved when the caller already knows the lead (legacy route payloads). */
  leadId?: string;
  clientId?: string;
  tenantId?: string;
  from?: string;
  to?: string;
  subject?: string;
  body: string;
  references?: string;
  inReplyTo?: string;
  receivedAt?: Date;
}

export interface SendResult {
  ok: boolean;
  /** Provider-side message id when the provider acknowledged the send. */
  providerId?: string;
  /** Provider-side thread id (Gmail) when available. */
  threadId?: string;
  /** Our persisted message record id. */
  messageId?: string;
  /** True when the send was short-circuited by an existing idempotency key. */
  idempotent?: boolean;
}

export interface WhatsAppSendInput {
  tenantId: string;
  /** E.164 phone number. */
  to: string;
  templateName: string;
  params: string[];
  leadId?: string;
  clientId?: string;
  callId?: string;
  idempotencyKey?: string;
}

export interface GmailSendInput {
  tenantId: string;
  to: string;
  subject: string;
  body: string;
  /** When replying inside an existing thread, maintained via In-Reply-To/References. */
  threadId?: string;
  leadId?: string;
  clientId?: string;
  callId?: string;
  idempotencyKey?: string;
}

export type SendMessageInput = WhatsAppSendInput | GmailSendInput;

export interface InboundProcessResult {
  intent: Intent;
  action: "dnc" | "interested" | "neutral";
  leadId: string;
  clientId: string;
}