import { z } from "zod";

const optional = z.preprocess((value) =>
  typeof value === "string" && !value.trim() ? undefined : value,
z.string().trim().min(1).optional());

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().refine((value) => /^postgres(?:ql)?:\/\//.test(value), "must use a PostgreSQL protocol"),
  REDIS_URL: z.string().url().refine((value) => /^rediss?:\/\//.test(value), "must use a Redis protocol"),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  GEMINI_API_KEY: optional,
  APP_SECRET: optional,
  VOBIZ_API_URL: z.string().url().default("https://api.vobiz.in/v1"),
  VOBIZ_API_KEY: optional,
  VOBIZ_FROM_NUMBER: optional,
  VOBIZ_WEBHOOK_SECRET: optional,
  WHATSAPP_WEBHOOK_SECRET: optional,
  GMAIL_WEBHOOK_SECRET: optional,
  ALLOW_IN_MEMORY_FALLBACK: z.enum(["true", "false"]).optional(),
  LLM_MODEL: optional,
  LLM_TEMPERATURE: z.preprocess((v) => (typeof v === "string" && v.trim() ? Number(v) : v), z.number().min(0).max(2).optional()),
  LLM_MAX_TOKENS: z.preprocess((v) => (typeof v === "string" && v.trim() ? Number(v) : v), z.number().int().min(1).max(8192).optional()),
  LLM_RETRIES: z.preprocess((v) => (typeof v === "string" && v.trim() ? Number(v) : v), z.number().int().min(0).max(10).optional()),
  LLM_TIMEOUT_MS: z.preprocess((v) => (typeof v === "string" && v.trim() ? Number(v) : v), z.number().int().min(1000).max(120000).optional()),
  LLM_RATE_LIMIT_DELAY_MS: z.preprocess((v) => (typeof v === "string" && v.trim() ? Number(v) : v), z.number().int().min(100).max(60000).optional()),
}).superRefine((environment, context) => {
  if (environment.NODE_ENV !== "production") return;
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
  if (isBuildPhase) return;
  for (const name of ["APP_SECRET", "VOBIZ_API_KEY", "VOBIZ_FROM_NUMBER", "VOBIZ_WEBHOOK_SECRET"] as const) {
    if (!environment[name]) context.addIssue({ code: z.ZodIssueCode.custom, path: [name], message: "is required in production" });
  }
  if (environment.APP_SECRET === "aarambhai-dev-secret-change-in-production" || environment.APP_SECRET?.startsWith("change-this")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["APP_SECRET"], message: "must not be a development placeholder" });
  }
  if (environment.ALLOW_IN_MEMORY_FALLBACK === "true") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["ALLOW_IN_MEMORY_FALLBACK"], message: "cannot be enabled in production" });
  }
});

export function parseServerConfig(input: Record<string, string | undefined>) {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid server configuration: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`).join("; ")}`);
  }
  const environment = parsed.data;

  return Object.freeze({
    nodeEnv: environment.NODE_ENV,
    isProduction: environment.NODE_ENV === "production",
    databaseUrl: environment.DATABASE_URL,
    redisUrl: environment.REDIS_URL,
    appUrl: environment.NEXT_PUBLIC_APP_URL.replace(/\/$/, ""),
    allowInMemoryFallback: environment.NODE_ENV !== "production" && environment.ALLOW_IN_MEMORY_FALLBACK !== "false",
    geminiApiKey: environment.GEMINI_API_KEY,
    llm: Object.freeze({
      model: environment.LLM_MODEL || "gemini-2.0-flash",
      temperature: environment.LLM_TEMPERATURE ?? 0.3,
      maxTokens: environment.LLM_MAX_TOKENS ?? 2048,
      retries: environment.LLM_RETRIES ?? 2,
      timeoutMs: environment.LLM_TIMEOUT_MS ?? 30000,
      rateLimitDelayMs: environment.LLM_RATE_LIMIT_DELAY_MS ?? 1000,
    }),
    vobiz: Object.freeze({
      apiUrl: environment.VOBIZ_API_URL.replace(/\/$/, ""),
      apiKey: environment.VOBIZ_API_KEY,
      fromNumber: environment.VOBIZ_FROM_NUMBER,
      webhookSecret: environment.VOBIZ_WEBHOOK_SECRET,
    }),
    webhooks: Object.freeze({
      vobizSecret: environment.VOBIZ_WEBHOOK_SECRET,
      whatsappSecret: environment.WHATSAPP_WEBHOOK_SECRET,
      gmailSecret: environment.GMAIL_WEBHOOK_SECRET,
    }),
  });
}
