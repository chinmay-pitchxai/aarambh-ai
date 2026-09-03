import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const CORRELATION_HEADER = "x-correlation-id";

export interface CorrelationContext {
  correlationId: string;
}

const correlationStore = new AsyncLocalStorage<CorrelationContext>();

export function createCorrelationId(): string {
  return `corr_${Date.now().toString(36)}_${randomUUID()}`;
}

export function getCorrelationId(): string | undefined {
  return correlationStore.getStore()?.correlationId;
}

export type CorrelationHeaderValue = string | string[] | undefined;
export type CorrelationHeaders = Record<string, CorrelationHeaderValue> | Headers;

function readHeader(headers: CorrelationHeaders, name: string): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const value = headers[name];
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

export interface CorrelationRequest {
  headers?: CorrelationHeaders;
}

export function withCorrelation<T>(
  request: CorrelationRequest | null,
  headers: CorrelationHeaders,
  run: (correlationId: string) => Promise<T>,
): Promise<T> {
  const correlationId =
    readHeader(headers, CORRELATION_HEADER) ??
    (request?.headers ? readHeader(request.headers, CORRELATION_HEADER) : undefined) ??
    createCorrelationId();
  return correlationStore.run({ correlationId }, () => run(correlationId));
}

export function correlationMiddleware(request: NextRequest) {
  const correlationId = readHeader(request.headers, CORRELATION_HEADER) ?? createCorrelationId();
  const response = NextResponse.next();
  response.headers.set(CORRELATION_HEADER, correlationId);
  return correlationStore.run({ correlationId }, () => response);
}

export function withCorrelationMiddleware(
  handler: (request: NextRequest) => NextResponse | Promise<NextResponse>,
): (request: NextRequest) => Promise<NextResponse> {
  return (request) => {
    const correlationId = readHeader(request.headers, CORRELATION_HEADER) ?? createCorrelationId();
    return correlationStore.run({ correlationId }, async () => {
      const response = await handler(request);
      response.headers.set(CORRELATION_HEADER, correlationId);
      return response;
    });
  };
}