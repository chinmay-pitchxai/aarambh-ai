import Redis from "ioredis";
import type { ContextStore, LeadMemory } from "./types";

const MEMORY_PREFIX = "mem:";
const DEFAULT_TTL = 86400 * 30; // 30 days

// In-memory fallback when Redis is unavailable — capped to avoid OOM
const MAX_MEM_SIZE = 1000;
const memStore = new Map<string, { value: string; expiresAt: number }>();

let redis: Redis | null = null;
let redisConnected = false;

try {
  redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      if (times > 3) return null; // stop retrying
      return Math.min(times * 200, 2000);
    },
    connectTimeout: 2000,
    lazyConnect: true,
  });

  redis.on("connect", () => { redisConnected = true; });
  redis.on("error", () => { redisConnected = false; });
  redis.connect().catch(() => { redisConnected = false; });
} catch {
  redis = null;
}

async function safeGet(key: string): Promise<string | null> {
  if (redis && redisConnected) {
    try { return await redis.get(key); } catch { /* fallback */ }
  }
  // in-memory fallback
  const entry = memStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { memStore.delete(key); return null; }
  return entry.value;
}

async function safeSet(key: string, value: string, ttlSec: number) {
  if (redis && redisConnected) {
    try { await redis.set(key, value, "EX", ttlSec); return; } catch { /* fallback */ }
  }
  // Evict oldest if over cap
  if (memStore.size >= MAX_MEM_SIZE && !memStore.has(key)) {
    const oldest = memStore.keys().next().value;
    if (oldest) memStore.delete(oldest);
  }
  memStore.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
}

export function createRedisStore(): ContextStore {
  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const raw = await safeGet(key);
      return raw ? JSON.parse(raw) : null;
    },

    async set(key: string, value: unknown, ttlSec = DEFAULT_TTL) {
      await safeSet(key, JSON.stringify(value), ttlSec);
    },

    async del(key: string) {
      if (redis && redisConnected) {
        try { await redis.del(key); } catch { /* ok */ }
      }
      memStore.delete(key);
    },

    async recall(leadId: string): Promise<LeadMemory> {
      const raw = await safeGet(`${MEMORY_PREFIX}${leadId}`);
      if (raw) return JSON.parse(raw);

      return {
        leadId,
        calls: [],
        messages: [],
        lastPitch: null,
        lastSentiment: null,
        totalAttempts: 0,
      };
    },

    async saveMemory(mem: LeadMemory) {
      await safeSet(`${MEMORY_PREFIX}${mem.leadId}`, JSON.stringify(mem), DEFAULT_TTL);
    },
  };
}

export interface RedisStore extends ContextStore {
  saveMemory(mem: LeadMemory): Promise<void>;
}
