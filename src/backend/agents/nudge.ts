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

async function sendWhatsApp(phoneE164: string | null, templateName: string, params: string[]): Promise<string | null> {
  if (!phoneE164) return null;
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

async function refreshGmailToken(): Promise<string> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Gmail OAuth env vars missing");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) throw new Error(`Gmail token refresh failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function sendGmail(to: string, subject: string, htmlBody: string): Promise<string | null> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    console.log(`[GMAIL-STUB] To: ${to}, Subject: ${subject}`);
    return `gmail-stub-${randomUUID().slice(0, 8)}`;
  }

  try {
    const accessToken = await refreshGmailToken();

    const mimeMessage = [
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "",
      htmlBody,
    ].join("\r\n");

    const encodedMessage = Buffer.from(mimeMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encodedMessage }),
    });

    if (!res.ok) {
      console.error(`Gmail send failed: ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.id || null;
  } catch (err) {
    console.error("Gmail send error:", err);
    return null;
  }
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
        const waId = await sendWhatsApp(
          lead.phoneE164,
          TEMPLATES.tried_reaching,
          [lead.firstName || "there"],
        );
        if (waId) messagesSent++;

        await db.insert(schema.messages).values({
          id: randomUUID(),
          leadId,
          clientId,
          callId,
          channel: "whatsapp",
          direction: "outbound",
          body: `Tried reaching you, ${lead.firstName || "not able to connect"}. Will call again in 24 hours.`,
          waMessageId: waId,
          templateName: TEMPLATES.tried_reaching,
        });
        break;
      }

      case "picked_no_response": {
        // Send WA info template with product details
        const waId = await sendWhatsApp(
          lead.phoneE164,
          TEMPLATES.info_send,
          [lead.firstName || "there", lead.company || "your team"],
        );
        if (waId) messagesSent++;

        // Send Gmail with full product info
        let gmailId: string | null = null;
        if (lead.email) {
          const productHtml = `
            <h2>AarambhAI - Product Information</h2>
            <p>Hi ${lead.firstName || ""},</p>
            <p>We tried reaching you over a call. Since you weren't available, here's some information about what we offer:</p>
            <ul>
              <li>AI-powered lead qualification</li>
              <li>Automated follow-up sequences</li>
              <li>Real-time conversation analytics</li>
            </ul>
            <p>Book a quick demo: <a href="${process.env.NEXT_PUBLIC_APP_URL}/book/${leadId}">Schedule Meeting</a></p>
          `;
          gmailId = await sendGmail(
            lead.email,
            "AarambhAI — Here's the information we discussed",
            productHtml,
          );
          if (gmailId) messagesSent++;
        }

        await db.insert(schema.messages).values({
          id: randomUUID(),
          leadId,
          clientId,
          callId,
          channel: "whatsapp",
          direction: "outbound",
          body: `Info sent for ${lead.company || "company"} (picked_no_response follow-up)`,
          waMessageId: waId,
          templateName: TEMPLATES.info_send,
        });
        if (gmailId) {
          await db.insert(schema.messages).values({
            id: randomUUID(),
            leadId,
            clientId,
            callId,
            channel: "gmail",
            direction: "outbound",
            body: `Product info email sent to ${lead.email}`,
            gmailThreadId: gmailId,
          });
        }
        break;
      }

      case "interested": {
        const waId = await sendWhatsApp(
          lead.phoneE164,
          TEMPLATES.info_send,
          [lead.firstName || "there", lead.company || "your team"],
        );
        if (waId) messagesSent++;

        let gmailId: string | null = null;
        if (lead.email) {
          const interestHtml = `
            <h2>AarambhAI — Thanks for your interest!</h2>
            <p>Hi ${lead.firstName || ""},</p>
            <p>Thanks for your interest. Here's the information we discussed.</p>
            <p>Book a meeting: <a href="${process.env.NEXT_PUBLIC_APP_URL}/book/${leadId}">Schedule Meeting</a></p>
          `;
          gmailId = await sendGmail(
            lead.email,
            "AarambhAI — Following up on our conversation",
            interestHtml,
          );
          if (gmailId) messagesSent++;
        }

        await db.insert(schema.messages).values({
          id: randomUUID(),
          leadId,
          clientId,
          callId,
          channel: "whatsapp",
          direction: "outbound",
          body: `Info sent + meeting link for ${lead.company || "company"}`,
          waMessageId: waId,
          templateName: TEMPLATES.info_send,
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
          templateName: TEMPLATES.meeting_link,
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

    // Only publish if messages were actually sent
    if (messagesSent > 0) {
      ctx.bus.publish({ type: "message.sent", leadId, clientId, channel: "whatsapp" });
    }

    return { messagesSent, meetingBooked };
  },
};
