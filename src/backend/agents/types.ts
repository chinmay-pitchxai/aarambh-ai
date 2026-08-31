import { z } from "zod";

// ── Agent Protocol ──

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

export type AgentMessage =
  | { type: "lead.enriched"; leadId: string; clientId: string; data: unknown }
  | { type: "lead.scored"; leadId: string; clientId: string; score: number; band: string }
  | { type: "lead.lost"; leadId: string; clientId: string }
  | { type: "consent.checked"; leadId: string; clientId: string; approved: boolean }
  | { type: "call.started"; leadId: string; clientId: string; callId: string }
  | { type: "call.ended"; leadId: string; clientId: string; callId: string; outcome: string }
  | { type: "message.sent"; leadId: string; clientId: string; channel: string }
  | { type: "meeting.booked"; leadId: string; clientId: string }
  | { type: "meeting.cancelled"; leadId: string; clientId: string }
  | { type: "meeting.completed"; leadId: string; clientId: string }
  | { type: "meeting.no_show"; leadId: string; clientId: string }
  | { type: "retry.scheduled"; leadId: string; clientId: string; nextAttemptAt: string }
  | { type: "reminder.day_before"; leadId: string; clientId: string; meetingId: string }
  | { type: "reminder.day_of"; leadId: string; clientId: string; meetingId: string }
  | { type: "reply.interested"; leadId: string; clientId: string }
  | { type: "reply.not_interested"; leadId: string; clientId: string }
  | { type: "reply.neutral"; leadId: string; clientId: string }
  | { type: "reply.timeout"; leadId: string; clientId: string }
  | { type: "outcome.interested"; leadId: string; clientId: string; callId: string }
  | { type: "outcome.not_interested"; leadId: string; clientId: string; callId: string }
  | { type: "outcome.no_answer"; leadId: string; clientId: string; callId: string }
  | { type: "outcome.busy"; leadId: string; clientId: string; callId: string }
  | { type: "outcome.failed"; leadId: string; clientId: string; callId: string }
  | { type: "outcome.picked_no_response"; leadId: string; clientId: string; callId: string }
  | { type: "outcome.booked"; leadId: string; clientId: string; callId: string }
  | { type: "error"; leadId?: string; clientId?: string; agent: string; error: string };

export type MessageHandler = (msg: AgentMessage) => void | Promise<void>;

export interface MessageBus {
  publish(msg: AgentMessage): void;
  subscribe(type: AgentMessage["type"], handler: MessageHandler): () => void;
}

// ── Context Store ──

export interface ContextStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
  recall(leadId: string): Promise<LeadMemory>;
  saveMemory(mem: LeadMemory): Promise<void>;
}

export interface LeadMemory {
  leadId: string;
  calls: Array<{ callId: string; outcome: string; summary: string; bant: BANT; at: string }>;
  messages: Array<{ channel: string; body: string; direction: string; at: string }>;
  lastPitch: string | null;
  lastSentiment: string | null;
  totalAttempts: number;
}

// ── BANT ──

export interface BANT {
  budget: string;
  authority: string;
  need: string;
  timeline: string;
}

// ── Booking ──

export interface BookingInput {
  leadId: string;
  clientId: string;
  scheduledAt: Date;
  durationMin?: number;
  meetingUrl?: string;
  notes?: string;
}

// ── Pipeline ──

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
  | "dlq"
  | "lost";

export interface PipelineResult {
  leadId: string;
  clientId: string;
  stage: PipelineStage;
  outcome?: string;
  error?: string;
  durationMs: number;
}

// ── Call Outcome / Lead Status enums ──

export type callOutcome =
  | "interested"
  | "not_interested"
  | "no_answer"
  | "failed"
  | "picked_no_response"
  | "booked";

export type leadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "converted"
  | "booked"
  | "parked"
  | "dnc"
  | "lost";

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
  attemptNumber?: number;
}

export interface DialerOutput {
  callId: string;
  outcome: callOutcome;
  durationSec: number;
  bant: BANT;
  sentiment: string;
  summary: string;
}

export interface NudgeInput {
  leadId: string;
  clientId: string;
  callId: string;
  outcome: string;
  bant: BANT;
}

export interface NudgeOutput {
  messagesSent: number;
  meetingBooked: boolean;
}
