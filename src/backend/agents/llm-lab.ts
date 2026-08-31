import type { Agent, AgentContext } from "./types";

// ── LLM Lab ──
// Gemini 2.5 Flash: lead analysis, transcript sentiment, pitch generation
// Called by Ranker to enhance scoring, and by Dialer for real-time analysis

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

interface LLMInput {
  action: "score_lead" | "analyze_transcript" | "generate_pitch" | "extract_bant";
  lead?: Record<string, unknown>;
  transcript?: Array<{ role: string; text: string }>;
  previousContext?: string;
  objection?: string;
}

interface LLMOutput {
  score?: number;
  band?: string;
  sentiment?: string;
  summary?: string;
  bant?: { budget: string; authority: string; need: string; timeline: string };
  pitch?: string;
}

function stripFence(s: string): string {
  return s.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
}

async function callGemini(prompt: string, retries = 1): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw new Error("Gemini unreachable");
}

export const llmLabAgent: Agent<LLMInput, LLMOutput> = {
  name: "llm_lab",

  async execute(input, ctx) {
    ctx.log("llm_lab action", { action: input.action });

    switch (input.action) {
      case "analyze_transcript": {
        const transcriptText = (input.transcript || [])
          .map((t) => `${t.role}: ${t.text}`)
          .join("\n");

        const prompt = `Analyze this sales call transcript. Return JSON with:
- sentiment: "positive" | "neutral" | "negative"
- summary: one-line summary
- bant: { budget: "yes/no/unknown", authority: "yes/no/unknown", need: "yes/no/unknown", timeline: "specific/vague/none" }
- objections: array of objections raised

Transcript:
${transcriptText}`;

        const raw = await callGemini(prompt);
        try {
          const parsed = JSON.parse(stripFence(raw));
          return {
            sentiment: parsed.sentiment,
            summary: parsed.summary,
            bant: parsed.bant,
          };
        } catch {
          return { sentiment: "unknown", summary: raw.slice(0, 200) };
        }
      }

      case "generate_pitch": {
        const prompt = `Generate a cold call pitch for:
Company: ${input.lead?.company || "unknown"}
Title: ${input.lead?.title || "unknown"}
Industry: ${input.lead?.industry || "unknown"}
${input.previousContext ? `Previous context: ${input.previousContext}` : ""}
${input.objection ? `Last objection: ${input.objection}` : ""}

Keep it under 30 seconds. Be conversational, not scripted.`;

        const pitch = await callGemini(prompt);
        return { pitch: pitch.trim() };
      }

      case "extract_bant": {
        const transcriptText = (input.transcript || [])
          .map((t) => `${t.role}: ${t.text}`)
          .join("\n");

        const prompt = `Extract BANT from this conversation:
${transcriptText}

Return JSON: { budget: "yes/no/unknown", authority: "yes/no/unknown", need: "yes/no/unknown", timeline: "specific/vague/none" }`;

        const raw = await callGemini(prompt);
        try {
          const parsed = JSON.parse(stripFence(raw));
          return { bant: parsed };
        } catch {
          return { bant: { budget: "unknown", authority: "unknown", need: "unknown", timeline: "unknown" } };
        }
      }

      case "score_lead": {
        const prompt = `Score this lead 1-100 for B2B sales fit:
${JSON.stringify(input.lead, null, 2)}

Return JSON: { score: number, band: "hot"|"warm"|"cold", reasons: string[] }`;

        const raw = await callGemini(prompt);
        try {
          const parsed = JSON.parse(stripFence(raw));
          return { score: parsed.score, band: parsed.band };
        } catch {
          return { score: 50, band: "warm" };
        }
      }

      default:
        return {};
    }
  },
};
