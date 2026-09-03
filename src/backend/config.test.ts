import { describe, expect, it } from "vitest";
import { parseServerConfig } from "./config-schema";

const validEnvironment = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://user:password@localhost:5432/aarambh",
  REDIS_URL: "redis://localhost:6379",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000/",
};

describe("parseServerConfig", () => {
  it("normalizes URLs and enables explicitly allowed development fallbacks", () => {
    const config = parseServerConfig(validEnvironment);

    expect(config.appUrl).toBe("http://localhost:3000");
    expect(config.vobiz.apiUrl).toBe("https://api.vobiz.ai");
    expect(config.allowInMemoryFallback).toBe(true);
    expect(config.isProduction).toBe(false);
  });

  it("rejects non-PostgreSQL and non-Redis connection strings", () => {
    expect(() => parseServerConfig({
      ...validEnvironment,
      DATABASE_URL: "https://database.example.com",
      REDIS_URL: "https://cache.example.com",
    })).toThrow(/DATABASE_URL.*PostgreSQL protocol.*REDIS_URL.*Redis protocol/);
  });

  it("requires provider secrets and disables memory fallback in production", () => {
    expect(() => parseServerConfig({
      ...validEnvironment,
      NODE_ENV: "production",
      ALLOW_IN_MEMORY_FALLBACK: "true",
    })).toThrow(/APP_SECRET.*VOBIZ_AUTH_ID.*VOBIZ_AUTH_TOKEN.*VOBIZ_FROM_NUMBER.*VOBIZ_WEBHOOK_SECRET.*ALLOW_IN_MEMORY_FALLBACK/);
  });

  it("accepts a fully configured production environment", () => {
    const config = parseServerConfig({
      ...validEnvironment,
      NODE_ENV: "production",
      APP_SECRET: "a-secure-production-secret-with-more-than-32-characters",
      VOBIZ_AUTH_ID: "MA_TEST123",
      VOBIZ_AUTH_TOKEN: "provider-token",
      VOBIZ_FROM_NUMBER: "+919999999999",
      VOBIZ_WEBHOOK_SECRET: "webhook-secret",
      ALLOW_IN_MEMORY_FALLBACK: "false",
    });

    expect(config.isProduction).toBe(true);
    expect(config.allowInMemoryFallback).toBe(false);
  });
});
