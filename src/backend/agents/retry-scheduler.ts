import { db, schema } from "../db";
import { eq, and, lte } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { MessageBus, AgentContext } from "./types";
import { createRedisStore } from "./context";

// ── Retry Scheduler ──
// Polls retryQueue every minute, re-dials leads on schedule.
// RETRY SCHEDULE: 24h -> 32h -> 48h (3 attempts max)

const RETRY_DELAYS: Record<number, number> = {
  1: 24 * 60 * 60 * 1000,      // 24h after attempt 1
  2: 32 * 60 * 60 * 1000,      // 32h after attempt 2
  3: 48 * 60 * 60 * 1000,      // 48h after attempt 3 (max, so expired)
};

const MAX_ATTEMPTS = 3;

export async function processRetries(bus: MessageBus): Promise<{
  expired: number;
  retried: number;
  completed: number;
}> {
  const now = new Date();

  // 1. Query pending retries
  const pendingRetries = await db
    .select()
    .from(schema.retryQueue)
    .where(
      and(
        eq(schema.retryQueue.status, "pending"),
        lte(schema.retryQueue.nextAttemptAt, now),
      ),
    );

  let expired = 0;
  let retried = 0;
  let completed = 0;

  for (const retry of pendingRetries) {
    try {
      const currentAttempt = retry.attempt || 1;
      const maxAttempts = retry.maxAttempts || MAX_ATTEMPTS;

      // 2a. If attempt >= maxAttempts: expire
      if (currentAttempt >= maxAttempts) {
        await db
          .update(schema.retryQueue)
          .set({ status: "expired" })
          .where(eq(schema.retryQueue.id, retry.id));

        await db
          .update(schema.clientLeads)
          .set({ status: "lost" as typeof schema.clientLeads.status.enumValues[number], lostAt: new Date() })
          .where(
            and(
              eq(schema.clientLeads.leadId, retry.leadId),
              eq(schema.clientLeads.clientId, retry.clientId),
            ),
          );

        bus.publish({
          type: "lead.lost" as any,
          leadId: retry.leadId,
          clientId: retry.clientId,
        });

        expired++;
        continue;
      }

      // 2b. If attempt < maxAttempts: import and call dialer
      const { dialerAgent } = await import("./dialer");

      const ctx: AgentContext = {
        leadId: retry.leadId,
        clientId: retry.clientId,
        bus,
        store: createRedisStore(),
        log: (msg, data) => console.log(`[retry:${retry.leadId}] ${msg}`, data || ""),
      };

      const dialResult = await dialerAgent.execute(
        {
          leadId: retry.leadId,
          clientId: retry.clientId,
          pitch: undefined,
          attemptNumber: currentAttempt + 1,
        },
        ctx,
      );

      // Increment attempt counter
      const newAttempt = currentAttempt + 1;

      // Handle outcomes
      switch (dialResult.outcome) {
        case "interested":
        case "booked": {
          // Update retryQueue status to 'completed'
          await db
            .update(schema.retryQueue)
            .set({ status: "completed" })
            .where(eq(schema.retryQueue.id, retry.id));

          // Trigger nudge agent
          const { nudgeAgent } = await import("./nudge");
          await nudgeAgent.execute(
            {
              leadId: retry.leadId,
              clientId: retry.clientId,
              callId: dialResult.callId,
              outcome: dialResult.outcome,
              bant: dialResult.bant,
            },
            ctx,
          );

          completed++;
          break;
        }

        case "not_interested": {
          // Update retryQueue status to 'completed'
          await db
            .update(schema.retryQueue)
            .set({ status: "completed" })
            .where(eq(schema.retryQueue.id, retry.id));

          // Update clientLeads status to 'lost'
          await db
            .update(schema.clientLeads)
            .set({ status: "lost" as typeof schema.clientLeads.status.enumValues[number], lostAt: new Date() })
            .where(
              and(
                eq(schema.clientLeads.leadId, retry.leadId),
                eq(schema.clientLeads.clientId, retry.clientId),
              ),
            );

          completed++;
          break;
        }

        case "no_answer":
        case "failed": {
          // Calculate next retry time based on current attempt
          const delay = RETRY_DELAYS[currentAttempt] || RETRY_DELAYS[3];
          const nextAttemptAt = new Date(Date.now() + delay);

          // Update current retryQueue row to 'processed'
          await db
            .update(schema.retryQueue)
            .set({ status: "processed" })
            .where(eq(schema.retryQueue.id, retry.id));

          // Insert new retryQueue row with next attempt
          await db.insert(schema.retryQueue).values({
            id: randomUUID(),
            leadId: retry.leadId,
            clientId: retry.clientId,
            callId: dialResult.callId,
            attempt: newAttempt,
            reason: dialResult.outcome,
            nextAttemptAt,
            maxAttempts,
            status: "pending",
          });

          retried++;
          break;
        }

        case "picked_no_response": {
          // Update retryQueue status to 'completed'
          await db
            .update(schema.retryQueue)
            .set({ status: "completed" })
            .where(eq(schema.retryQueue.id, retry.id));

          // Trigger nudge with picked_no_response handling
          const { nudgeAgent } = await import("./nudge");
          await nudgeAgent.execute(
            {
              leadId: retry.leadId,
              clientId: retry.clientId,
              callId: dialResult.callId,
              outcome: "picked_no_response",
              bant: dialResult.bant,
            },
            ctx,
          );

          completed++;
          break;
        }

        default: {
          // Unknown outcome: treat as failed, schedule next retry
          const delay = RETRY_DELAYS[currentAttempt] || RETRY_DELAYS[3];
          const nextAttemptAt = new Date(Date.now() + delay);

          await db
            .update(schema.retryQueue)
            .set({ status: "processed" })
            .where(eq(schema.retryQueue.id, retry.id));

          await db.insert(schema.retryQueue).values({
            id: randomUUID(),
            leadId: retry.leadId,
            clientId: retry.clientId,
            callId: dialResult.callId,
            attempt: newAttempt,
            reason: dialResult.outcome,
            nextAttemptAt,
            maxAttempts,
            status: "pending",
          });

          retried++;
          break;
        }
      }
    } catch (err) {
      console.error(`[retry-scheduler] Error processing retry ${retry.id}:`, err);
      // Don't update status — retry will be picked up on next poll
    }
  }

  return { expired, retried, completed };
}
