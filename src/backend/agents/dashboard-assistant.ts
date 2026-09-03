import {
  getLeadStats,
  getCallStats,
  getMeetingStats,
  getRecentActivity,
  getLeadDetails,
  searchApolloLeads,
  generateLeadsFromICPAction,
  initiateCall,
  sendWhatsApp,
  sendEmail,
  bookMeeting,
  analyzeCompany,
  generateICPFromProfile,
  updateLeadStatus,
} from "./dashboard-tools";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

type ToolName =
  | "getLeadStats"
  | "getCallStats"
  | "getMeetingStats"
  | "getRecentActivity"
  | "getLeadDetails"
  | "searchApolloLeads"
  | "generateLeadsFromICP"
  | "initiateCall"
  | "sendWhatsApp"
  | "sendEmail"
  | "bookMeeting"
  | "analyzeCompany"
  | "generateICP"
  | "updateLeadStatus";

interface ToolCall {
  name: ToolName;
  args: Record<string, unknown>;
}

interface AssistantResponse {
  response: string;
  data?: Record<string, unknown>;
  action?: string;
}

function stripFence(s: string): string {
  return s.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
}

const SYSTEM_PROMPT = `You are AarambhAI, a smart B2B sales copilot. You are the central control point for the entire sales platform. Users can talk to you naturally and you will perform the right action.

AVAILABLE TOOLS:

DATA & ANALYTICS:
1. getLeadStats() — Returns lead pipeline stats (counts by status/band, hot leads)
2. getCallStats() — Returns call metrics (today/total calls, outcomes, avg duration, recent calls)
3. getMeetingStats() — Returns meeting metrics (booked today/total, upcoming meetings)
4. getRecentActivity(limit?) — Returns recent calls and messages (default 10)
5. getLeadDetails(leadId) — Returns full details for a specific lead

LEAD GENERATION:
6. searchApolloLeads(query, location?, title?) — Search Apollo for leads matching a query, location, and/or job title
7. generateLeadsFromICP(icp) — Generate leads from an Ideal Customer Profile (JSON with industries, personTitles, seniorities, employeeRanges, locations, keywords)

ACTIONS:
8. initiateCall(leadId, phoneNumber?) — Start a voice call to a lead
9. sendWhatsApp(leadId, message) — Send a WhatsApp message to a lead
10. sendEmail(leadId, subject, body) — Send an email to a lead
11. bookMeeting(leadId, dateTime) — Schedule a meeting with a lead (ISO datetime string)
12. updateLeadStatus(leadId, status) — Update a lead's status (new, contacted, qualified, converted, booked, parked, dnc, lost)

RESEARCH:
13. analyzeCompany(website) — Analyze a company from its website URL
14. generateICP(profile) — Generate an ICP from a company profile (JSON with companyName, website, industry, description, location)

INTENT MAPPING:
- "Analyze acme.com" / "Research company X" → analyzeCompany
- "Find leads for CEO in Bangalore" / "Search for VP Sales" → searchApolloLeads
- "Generate leads from ICP" / "Find leads matching this profile" → generateLeadsFromICP
- "Call John" / "Dial lead 123" → initiateCall
- "Send WhatsApp to lead 123" / "Message lead 123" → sendWhatsApp
- "Email lead 123" / "Send email to lead 123" → sendEmail
- "Book meeting with lead 123" / "Schedule meeting for tomorrow" → bookMeeting
- "What's my conversion rate?" / "Show my stats" → getLeadStats + getCallStats + getMeetingStats
- "Show recent activity" / "What happened today?" → getRecentActivity
- "What's the status of lead 123?" / "Tell me about lead 123" → getLeadDetails
- "Mark lead 123 as qualified" / "Update lead status" → updateLeadStatus
- "Generate ICP for my company" → generateICP

RULES:
- ALWAYS call a tool to get real data or perform real actions. NEVER make up numbers or facts.
- When performing an action (call, message, email, meeting), confirm what you did with specific details.
- You may call multiple tools in parallel if needed.
- Respond in a conversational, helpful tone — like a smart assistant.
- Keep answers concise but informative.
- If a question is ambiguous, ask for clarification.
- Format numbers with commas for readability.
- For leadId references, you can use the lead's name or ID from previous context.

When you need to call tools, respond with ONLY a JSON object in this exact format:
{"toolCalls": [{"name": "toolName", "args": {}}]}

When you have the data and want to respond to the user, respond normally with text.
Do NOT include tool call JSON in your final text response.`;

