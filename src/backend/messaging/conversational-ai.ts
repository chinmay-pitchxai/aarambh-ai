import { llm } from "../llm/client";
import {
  getConversationHistory,
  getLeadContext,
  getBusinessRagData,
  getActivePrompt,
} from "./conversation-memory";
import type { Db, MessageChannel } from "./types";

// ── System Prompt Builder ──

function buildSystemPrompt(opts: {
  companyName: string;
  leadName: string;
  ragData: string | null;
  customPrompt: string | null;
}): string {
  const parts: string[] = [
    `You are a friendly sales assistant for ${opts.companyName}.`,
    "Reply naturally, like a human sales rep — not a bot.",
    "Keep replies concise: 2-3 sentences max.",
    "Mirror the language style and tone of the customer.",
    "If you don't know something specific, say you'll check and get back to them.",
    `The person you're speaking to is ${opts.leadName}.`,
  ];

  if (opts.ragData) {
    parts.push(
      "Use this business knowledge to answer questions accurately:",
      opts.ragData,
    );
  }

  if (opts.customPrompt) {
    parts.push("Additional instructions:", opts.customPrompt);
  }

  parts.push(
    "Do not use emojis unless the customer uses them first.",
    "Do not ask more than one question at a time.",
    "Never reveal that you are an AI — respond as a human team member.",
  );

  return parts.join("\n\n");
}

function buildConversationPrompt(
  history: Array<{ direction: string; body: string }>,
  incomingMessage: string,
): string {
  const lines: string[] = [];

  if (history.length > 0) {
    lines.push("Conversation so far:");
    for (const turn of history) {
      const speaker = turn.direction === "inbound" ? "Customer" : "You";
      lines.push(`${speaker}: ${turn.body}`);
    }
    lines.push("");
  }

  lines.push(`Customer just said: "${incomingMessage}"`);
  lines.push("");
  lines.push("Reply as the sales rep:");

  return lines.join("\n");
}

function guessCompanyName(clientId: string): string {
  // Fallback when no business profile is available
  return clientId ? `our company` : `our company`;
}

function guessLeadName(lead: { firstName: string | null; lastName: string | null }): string {
  if (lead.firstName && lead.lastName) return `${lead.firstName} ${lead.lastName}`;
  if (lead.firstName) return lead.firstName;
  if (lead.lastName) return lead.lastName;
  return "there";
}

// ── Public API ──

export interface GenerateReplyInput {
  tenantId: string;
  leadId: string;
  clientId: string;
  channel: MessageChannel;
  incomingMessage: string;
}

export interface GenerateReplyResult {
  reply: string;
  usedRag: boolean;
}

/**
 * Generates a conversational reply for an incoming message.
 *
 * Loads lead context, business knowledge, and conversation history, then
 * sends everything to Gemini to produce a natural, human-like response.
 */
export async function generateReply(
  db: Db,
  input: GenerateReplyInput,
): Promise<GenerateReplyResult> {
  const { leadId, clientId, channel, incomingMessage } = input;

  // 1. Load lead context
  const lead = await getLeadContext(db, { leadId, clientId });

  // 2. Load business RAG data
  const ragData = await getBusinessRagData(db, { clientId });
  const customPrompt = await getActivePrompt(db, { clientId });

  // 3. Load conversation history (last 10 messages)
  const history = await getConversationHistory(db, {
    leadId,
    clientId,
    channel,
    limit: 10,
  });

  // 4. Build prompts
  const companyName = guessCompanyName(clientId);
  const leadName = guessLeadName(lead ?? { firstName: null, lastName: null });

  const systemPrompt = buildSystemPrompt({
    companyName,
    leadName,
    ragData,
    customPrompt,
  });

  const userPrompt = buildConversationPrompt(history, incomingMessage);

  // 5. Call Gemini
  let reply: string;
  try {
    reply = await llm.generateText(userPrompt, {
      systemInstruction: systemPrompt,
      temperature: 0.7,
      maxTokens: 256,
      useCache: false,
    });
  } catch (err) {
    console.error("[conversational-ai] LLM failed:", err);
    reply = fallbackReply(channel);
  }

  // 6. Clean up the reply
  reply = cleanReply(reply);

  // Edge case: empty or too long
  if (!reply || reply.trim().length === 0) {
    reply = fallbackReply(channel);
  }
  if (reply.length > 1000) {
    reply = reply.slice(0, 997) + "...";
  }

  return { reply, usedRag: !!ragData };
}

function fallbackReply(channel: MessageChannel): string {
  if (channel === "whatsapp") {
    return "Thanks for reaching out! Let me check on that and get back to you shortly.";
  }
  return "Thanks for your email. Let me look into that and I'll get back to you soon.";
}

function cleanReply(text: string): string {
  return text
    .replace(/^["']|["']$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
