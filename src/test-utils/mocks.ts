import { vi } from "vitest";
import * as schema from "../backend/db/schema";

// ── DB mock ──────────────────────────────────────────────────────────────────
// Chainable vi.fn stubs for the drizzle-js `db` surface actually used by
// production code (select/insert/update/delete + relational `query` helpers).
export const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  query: {
    sessions: { findFirst: vi.fn() },
    users: { findFirst: vi.fn() },
    organizations: { findFirst: vi.fn() },
    organizationMembers: { findFirst: vi.fn() },
    leads: { findFirst: vi.fn() },
    clientLeads: { findFirst: vi.fn() },
    consent: { findFirst: vi.fn() },
    businessProfiles: { findFirst: vi.fn() },
    promptTemplates: { findFirst: vi.fn() },
  },
};

// The real schema object is safe to share: table definitions are inert and only
// used as identifiers for the mocked query builders.
export const mockSchema = schema;

// ── Redis mock (ioredis surface) ─────────────────────────────────────────────
export const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  zadd: vi.fn(),
  zpopmin: vi.fn(),
  zrange: vi.fn(),
  zcard: vi.fn(),
  hset: vi.fn(),
  hdel: vi.fn(),
  hlen: vi.fn(),
  hkeys: vi.fn(),
  pipeline: vi.fn(() => ({
    zadd: vi.fn(),
    set: vi.fn(),
    hset: vi.fn(),
    hdel: vi.fn(),
    exec: vi.fn().mockResolvedValue([]),
  })),
  duplicate: vi.fn(),
};

// ── Durable queue mock (src/backend/queue/durable-queue.ts interface) ───────
export const mockQueue = {
  enqueue: vi.fn(),
  acquireLease: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  extendLease: vi.fn(),
  moveToDlq: vi.fn(),
  getJob: vi.fn(),
  getStats: vi.fn(),
  listJobs: vi.fn(),
  cancelJob: vi.fn(),
  requeueJob: vi.fn(),
};

// ── Cookie store mock (next/headers `cookies()`) ─────────────────────────────
export const mockCookieStore = {
  get: vi.fn<(name: string) => { value: string } | undefined>(),
  set: vi.fn<(name: string, value: string, options?: Record<string, unknown>) => void>(),
  delete: vi.fn<(name: string) => void>(),
};

// ── Query-builder helpers ────────────────────────────────────────────────────

// db.select().from(t).where(cond).limit(n) resolves to `rows` on every call.
export function mockSelectReturning(rows: unknown[]) {
  mockDb.select.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

// db.select() calls consume results in order: each query resolves to the next
// entry of `rowsByCall`. Needed when an agent runs multiple selects in one run
// (e.g. consent agent: leads row, then consent row).
export function mockSelectSequential(rowsByCall: unknown[][]) {
  let call = 0;
  mockDb.select.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: vi.fn().mockImplementation(() => Promise.resolve(rowsByCall[call++] ?? [])),
      }),
    }),
  });
}

// db.insert(t).values(...) resolves to undefined.
export function mockInsertResolving() {
  mockDb.insert.mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  });
}

// db.update(t).set(values).where(cond) resolves to undefined.
export function mockUpdateResolving() {
  mockDb.update.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });
}

// db.delete(t).where(cond) resolves to undefined.
export function mockDeleteResolving() {
  mockDb.delete.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });
}
