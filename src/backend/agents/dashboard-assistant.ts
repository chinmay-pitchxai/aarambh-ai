import {
  getLeadStats,
  getCallStats,
  getMeetingStats,
  getRecentActivity,
  getLeadDetails,
} from "./dashboard-tools";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

type ToolName =
  | "getLeadStats"
  | "getCallStats"
  | "getMeetingStats"
  | "getRecentActivity"
  | "getLeadDetails";

interface ToolCall {
  name: ToolName;
  args: Record<string, unknown>;
}

interface AssistantResponse {
  response: string;
  data?: Record<string, unknown>;
}

function stripFence(s: string): string {
  return s.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
}

const SYSTEM_PROMPT = `You are a dashboard assistant for AarambhAI, a B2B sales pipeline platform. You help users understand their sales data by querying real tools that return actual data from their database.

AVAILABLE TOOLS:
1. getLeadStats() — Returns lead counts by status and band, plus hot lead details
2. getCallStats() — Returns call counts, outcomes, avg duration, recent calls
3. getMeetingStats() — Returns meeting counts, upcoming meetings, status breakdown
4. getRecentActivity(limit?) — Returns recent calls and messages (default 10)
5. getLeadDetails(leadId) — Returns details for a specific lead

RULES:
- ALWAYS call a tool to get real data. NEVER make up numbers or facts.
- You may call multiple tools in parallel if the question needs data from multiple sources.
- Respond in a conversational, helpful tone.
- Keep answers concise but informative.
- If a question is ambiguous, ask for clarification.
- If the user asks something unrelated to dashboard data, politely redirect them.
- Format numbers with commas for readability.

When you need to call tools, respond with ONLY a JSON object in this exact format:
{"toolCalls": [{"name": "toolName", "args": {}}]}

When you have the data and want to respond to the user, respond normally with text.
Do NOT include tool call JSON in your final text response.`;

async function callGemini(
  messages: Array<{ role: string; parts: Array<{ text: string }> }>,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: messages,
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function executeTool(
  name: ToolName,
  args: Record<string, unknown>,
  tenantId: string,
): Promise<unknown> {
  switch (name) {
    case "getLeadStats":
      return getLeadStats(tenantId);
    case "getCallStats":
      return getCallStats(tenantId);
    case "getMeetingStats":
      return getMeetingStats(tenantId);
    case "getRecentActivity":
      return getRecentActivity(tenantId, (args.limit as number) || 10);
    case "getLeadDetails":
      return getLeadDetails(tenantId, args.leadId as string);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function parseToolCalls(text: string): ToolCall[] | null {
  const cleaned = stripFence(text);
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.toolCalls && Array.isArray(parsed.toolCalls)) {
      return parsed.toolCalls.map((tc: ToolCall) => ({
        name: tc.name,
        args: tc.args || {},
      }));
    }
  } catch {
    // Not JSON, not tool calls
  }
  return null;
}

export async function askDashboardAssistant(
  message: string,
  tenantId: string,
  chatHistory: Array<{ role: string; content: string }> = [],
): Promise<AssistantResponse> {
  const messages: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  // Build conversation history
  for (const msg of chatHistory.slice(-10)) {
    messages.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    });
  }

  // Add user message
  messages.push({ role: "user", parts: [{ text: message }] });

  // Call LLM — may request tool calls
  let llmResponse = await callGemini(messages);
  const toolCalls = parseToolCalls(llmResponse);

  // If tool calls detected, execute them and re-prompt
  if (toolCalls && toolCalls.length > 0) {
    const toolResults: string[] = [];

    for (const tc of toolCalls) {
      try {
        const result = await executeTool(tc.name, tc.args, tenantId);
        toolResults.push(`Tool "${tc.name}" returned:\n${JSON.stringify(result, null, 2)}`);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        toolResults.push(`Tool "${tc.name}" failed: ${errMsg}`);
      }
    }

    // Add tool results to conversation
    messages.push({
      role: "model",
      parts: [{ text: llmResponse }],
    });
    messages.push({
      role: "user",
      parts: [
        {
          text: `Here are the tool results:\n\n${toolResults.join("\n\n")}\n\nNow respond to the user's original question using this data. Be concise and helpful.`,
        },
      ],
    });

    llmResponse = await callGemini(messages);

    // Second pass: check for additional tool calls
    const secondToolCalls = parseToolCalls(llmResponse);
    if (secondToolCalls && secondToolCalls.length > 0) {
      const secondResults: string[] = [];
      for (const tc of secondToolCalls) {
        try {
          const result = await executeTool(tc.name, tc.args, tenantId);
          secondResults.push(`Tool "${tc.name}" returned:\n${JSON.stringify(result, null, 2)}`);
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          secondResults.push(`Tool "${tc.name}" failed: ${errMsg}`);
        }
      }
      messages.push({ role: "model", parts: [{ text: llmResponse }] });
      messages.push({
        role: "user",
        parts: [
          {
            text: `Additional tool results:\n\n${secondResults.join("\n\n")}\n\nNow provide your final answer.`,
          },
        ],
      });
      llmResponse = await callGemini(messages);
    }

    return { response: llmResponse.trim() };
  }

  return { response: llmResponse.trim() };
}
