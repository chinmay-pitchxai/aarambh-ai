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

// ── Deep chainable mock builder ──────────────────────────────────────────────
// Creates a proxy-like object where any method call returns itself, and the
// terminal promise resolves to `result`. This handles arbitrary drizzle chains
// like `.select().from().where().orderBy().limit().offset()`.
function createDeepChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === Symbol.toPrimitive || prop === "then" || prop === "catch" || prop === "finally") {
        // Make it thenable so await works — resolves to `result`
        return undefined;
      }
      if (prop === "then") {
        return undefined;
      }
      return (..._args: unknown[]) => chain;
    },
  };
  // Make it thenable
  const p = new Proxy(chain, handler);
  // Override so await resolves to result
  (chain as unknown as { then: (resolve: (v: unknown) => unknown) => unknown }).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  (chain as unknown as { [Symbol.toPrimitive]: () => unknown })[Symbol.toPrimitive] = () => result;
  // Make every method return the chain itself, but terminal awaits resolve to result
  const methods = [
    "from", "where", "limit", "offset", "orderBy", "returning",
    "values", "set", "onConflictDoUpdate", "innerJoin", "leftJoin",
    "grouping", "having", "as",
  ];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  return chain;
}

// ── Query-builder helpers ────────────────────────────────────────────────────

// db.select().from(t).where(cond).limit(n) resolves to `rows` on every call.
export function mockSelectReturning(rows: unknown[]) {
  const chain = createDeepChain(rows);
  mockDb.select.mockReturnValue(chain);
}

// db.select() calls consume results in order: each query resolves to the next
// entry of `rowsByCall`. Needed when an agent runs multiple selects in one run.
export function mockSelectSequential(rowsByCall: unknown[][]) {
  let call = 0;
  mockDb.select.mockImplementation(() => {
    const result = rowsByCall[call++] ?? [];
    const chain = createDeepChain(result);
    return chain;
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
