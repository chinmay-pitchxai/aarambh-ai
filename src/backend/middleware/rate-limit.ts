import Redis from "ioredis";
import { serverConfig } from "../config";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // epoch milliseconds
}

export interface RateLimitMiddlewareOptions {
  limit: number;
  window: number; // seconds
  keyPrefix: string;
}

const MAX_MEM_ENTRIES = 10_000;
const memStore = new Map<string, { count: number; resetAt: number }>();

let sharedRedis: Redis | null = null;

// Shared lazy Redis client. Returns null when Redis cannot be reached; callers
// fall back to the (capped, dev-only) in-memory store or fail open.
export function getRedis(): Redis | null {
  if (sharedRedis) return sharedRedis;
  try {
    sharedRedis = new Redis(serverConfig.redisUrl, {
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
      connectTimeout: 2000,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    sharedRedis.on("error", () => {});
    sharedRedis.connect().catch(() => {});
    return sharedRedis;
  } catch {
    sharedRedis = null;
    return null;
  }
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown"
  );
}

async function redisRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  const ttl = await redis.ttl(key);
  const resetAt = ttl > 0 ? Date.now() + ttl * 1000 : Date.now() + windowSeconds * 1000;
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt,
  };
}

function memoryRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): RateLimitResult {
  const now = Date.now();
  const existing = memStore.get(key);
  if (existing && existing.resetAt > now) {
    const count = existing.count + 1;
    existing.count = count;
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt: existing.resetAt,
    };
  }
  if (memStore.size >= MAX_MEM_ENTRIES) {
    const oldest = memStore.keys().next().value;
    if (oldest) memStore.delete(oldest);
  }
  const resetAt = now + windowSeconds * 1000;
  memStore.set(key, { count: 1, resetAt });
  return { allowed: 1 <= limit, remaining: Math.max(0, limit - 1), resetAt };
}

// Fixed-window rate limiter. Redis-backed when available; falls back to a
// capped in-memory store when the server explicitly allows it (dev/test only).
// If neither is usable the limiter fails open so availability is not harmed.
export async function rateLimit(
  redis: Redis | null,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  if (redis) {
    try {
      return await redisRateLimit(redis, key, limit, windowSeconds);
    } catch {
      // fall back below
    }
  }
  if (serverConfig.allowInMemoryFallback) {
    return memoryRateLimit(key, limit, windowSeconds);
  }
  return { allowed: true, remaining: limit, resetAt: Date.now() + windowSeconds * 1000 };
}

// Builds a per-IP limiter bound to a Redis instance and key prefix.
export function rateLimitMiddleware(
  redis: Redis | null,
  options: RateLimitMiddlewareOptions,
): (request: Request) => Promise<RateLimitResult> {
  return (request) => {
    const ip = getClientIp(request);
    return rateLimit(redis, `${options.keyPrefix}:${ip}`, options.limit, options.window);
  };
}