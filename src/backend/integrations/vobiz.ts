import { serverConfig, requireVobizConfig } from "../config";
import { randomUUID } from "crypto";

// ── Vobiz Telephony Adapter ──
// Type-safe wrapper around Vobiz REST API (https://api.vobiz.in/v1).
// All write operations use idempotency keys and track provider receipts.

export interface VobizError {
  status: number;
  code: string;
  message: string;
}

export class VobizApiError extends Error {
  constructor(public readonly vobizError: VobizError) {
    super(`Vobiz API error ${vobizError.status}: ${vobizError.message}`);
    this.name = "VobizApiError";
  }
}

export interface NumberSearchResult {
  phoneNumber: string;
  friendlyName: string;
  areaCode: string;
  type: "local" | "toll_free" | "mobile";
  monthlyCost: number; // paise
  available: boolean;
}

export interface AllocatedNumber {
  phoneNumber: string;
  sid: string;
  tenantId: string;
  allocatedAt: Date;
}

export interface CallInitiationResult {
  callId: string;
  status: string;
  providerReceipt: {
    idempotencyKey: string;
    initiatedAt: Date;
    apiRequestId?: string;
  };
}

export interface CallStatusResult {
  callId: string;
  status: "initiated" | "ringing" | "answered" | "completed" | "failed" | "busy" | "no_answer";
  duration?: number;
  recordingUrl?: string;
  hangupCause?: string;
  direction: "outbound" | "inbound";
  startedAt?: Date;
  answeredAt?: Date;
  endedAt?: Date;
}

export interface TranscriptTurn {
  role: string;
  text: string;
  startMs?: number;
  endMs?: number;
}

// ── Webhook signature verification ──

export function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;

  try {
    // Vobiz uses HMAC-SHA256 hex digest
    const crypto = require("crypto");
    const expected = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");
    const received = signature.replace(/^sha256=/i, "");

    if (expected.length !== received.length) return false;
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(received, "hex"),
    );
  } catch {
    return false;
  }
}

// ── Client ──

export class VobizClient {
  private baseUrl: string;
  private apiKey: string;
  private fromNumber: string;

  constructor(config?: { apiUrl?: string; apiKey?: string; fromNumber?: string }) {
    const cfg = config || {};
    this.baseUrl = (cfg.apiUrl || serverConfig.vobiz.apiUrl).replace(/\/$/, "");
    this.apiKey = cfg.apiKey || serverConfig.vobiz.apiKey || "";
    this.fromNumber = cfg.fromNumber || serverConfig.vobiz.fromNumber || "";
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<{ data: T; apiRequestId?: string }> {
    const headers: Record<string, string> = { ...this.headers };
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });

    const apiRequestId = res.headers.get("x-request-id") || undefined;

    if (!res.ok) {
      let errorBody: Record<string, unknown> = {};
      try {
        errorBody = await res.json();
      } catch {
        // non-JSON error
      }
      throw new VobizApiError({
        status: res.status,
        code: String(errorBody.code || res.status),
        message: String(errorBody.message || errorBody.error || `HTTP ${res.status}`),
      });
    }

