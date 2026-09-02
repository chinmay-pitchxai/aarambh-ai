import { serverConfig } from "../config";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.0-flash";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-004";

const responseCache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY environment variable is required");
  return key;
}

function cacheKey(prefix: string, input: string): string {
  return `${prefix}:${input}`;
}

function getCached<T>(key: string): T | null {
  const entry = responseCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: unknown): void {
  if (responseCache.size > 500) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey) responseCache.delete(oldestKey);
  }
  responseCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function stripFence(s: string): string {
  return s.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
}

function getTemperature(override?: number): number {
  if (override !== undefined) return Math.max(0, Math.min(2, override));
  const configTemp = serverConfig.llm?.temperature;
  return configTemp !== undefined ? configTemp : 0.3;
}

function getMaxTokens(override?: number): number {
  if (override !== undefined) return Math.max(1, Math.min(8192, override));
  const configTokens = serverConfig.llm?.maxTokens;
  return configTokens !== undefined ? configTokens : 2048;
}

function getRetries(): number {
  return serverConfig.llm?.retries ?? 2;
}

function getTimeoutMs(): number {
  return serverConfig.llm?.timeoutMs ?? 30000;
}

function getRateLimitDelay(): number {
  return serverConfig.llm?.rateLimitDelayMs ?? 1000;
}

async function callGeminiApi(
  body: Record<string, unknown>,
  retries?: number,
): Promise<Record<string, unknown>> {
  const apiKey = getApiKey();
  const maxRetries = retries ?? getRetries();
  const timeoutMs = getTimeoutMs();
  const rateLimitDelay = getRateLimitDelay();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${GEMINI_BASE_URL}/models/${DEFAULT_MODEL}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After");
        const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : rateLimitDelay * (attempt + 1);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw new Error("Gemini API rate limit exceeded after retries");
      }

      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        throw new Error(`Gemini API ${res.status}: ${detail}`);
      }

      const data = await res.json();
      return data;
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const isRetryable = error instanceof Error && (
        error.name === "AbortError" || error.message.includes("fetch")
      );
      if (!isRetryable) throw error;
      await new Promise((r) => setTimeout(r, rateLimitDelay * (attempt + 1)));
    }
  }
  throw new Error("Gemini unreachable");
}

export interface GenerateTextOptions {
  temperature?: number;
  maxTokens?: number;
  systemInstruction?: string;
  useCache?: boolean;
}

export async function generateText(prompt: string, options?: GenerateTextOptions): Promise<string> {
  const effectiveOptions = options ?? {};
  const cacheEnabled = effectiveOptions.useCache !== false;

  if (cacheEnabled) {
    const cached = getCached<string>(cacheKey("text", `${prompt}:${effectiveOptions.temperature}:${effectiveOptions.maxTokens}`));
    if (cached) return cached;
  }

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: getTemperature(effectiveOptions.temperature),
      maxOutputTokens: getMaxTokens(effectiveOptions.maxTokens),
    },
  };

  if (effectiveOptions.systemInstruction) {
    body.systemInstruction = { parts: [{ text: effectiveOptions.systemInstruction }] };
  }

  const data = await callGeminiApi(body);
  const candidates = data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
  const text = candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  if (cacheEnabled && text) {
    setCache(cacheKey("text", `${prompt}:${effectiveOptions.temperature}:${effectiveOptions.maxTokens}`), text);
  }

  return text;
}

export interface GenerateStructuredOptions extends GenerateTextOptions {
  schemaHint?: string;
}

export async function generateStructured<T = unknown>(
  prompt: string,
  options?: GenerateStructuredOptions,
): Promise<T> {
  const effectiveOptions = options ?? {};
  const structuredPrompt = effectiveOptions.schemaHint
    ? `${prompt}\n\nRespond ONLY with valid JSON matching this structure: ${effectiveOptions.schemaHint}`
    : `${prompt}\n\nRespond ONLY with valid JSON. No markdown fences, no explanation.`;

  const raw = await generateText(structuredPrompt, {
    ...effectiveOptions,
    useCache: false,
  });

  const cleaned = stripFence(raw);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`Failed to parse structured response: ${cleaned.slice(0, 200)}`);
  }
}

export interface EmbeddingResult {
  embedding: number[];
}

export async function embedText(text: string): Promise<number[]> {
  const cacheEntry = cacheKey("embed", text);
  const cached = getCached<number[]>(cacheEntry);
  if (cached) return cached;

  const apiKey = getApiKey();
  const res = await fetch(`${GEMINI_BASE_URL}/models/${DEFAULT_EMBEDDING_MODEL}:embedContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${DEFAULT_EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
    }),
    signal: AbortSignal.timeout(getTimeoutMs()),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Gemini embedding API ${res.status}: ${detail}`);
  }

  const data = await res.json();
  const embedding = data.embedding?.values;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Invalid embedding response from Gemini API");
  }

  setCache(cacheEntry, embedding);
  return embedding;
}

export function clearCache(): void {
  responseCache.clear();
}

export const llm = {
  generateText,
  generateStructured,
  embedText,
  clearCache,
};