const MAX_TOOL_ROUNDS = 3;

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

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Gemini API ${res.status}: ${errBody}`);
  }
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
    case "searchApolloLeads":
      return searchApolloLeads(
        tenantId,
        args.query as string,
        args.location as string | undefined,
        args.title as string | undefined,
      );
    case "generateLeadsFromICP":
      return generateLeadsFromICPAction(
        tenantId,
        args.icp as Parameters<typeof generateLeadsFromICPAction>[1],
        (args.batchSize as number) || 10,
      );
    case "initiateCall":
      return initiateCall(
        tenantId,
        args.leadId as string,
        args.phoneNumber as string | undefined,
      );
    case "sendWhatsApp":
      return sendWhatsApp(tenantId, args.leadId as string, args.message as string);
    case "sendEmail":
      return sendEmail(
        tenantId,
        args.leadId as string,
        args.subject as string,
        args.body as string,
      );
    case "bookMeeting":
      return bookMeeting(tenantId, args.leadId as string, args.dateTime as string);
    case "analyzeCompany":
      return analyzeCompany(tenantId, args.website as string);
    case "generateICP":
      return generateICPFromProfile(
        tenantId,
        args.profile as Parameters<typeof generateICPFromProfile>[1],
      );
    case "updateLeadStatus":
      return updateLeadStatus(tenantId, args.leadId as string, args.status as string);
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

function detectAction(tools: ToolCall[]): string | undefined {
  const actionTools = [
    "initiateCall",
    "sendWhatsApp",
    "sendEmail",
    "bookMeeting",
    "analyzeCompany",
    "generateICP",
    "searchApolloLeads",
    "generateLeadsFromICP",
    "updateLeadStatus",
  ];
  const found = tools.find((t) => actionTools.includes(t.name));
  return found?.name;
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

  // Tool loop with max rounds
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let llmResponse: string;
    try {
      llmResponse = await callGemini(messages);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[dashboard-assistant] Gemini call failed:", errMsg);
      return {
        response: `I ran into an issue connecting to the AI service. Please try again in a moment.\n\n(${errMsg})`,
      };
    }

    if (!llmResponse.trim()) {
      return { response: "I received an empty response. Please try again." };
    }

    const toolCalls = parseToolCalls(llmResponse);

    // No tool calls — return the LLM's text response directly
    if (!toolCalls || toolCalls.length === 0) {
      return { response: llmResponse.trim() };
    }

    // Execute each tool call
    const toolResults: string[] = [];
    const allData: Record<string, unknown> = {};

    for (const tc of toolCalls) {
      try {
        const result = await executeTool(tc.name, tc.args, tenantId);
        toolResults.push(
          `Tool "${tc.name}" returned:\n${JSON.stringify(result, null, 2)}`,
        );
        allData[tc.name] = result;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        toolResults.push(`Tool "${tc.name}" failed: ${errMsg}`);
      }
    }

    // Add the model's tool-call message and a user message with results
    messages.push({ role: "model", parts: [{ text: llmResponse }] });
    messages.push({
      role: "user",
      parts: [
        {
          text: `Here are the tool results:\n\n${toolResults.join("\n\n")}\n\nNow respond to the user's original question using this data. Be concise and helpful. If an action was taken (call, message, email, meeting booked), confirm what was done with specific details.`,
        },
      ],
    });

    // If this is the last round and we have tool results, force a text response
    if (round === MAX_TOOL_ROUNDS - 1) {
      messages.push({
        role: "user",
        parts: [{ text: "Please provide your final response to the user now based on all the data above." }],
      });
    }
  }

  // Fallback if tool loop exhausted
  return {
    response:
      "I gathered some data but couldn't finalize a response. Could you try rephrasing your question?",
  };
}
