import { beforeEach, vi } from "vitest";

// Deterministic test environment. These must be set before any module that
// imports src/backend/config is evaluated, so the zod config schema passes.
const _env = { ...process.env };
_env.NODE_ENV = "test";
process.env = _env;
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/aarambh_test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.APP_SECRET ??= "test-secret-that-is-at-least-thirty-two-characters";
process.env.ALLOW_IN_MEMORY_FALLBACK ??= "false";

// Mock the module graph: src/backend/db, next/headers and next/server are
// replaced with the shared singletons in ./mocks so no real connection or Next
// runtime is ever needed. Async factories keep hoisting safe — dependencies are
// loaded lazily when the mocked module is first imported.
vi.mock("../backend/db", async () => {
  const { mockDb, mockSchema } = await import("./mocks");
  return { db: mockDb, schema: mockSchema };
});

vi.mock("next/headers", async () => {
  const { mockCookieStore } = await import("./mocks");
  return { cookies: () => mockCookieStore };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    })),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});