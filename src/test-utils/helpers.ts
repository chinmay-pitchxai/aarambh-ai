import { mockDb, mockQueue, mockRedis } from "./mocks";

export interface TestContext {
  db: typeof mockDb;
  redis: typeof mockRedis;
  queue: typeof mockQueue;
}

/**
 * Returns the shared mocked providers wired up by src/test-utils/setup.ts.
 * The returned objects are the singletons every test file configures and
 * asserts against.
 */
export function createTestContext(): TestContext {
  return { db: mockDb, redis: mockRedis, queue: mockQueue };
}
