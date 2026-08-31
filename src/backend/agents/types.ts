import { z } from "zod";

// ── Agent Protocol ──
// Every agent implements this interface.
// Agents are stateless — all mutable state lives in ContextStore (Redis).

export interface Agent<I = unknown, O = unknown> {
  name: string;
  execute(input: I, ctx: AgentContext): Promise<O>;
}

export interface AgentContext {
  leadId: string;
  clientId: string;
  bus: MessageBus;
  store: ContextStore;
  log: (msg: string, data?: unknown) => void;
}

// ── Message Bus ──
// Typed pub/sub for agent-to-agent communication.
// In-memory for MVP, swap to Redis pub/sub for multi-process.

export type AgentMessage =
  | { type: "lead.enriched"; leadId: string; clientId: string; data: unknown }
  | { type: "lead.scored"; leadId: string; clientId: string; score: number; band: string }
  | { type: "consent.checked"; leadId: string; clientId: string; approved: boolean }
  | { type: "call.started"; leadId: string; clientId: string; callId: string }
  | { type: "call.ended"; leadId: string; clientId: string; callId: string; outcome: string }
  | { type: "message.sent"; leadId: string; clientId: string; channel: string }
  | { type: "meeting.booked"; leadId: string; clientId: string }
  | { type: "retry.scheduled"; leadId: string; clientId: string; nextAttemptAt: string }
  | { type: "error"; leadId?: string; clientId?: string; agent: string; error: string };

export type MessageHandler = (msg: AgentMessage) => void | Promise<void>;

export interface MessageBus {
  publish(msg: AgentMessage): void;
  subscribe(type: AgentMessage["type"], handler: MessageHandler): () => void;
}

// ── Context Store ──
// Key-value store per lead — holds conversation state, scores, transcripts.

export interface ContextStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
  recall(leadId: string): Promise<LeadMemory>;
  saveMemory(mem: LeadMemory): Promise<void>;
}

export interface LeadMemory {
  leadId: string;
  calls: Array<{ callId: string; outcome: string; summary: string; bant: unknown; at: string }>;
  messages: Array<{ channel: string; body: string; direction: string; at: string }>;
  lastPitch: string | null;
  lastSentiment: string | null;
  totalAttempts: number;
}

// ── Pipeline ──
// Orchestrates the full flow: Scout → Ranker → Consent → Dialer → Nudge

export type PipelineStage =
  | "scout"
  | "ranker"
  | "consent"
  | "llm"
  | "dialer"
  | "nudge"
  | "retry"
  | "booked"
  | "parked"
  | "dlq";

export interface PipelineResult {
  leadId: string;
  clientId: string;
  stage: PipelineStage;
  outcome?: string;
  error?: string;
  durationMs: number;
}

// ── Input/Output types for each agent ──

export interface ScoutInput {
  clientId: string;
  icpTags: string[];
  batchSize?: number;
}

export interface ScoutOutput {
  leadsFound: number;
  leadsNew: number;
  leadsReused: number;
  leadIds: string[];
}

export interface RankerInput {
  leadIds: string[];
  clientId: string;
}

export interface RankerOutput {
  scored: number;
  hot: number;
  warm: number;
  cold: number;
}

export interface ConsentInput {
  leadId: string;
  clientId: string;
}

export interface ConsentOutput {
  approved: boolean;
  reason: string;
}

export interface DialerInput {
  leadId: string;
  clientId: string;
  pitch?: string;
}

export interface DialerOutput {
  callId: string;
  outcome: string;
  durationSec: number;
  bant: unknown;
  sentiment: string;
  summary: string;
}

export interface NudgeInput {
  leadId: string;
  clientId: string;
  callId: string;
  outcome: string;
  bant: unknown;
}

export interface NudgeOutput {
  messagesSent: number;
  meetingBooked: boolean;
}
