import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import type * as schemaModule from "../db/schema";
import { configSnapshots } from "../db/schema";

export type DrizzleDb = PostgresJsDatabase<typeof schemaModule>;

export type ConfigSnapshotType = "graph" | "agent" | "pipeline" | "prompt" | "system";

export interface ConfigLayers {
  platform?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  tenant?: Record<string, unknown>;
  campaign?: Record<string, unknown>;
}

export const CONFIG_LAYER_PRECEDENCE = ["platform", "plan", "tenant", "campaign"] as const;
export type ConfigLayerName = (typeof CONFIG_LAYER_PRECEDENCE)[number];

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function deepMerge(target: unknown, source: unknown): unknown {
  if (isPlainObject(target) && isPlainObject(source)) {
    const result: Record<string, unknown> = { ...target };
    for (const [key, value] of Object.entries(source)) {
      result[key] = deepMerge(result[key], value);
    }
    return result;
  }
  return source;
}

export function mergeConfigLayers(layers: ConfigLayers): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const name of CONFIG_LAYER_PRECEDENCE) {
    const layer = layers[name];
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      merged[key] = deepMerge(merged[key], value);
    }
  }
  return merged;
}

export function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value) as T;
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value) as T;
  }
  return value;
}

export function resolveConfig<T>(schema: z.ZodType<T>, layers: ConfigLayers): T {
  const merged = mergeConfigLayers(layers);
  const parsed = schema.safeParse(merged);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Config validation failed: ${details}`);
  }
  return deepFreeze(parsed.data);
}

export interface ConfigSnapshotInput {
  tenantId: string;
  configType: ConfigSnapshotType;
  name: string;
  config: Record<string, unknown>;
}

export async function createConfigSnapshot(db: DrizzleDb, input: ConfigSnapshotInput): Promise<string> {
  const latest = await db.select({ version: configSnapshots.version })
    .from(configSnapshots)
    .where(and(
      eq(configSnapshots.tenantId, input.tenantId),
      eq(configSnapshots.name, input.name),
    ))
    .orderBy(desc(configSnapshots.version))
    .limit(1);

  const version = (latest[0]?.version ?? 0) + 1;
  const checksum = createHash("sha256").update(JSON.stringify(input.config)).digest("hex");

  const inserted = await db.insert(configSnapshots).values({
    tenantId: input.tenantId,
    configType: input.configType,
    name: input.name,
    version,
    config: input.config,
    checksum,
    isActive: true,
  }).returning({ id: configSnapshots.id });

  return inserted[0].id;
}