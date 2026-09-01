export interface LeadInsightInput {
  lead: { firstName?: string | null; company?: string | null; title?: string | null; status?: string | null; band?: string | null };
  calls: Array<{ outcome?: string | null; summary?: string | null; sentiment?: string | null; bant?: unknown; startedAt?: Date | string | null }>;
  messages: Array<{ direction?: string | null; body?: string | null; sentAt?: Date | string | null }>;
}

export interface LeadInsights {
  summary: string;
  nextStep: { title: string; reason: string; action: string };
  generatedBy: "ai" | "rules";
}

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

function fallbackInsights(input: LeadInsightInput): LeadInsights {
  const name = input.lead.firstName || "This lead";
  const latestCall = input.calls[0];
  const latestMessage = input.messages[0];
  const interactionCount = input.calls.length + input.messages.length;

  let summary = `${name} is a ${input.lead.band || "new"} lead${input.lead.title ? ` working as ${input.lead.title}` : ""}${input.lead.company ? ` at ${input.lead.company}` : ""}.`;
  if (latestCall?.summary) summary = `${summary} Latest call: ${latestCall.summary}`;
  else if (latestMessage?.body) summary = `${summary} Latest message: ${latestMessage.body.slice(0, 180)}`;
  else summary = `${summary} There has been no outreach yet.`;

  if (input.lead.status === "qualified" || latestCall?.outcome === "booked") {
    return { summary, nextStep: { title: "Confirm the meeting", reason: "The lead is qualified and has moved to a booked outcome.", action: "Send the calendar confirmation and a short agenda, then schedule the reminder call." }, generatedBy: "rules" };
  }
  if (latestCall?.outcome === "not_interested" || input.lead.status === "parked" || input.lead.status === "dnc") {
    return { summary, nextStep: { title: "Pause outreach", reason: "The most recent outcome indicates low intent or an opt-out.", action: "Move the lead to parked/DNC and only re-engage when a valid future trigger is recorded." }, generatedBy: "rules" };
  }
  if (latestCall?.outcome === "no_answer" || latestCall?.outcome === "failed") {
    return { summary, nextStep: { title: "Send a short follow-up", reason: "The call did not connect, so a lower-friction touch is the best next action.", action: "Send a WhatsApp or email explaining the reason for the call and retry in 24 hours." }, generatedBy: "rules" };
  }
  if (latestMessage?.direction === "inbound") {
    return { summary, nextStep: { title: "Reply while intent is fresh", reason: "The lead sent the most recent message.", action: "Answer their question, confirm the key need, and offer two meeting times." }, generatedBy: "rules" };
  }
  if (interactionCount === 0) {
    return { summary, nextStep: { title: "Start discovery", reason: "No interaction history exists yet.", action: "Call with a 30-second role-specific opener and ask one question about their current pain point." }, generatedBy: "rules" };
  }
  return { summary, nextStep: { title: "Continue qualification", reason: "There is engagement, but the buying path is not yet confirmed.", action: "Follow up on the latest discussion and confirm need, decision authority, budget, and timing." }, generatedBy: "rules" };
}

function stripFence(value: string) {
  return value.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
}

export async function generateLeadInsights(input: LeadInsightInput): Promise<LeadInsights> {
  const fallback = fallbackInsights(input);
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || (input.calls.length === 0 && input.messages.length === 0)) return fallback;

  const compactContext = {
    lead: input.lead,
    calls: input.calls.slice(0, 5).map((call) => ({ outcome: call.outcome, summary: call.summary, sentiment: call.sentiment, bant: call.bant })),
    messages: input.messages.slice(0, 5).map((message) => ({ direction: message.direction, body: message.body?.slice(0, 400) })),
  };

  try {
    const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `You are a B2B sales copilot. Summarize the lead history and recommend exactly one concrete next step. Use only the supplied facts. Return strict JSON: {"summary":"2-3 concise sentences","nextStep":{"title":"short title","reason":"one sentence","action":"one specific action"}}.\n\n${JSON.stringify(compactContext)}` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 500, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return fallback;
    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return fallback;
    const parsed = JSON.parse(stripFence(raw));
    if (!parsed.summary || !parsed.nextStep?.title || !parsed.nextStep?.reason || !parsed.nextStep?.action) return fallback;
    return { summary: parsed.summary, nextStep: parsed.nextStep, generatedBy: "ai" };
  } catch (error) {
    console.warn("[lead-insights] AI generation failed; using deterministic guidance", error);
    return fallback;
  }
}
