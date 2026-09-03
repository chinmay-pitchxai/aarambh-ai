import { eq, and, desc, count, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

type DB = PostgresJsDatabase<typeof schema>;

export type NotificationType =
  | "hot_lead"
  | "qualified_lead"
  | "interested"
  | "meeting_booked"
  | "call_completed"
  | "follow_up"
  | "dnc"
  | "system";

export interface CreateNotificationInput {
  tenantId: string;
  userId: string;
  type: NotificationType;
  title: string;
  message?: string;
  leadId?: string;
  callId?: string;
  meetingId?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationRow {
  id: string;
  tenantId: string;
  userId: string;
  type: string;
  title: string;
  message: string | null;
  leadId: string | null;
  callId: string | null;
  meetingId: string | null;
  read: boolean | null;
  metadata: unknown;
  createdAt: Date | null;
}

export async function createNotification(
  db: DB,
  input: CreateNotificationInput,
): Promise<NotificationRow> {
  const rows = await db
    .insert(schema.notifications)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message ?? null,
      leadId: input.leadId ?? null,
      callId: input.callId ?? null,
      meetingId: input.meetingId ?? null,
      read: false,
      metadata: input.metadata ?? null,
    })
    .returning();
  return rows[0] as NotificationRow;
}

export interface ListNotificationsOptions {
  limit?: number;
  offset?: number;
}

export async function getNotifications(
  db: DB,
  tenantId: string,
  userId: string,
  options: ListNotificationsOptions = {},
): Promise<{ notifications: NotificationRow[]; total: number }> {
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const offset = Math.max(0, options.offset ?? 0);

  const [notifications, totalResult] = await Promise.all([
    db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.tenantId, tenantId), eq(schema.notifications.userId, userId)))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: count() })
      .from(schema.notifications)
      .where(and(eq(schema.notifications.tenantId, tenantId), eq(schema.notifications.userId, userId))),
  ]);

  return {
    notifications: notifications as NotificationRow[],
    total: (totalResult[0] as { value: number }).value,
  };
}

export async function getUnreadCount(
  db: DB,
  tenantId: string,
  userId: string,
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.tenantId, tenantId),
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.read, false),
      ),
    );
  return (rows[0] as { value: number }).value;
}

export async function markAsRead(
  db: DB,
  notificationId: string,
): Promise<void> {
  await db
    .update(schema.notifications)
    .set({ read: true })
    .where(eq(schema.notifications.id, notificationId));
}

export async function markAllAsRead(
  db: DB,
  tenantId: string,
  userId: string,
): Promise<number> {
  const rows = await db
    .update(schema.notifications)
    .set({ read: true })
    .where(
      and(
        eq(schema.notifications.tenantId, tenantId),
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.read, false),
      ),
    )
    .returning({ id: schema.notifications.id });
  return rows.length;
}

export async function getMembersByTenant(
  db: DB,
  tenantId: string,
): Promise<Array<{ userId: string }>> {
  const rows = await db
    .select({ userId: schema.organizationMembers.userId })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.organizationId, tenantId));
  return rows as Array<{ userId: string }>;
}

export async function createNotificationForTenant(
  db: DB,
  input: Omit<CreateNotificationInput, "userId"> & { userId?: string },
): Promise<void> {
  if (input.userId) {
    await createNotification(db, input as CreateNotificationInput);
    return;
  }
  const members = await getMembersByTenant(db, input.tenantId);
  for (const member of members) {
    await createNotification(db, { ...input, userId: member.userId });
  }
}

export function formatNotificationMessage(type: NotificationType, data: {
  leadName?: string;
  company?: string;
  callOutcome?: string;
  durationSec?: number;
  meetingTime?: string;
}): string {
  const name = data.leadName || "a lead";
  const co = data.company ? ` at ${data.company}` : "";

  switch (type) {
    case "hot_lead":
      return `${name}${co} has been classified as a hot lead. Review and prioritize.`;
    case "qualified_lead":
      return `${name}${co} has been qualified. They match your ICP.`;
    case "interested":
      return `${name}${co} expressed interest. Information has been sent.`;
    case "meeting_booked":
      return `Meeting booked with ${name}${co}${data.meetingTime ? ` for ${data.meetingTime}` : ""}.`;
    case "call_completed":
      return `Call with ${name}${co} completed${data.callOutcome ? ` — ${data.callOutcome}` : ""}${data.durationSec ? ` (${Math.round(data.durationSec / 60)}m)` : ""}.`;
    case "follow_up":
      return `Follow-up scheduled for ${name}${co}.`;
    case "dnc":
      return `${name}${co} has been marked as Do Not Contact.`;
    case "system":
      return "System notification.";
    default:
      return "New notification.";
  }
}
