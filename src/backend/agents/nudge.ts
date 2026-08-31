import type { Agent, AgentContext, NudgeInput, NudgeOutput } from "./types";
import { db, schema } from "../db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

// ── Nudge Agent ──
// WhatsApp Business API + Gmail OAuth
// Sends info, handles query, meeting link, follow-up templates

const WA_API = "https://graph.facebook.com/v19.0";
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WA_TOKEN = process.env.WHATSAPP_API_TOKEN;

async function sendWhatsApp(phoneE164: string, templateName: string, params: string[]): Promise<string | null> {
  if (!WA_PHONE_ID || !WA_TOKEN) {
    console.log(`[WA-STUB] To: ${phoneE164}, Template: ${templateName}`);
    return `wa-stub-${randomUUID().slice(0, 8)}`;
  }

  const res = await fetch(`${WA_API}/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phoneE164,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en" },
        components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }],
      },
    }),
  });

  if (!res.ok) {
    console.error(`WA send failed: ${res.status}`);
    return null;
  }
  const data = await res.json();
  return data.messages?.[0]?.id || null;
}

async function sendGmail(to: string, subject: string, body: string): Promise<string | null> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !refreshToken) {
    console.log(`[GMAIL-STUB] To: ${to}, Subject: ${subject}`);
    return `gmail-stub-${randomUUID().slice(0, 8)}`;
  }

  // TODO: implement real Gmail API with OAuth token refresh
  return null;
}

const TEMPLATES = {
  tried_reaching: "tried_reaching_v1",
  info_send: "info_send_v1",
  meeting_link: "meeting_link_v1",
  follow_up: "follow_up_v1",
};

export const nudgeAgent: Agent<NudgeInput, NudgeOutput> = {
  name: "nudge",

  async execute(input, ctx) {
    const { leadId, clientId, callId, outcome, bant } = input;
    ctx.log("nudge start", { leadId, outcome });

    // fetch lead
    const [lead] = await db
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, leadId))
      .limit(1);

    if (!lead) throw new Error(`Lead ${leadId} not found`);

    let messagesSent = 0;
    let meetingBooked = false;

    switch (outcome) {
      case "no_answer":
      case "failed": {
        // Send "tried reaching" WhatsApp
        const waId = await sendWhatsApp(
          lead.phoneE164,
          TEMPLATES.tried_reaching,
          [lead.firstName || "there"],
        );
        if (waId) messagesSent++;

        // Store message
        await db.insert(schema.messages).values({
          id: randomUUID(),
          leadId,
          clientId,
          callId,
          channel: "whatsapp",
          direction: "outbound",
          body: `Tried reaching you, ${lead.firstName || "not able to connect"}. Will call again in 24 hours.`,
          waMessageId: waId,
        });
        break;
      }

      case "interested": {
        // Send info + meeting link
        const waId = await sendWhatsApp(
          lead.phoneE164,
          TEMPLATES.info_send,
          [lead.firstName || "there", lead.company || "your team"],
        );
        if (waId) messagesSent++;

        // Also email
        let gmailId: string | null = null;
        if (lead.email) {
          gmailId = await sendGmail(
            lead.email,
            "AarambhAI — Following up on our conversation",
            `Hi ${lead.firstName || ""},\n\nThanks for your interest. Here's the information we discussed.\n\nBook a meeting: ${process.env.NEXT_PUBLIC_APP_URL}/book/${leadId}`,
          );
          if (gmailId) messagesSent++;
        }

        // Store messages — whatsapp + gmail separately
        await db.insert(schema.messages).values({
          id: randomUUID(),
          leadId,
          clientId,
          callId,
          channel: "whatsapp",
          direction: "outbound",
          body: `Info sent + meeting link for ${lead.company || "company"}`,
          waMessageId: waId,
        });
        if (gmailId) {
          await db.insert(schema.messages).values({
            id: randomUUID(),
            leadId,
            clientId,
            callId,
            channel: "gmail",
            direction: "outbound",
            body: `Email sent to ${lead.email}`,
            gmailThreadId: gmailId,
          });
        }
        break;
      }

      case "booked": {
        // Send meeting confirmation
        const waId = await sendWhatsApp(
          lead.phoneE164,
          TEMPLATES.meeting_link,
          [lead.firstName || "there"],
        );
        if (waId) messagesSent++;
        meetingBooked = true;

        await db.insert(schema.messages).values({
          id: randomUUID(),
          leadId,
          clientId,
          callId,
          channel: "whatsapp",
          direction: "outbound",
          body: "Meeting booked, confirmation sent",
          waMessageId: waId,
        });
        break;
      }

      case "not_interested": {
        ctx.log("nudge not_interested — no follow-up, parked");
        break;
      }

      default: {
        ctx.log("nudge unknown outcome", { outcome });
        break;
      }
    }

    ctx.bus.publish({ type: "message.sent", leadId, clientId, channel: "whatsapp" });

    return { messagesSent, meetingBooked };
  },
};
