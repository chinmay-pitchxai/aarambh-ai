import { z } from "zod";

export const EVENT_TYPES = [
  "company.profile_confirmed",
  "leads.ready",
  "leads.sample_delivered",
  "call.initiated",
  "call.completed",
  "call.outcome",
  "message.sent",
  "message.received",
  "meeting.booked",
  "meeting.confirmed",
  "meeting.reminder",
  "subscription.activated",
  "subscription.updated",
  "billing.payment_received",
] as const;

export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventTypeSchema>;

const baseEventFields = {
  id: z.string().uuid(),
  schema_version: z.number().int().positive().default(1),
  type: z.string(),
  run_id: z.string().uuid(),
  thread_id: z.string().trim().min(1),
  tenant_id: z.string().trim().min(1),
  actor_id: z.string().trim().min(1),
  correlation_id: z.string().trim().min(1),
  causation_id: z.string().trim().min(1).nullable(),
  input_event_id: z.string().trim().min(1),
  created_at: z.string().datetime(),
};

export const companyProfileConfirmedSchema = z.object({
  ...baseEventFields,
  type: z.literal("company.profile_confirmed"),
  company_id: z.string().trim().min(1),
  company_profile_version: z.number().int().positive(),
});
export type CompanyProfileConfirmed = z.infer<typeof companyProfileConfirmedSchema>;

export const leadsReadySchema = z.object({
  ...baseEventFields,
  type: z.literal("leads.ready"),
  campaign_id: z.string().trim().min(1),
  lead_ids: z.array(z.string().trim().min(1)).min(1),
});
export type LeadsReady = z.infer<typeof leadsReadySchema>;

export const leadsSampleDeliveredSchema = z.object({
  ...baseEventFields,
  type: z.literal("leads.sample_delivered"),
  campaign_id: z.string().trim().min(1),
  lead_ids: z.array(z.string().trim().min(1)).min(1),
  count: z.number().int().nonnegative(),
});
export type LeadsSampleDelivered = z.infer<typeof leadsSampleDeliveredSchema>;

const callBaseFields = {
  ...baseEventFields,
  call_id: z.string().trim().min(1),
  lead_id: z.string().trim().min(1),
};

export const callInitiatedSchema = z.object({
  ...callBaseFields,
  type: z.literal("call.initiated"),
});
export type CallInitiated = z.infer<typeof callInitiatedSchema>;

export const callCompletedSchema = z.object({
  ...callBaseFields,
  type: z.literal("call.completed"),
});
export type CallCompleted = z.infer<typeof callCompletedSchema>;

export const callOutcomeSchema = z.object({
  ...callBaseFields,
  type: z.literal("call.outcome"),
  outcome: z.enum(["no_answer", "failed", "not_interested", "interested", "booked", "picked_no_response"]).optional(),
});
export type CallOutcome = z.infer<typeof callOutcomeSchema>;

const messageBaseFields = {
  ...baseEventFields,
  message_id: z.string().trim().min(1),
  channel: z.enum(["whatsapp", "gmail"]),
  direction: z.enum(["outbound", "inbound"]),
  lead_id: z.string().trim().min(1),
};

export const messageSentSchema = z.object({
  ...messageBaseFields,
  type: z.literal("message.sent"),
});
export type MessageSent = z.infer<typeof messageSentSchema>;

export const messageReceivedSchema = z.object({
  ...messageBaseFields,
  type: z.literal("message.received"),
});
export type MessageReceived = z.infer<typeof messageReceivedSchema>;

const meetingBaseFields = {
  ...baseEventFields,
  meeting_id: z.string().trim().min(1),
  lead_id: z.string().trim().min(1),
  scheduled_at: z.string().datetime().optional(),
};

export const meetingBookedSchema = z.object({
  ...meetingBaseFields,
  type: z.literal("meeting.booked"),
});
export type MeetingBooked = z.infer<typeof meetingBookedSchema>;

export const meetingConfirmedSchema = z.object({
  ...meetingBaseFields,
  type: z.literal("meeting.confirmed"),
});
export type MeetingConfirmed = z.infer<typeof meetingConfirmedSchema>;

export const meetingReminderSchema = z.object({
  ...meetingBaseFields,
  type: z.literal("meeting.reminder"),
});
export type MeetingReminder = z.infer<typeof meetingReminderSchema>;

export const subscriptionActivatedSchema = z.object({
  ...baseEventFields,
  type: z.literal("subscription.activated"),
  subscription_id: z.string().trim().min(1),
  plan_id: z.string().trim().min(1),
});
export type SubscriptionActivated = z.infer<typeof subscriptionActivatedSchema>;

export const subscriptionUpdatedSchema = z.object({
  ...baseEventFields,
  type: z.literal("subscription.updated"),
  subscription_id: z.string().trim().min(1),
  plan_id: z.string().trim().min(1),
});
export type SubscriptionUpdated = z.infer<typeof subscriptionUpdatedSchema>;

export const billingPaymentReceivedSchema = z.object({
  ...baseEventFields,
  type: z.literal("billing.payment_received"),
  subscription_id: z.string().trim().min(1),
  amount_cents: z.number().int().nonnegative(),
});
export type BillingPaymentReceived = z.infer<typeof billingPaymentReceivedSchema>;

export const domainEventSchema = z.discriminatedUnion("type", [
  companyProfileConfirmedSchema,
  leadsReadySchema,
  leadsSampleDeliveredSchema,
  callInitiatedSchema,
  callCompletedSchema,
  callOutcomeSchema,
  messageSentSchema,
  messageReceivedSchema,
  meetingBookedSchema,
  meetingConfirmedSchema,
  meetingReminderSchema,
  subscriptionActivatedSchema,
  subscriptionUpdatedSchema,
  billingPaymentReceivedSchema,
]);

export type DomainEvent = z.infer<typeof domainEventSchema>;

export function parseDomainEvent(value: unknown): DomainEvent {
  return domainEventSchema.parse(value);
}

export function isDomainEvent(value: unknown): value is DomainEvent {
  return domainEventSchema.safeParse(value).success;
}