import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { randomUUID } from "node:crypto";
import type { BaseCheckpointSaver } from "@langchain/langgraph";

export interface PostgresCheckpointerConfig {
  connectionString: string;
  schema: string;
  runSetup: boolean;
}

export interface ThreadRecord {
  threadId: string;
  tenantId: string;
  graphName: string;
  status: "active" | "paused" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  checkpointSeq: number;
  metadata: Record<string, unknown>;
}

export async function createPostgresCheckpointer(config: PostgresCheckpointerConfig): Promise<PostgresSaver> {
  if (!/^postgres(?:ql)?:\/\//.test(config.connectionString)) throw new Error("LangGraph checkpointer requires a PostgreSQL connection string");
  if (!/^[a-z_][a-z0-9_]*$/i.test(config.schema)) throw new Error("LangGraph checkpoint schema is invalid");
  const checkpointer = PostgresSaver.fromConnString(config.connectionString, { schema: config.schema });
  if (config.runSetup) await checkpointer.setup();
  return checkpointer;
}

export interface ThreadManager {
  createThread(params: {
    tenantId: string;
    graphName: string;
    metadata?: Record<string, unknown>;
  }): Promise<ThreadRecord>;

  getThread(threadId: string): Promise<ThreadRecord | null>;

  listThreads(params: {
    tenantId: string;
    graphName?: string;
    status?: ThreadRecord["status"];
    limit?: number;
    offset?: number;
  }): Promise<ThreadRecord[]>;

  updateThread(
    threadId: string,
    patch: Partial<Pick<ThreadRecord, "status" | "metadata" | "checkpointSeq">>,
  ): Promise<ThreadRecord>;

  deleteThread(threadId: string): Promise<void>;
}

const THREAD_KEY_PREFIX = "lgthread:";

export function createThreadManager(redis: {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: string, ttl: number): Promise<void>;
  del(key: string): Promise<void>;
  keys(pattern: string): Promise<string[]>;
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, fields: Record<string, string>): Promise<void>;
}): ThreadManager {
  async function loadThread(threadId: string): Promise<ThreadRecord | null> {
    const raw = await redis.hgetall(`${THREAD_KEY_PREFIX}${threadId}`);
    if (!raw || !raw.threadId) return null;
    return {
      threadId: raw.threadId,
      tenantId: raw.tenantId,
      graphName: raw.graphName,
      status: raw.status as ThreadRecord["status"],
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      checkpointSeq: Number(raw.checkpointSeq) || 0,
      metadata: raw.metadataJson ? JSON.parse(raw.metadataJson) : {},
    };
  }

  async function saveThread(record: ThreadRecord): Promise<void> {
    const key = `${THREAD_KEY_PREFIX}${record.threadId}`;
    await redis.hset(key, {
      threadId: record.threadId,
      tenantId: record.tenantId,
      graphName: record.graphName,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      checkpointSeq: String(record.checkpointSeq),
      metadataJson: JSON.stringify(record.metadata),
    });
    await redis.set(key, "1", "EX", 86400 * 90);
  }

  return {
    async createThread({ tenantId, graphName, metadata = {} }) {
      const now = new Date().toISOString();
      const record: ThreadRecord = {
        threadId: randomUUID(),
        tenantId,
        graphName,
        status: "active",
        createdAt: now,
        updatedAt: now,
        checkpointSeq: 0,
        metadata,
      };
      await saveThread(record);
      return record;
    },

    async getThread(threadId) {
      return loadThread(threadId);
    },

    async listThreads({ tenantId, graphName, status, limit = 50, offset = 0 }) {
      const pattern = `${THREAD_KEY_PREFIX}*`;
      const keys = await redis.keys(pattern);
      const results: ThreadRecord[] = [];
      for (const key of keys) {
        const raw = await redis.hgetall(key);
        if (!raw || raw.tenantId !== tenantId) continue;
        if (graphName && raw.graphName !== graphName) continue;
        if (status && raw.status !== status) continue;
        results.push({
          threadId: raw.threadId,
          tenantId: raw.tenantId,
          graphName: raw.graphName,
          status: raw.status as ThreadRecord["status"],
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
          checkpointSeq: Number(raw.checkpointSeq) || 0,
          metadata: raw.metadataJson ? JSON.parse(raw.metadataJson) : {},
        });
      }
      results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return results.slice(offset, offset + limit);
    },

    async updateThread(threadId, patch) {
      const existing = await loadThread(threadId);
      if (!existing) throw new Error(`Thread ${threadId} not found`);
      const updated: ThreadRecord = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      await saveThread(updated);
      return updated;
    },

    async deleteThread(threadId) {
      await redis.del(`${THREAD_KEY_PREFIX}${threadId}`);
    },
  };
}

export interface ManagedCheckpointer {
  checkpointer: BaseCheckpointSaver;
  threads: ThreadManager;
}

export async function createManagedCheckpointer(
  config: PostgresCheckpointerConfig,
  redis: Parameters<typeof createThreadManager>[0],
): Promise<ManagedCheckpointer> {
  const checkpointer = await createPostgresCheckpointer(config);
  const threads = createThreadManager(redis);
  return { checkpointer, threads };
}