    const data = (await res.json()) as T;
    return { data, apiRequestId };
  }

  // ── Number Management ──

  async searchNumbers(
    areaCode: string,
    type: "local" | "toll_free" | "mobile" = "local",
  ): Promise<NumberSearchResult[]> {
    const { data } = await this.request<NumberSearchResult[]>(
      "GET",
      `/available-numbers?area_code=${encodeURIComponent(areaCode)}&type=${type}`,
    );
    return data;
  }

  async allocateNumber(
    tenantId: string,
    phoneNumber: string,
  ): Promise<AllocatedNumber> {
    const idempotencyKey = `alloc_${tenantId}_${phoneNumber}_${Date.now()}`;
    const { data, apiRequestId } = await this.request<AllocatedNumber>(
      "POST",
      "/incoming-numbers",
      {
        phone_number: phoneNumber,
        webhook_url: `${serverConfig.appUrl}/api/v1/webhooks/vobiz`,
        sms_webhook_url: `${serverConfig.appUrl}/api/v1/webhooks/vobiz`,
        status_callback_url: `${serverConfig.appUrl}/api/v1/webhooks/vobiz`,
      },
      idempotencyKey,
    );
    return {
      ...data,
      tenantId,
      allocatedAt: new Date(),
      providerReceipt: { idempotencyKey, apiRequestId },
    } as AllocatedNumber & { providerReceipt: { idempotencyKey: string; apiRequestId?: string } };
  }

  async releaseNumber(phoneNumber: string): Promise<void> {
    const idempotencyKey = `release_${phoneNumber}_${Date.now()}`;
    await this.request("DELETE", `/incoming-numbers/${encodeURIComponent(phoneNumber)}`, undefined, idempotencyKey);
  }

  async configureWebhook(
    phoneNumber: string,
    webhookUrl: string,
  ): Promise<void> {
    const idempotencyKey = `whk_${phoneNumber}_${Date.now()}`;
    await this.request(
      "POST",
      `/incoming-numbers/${encodeURIComponent(phoneNumber)}`,
      {
        voice_url: webhookUrl,
        voice_method: "POST",
        status_callback_url: webhookUrl,
      },
      idempotencyKey,
    );
  }

  // ── Call Management ──

  async initiateCall(
    from: string,
    to: string,
    webhookUrl: string,
    options?: {
      record?: boolean;
      timeout?: number;
      machineDetection?: "enable" | "disable";
      callbackUrl?: string;
    },
  ): Promise<CallInitiationResult> {
    const idempotencyKey = `call_${Date.now()}_${randomUUID().slice(0, 8)}`;

    const body: Record<string, unknown> = {
      to,
      from: from || this.fromNumber,
      url: webhookUrl,
      method: "POST",
      record: options?.record ?? true,
      status_callback: options?.callbackUrl || webhookUrl,
      status_callback_method: "POST",
    };

    if (options?.timeout) body.timeout = options.timeout;
    if (options?.machineDetection) body.machine_detection = options.machineDetection;

    const { data, apiRequestId } = await this.request<{ call_id: string; status: string }>(
      "POST",
      "/calls",
      body,
      idempotencyKey,
    );

    return {
      callId: data.call_id,
      status: data.status,
      providerReceipt: {
        idempotencyKey,
        initiatedAt: new Date(),
        apiRequestId,
      },
    };
  }

  async getCallStatus(callId: string): Promise<CallStatusResult> {
    const { data } = await this.request<CallStatusResult>("GET", `/calls/${callId}`);
    return {
      ...data,
      startedAt: data.startedAt ? new Date(data.startedAt as unknown as string) : undefined,
      answeredAt: data.answeredAt ? new Date(data.answeredAt as unknown as string) : undefined,
      endedAt: data.endedAt ? new Date(data.endedAt as unknown as string) : undefined,
    };
  }

  async getCallRecording(callId: string): Promise<{ recordingUrl: string; duration: number } | null> {
    try {
      const { data } = await this.request<{ recording_url: string; duration: number }>(
        "GET",
        `/calls/${callId}/recording`,
      );
      return { recordingUrl: data.recording_url, duration: data.duration };
    } catch (err) {
      if (err instanceof VobizApiError && err.vobizError.status === 404) return null;
      throw err;
    }
  }

  async getCallTranscript(callId: string): Promise<TranscriptTurn[]> {
    try {
      const { data } = await this.request<{ transcript: TranscriptTurn[] }>(
        "GET",
        `/calls/${callId}/transcript`,
      );
      return data.transcript || [];
    } catch {
      return [];
    }
  }

  // ── Capability check ──

  get capabilities() {
    return {
      outboundCalling: true,
      inboundCalling: true,
      recording: true,
      transcription: true,
      machineDetection: true,
      numberProvisioning: true,
      webhookSignatures: true,
    };
  }
}

// Singleton instance
let _client: VobizClient | null = null;

export function getVobizClient(): VobizClient {
  if (!_client) {
    _client = new VobizClient();
  }
  return _client;
}
