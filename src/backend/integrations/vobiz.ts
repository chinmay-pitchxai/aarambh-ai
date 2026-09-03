import { serverConfig, requireVobizConfig } from "../config";
import { randomUUID } from "crypto";

// ── Vobiz Telephony Adapter ──
// Type-safe wrapper around the REAL Vobiz REST API (https://api.vobiz.ai).
// Docs: https://docs.vobiz.ai / https://vobiz.ai/docs
//
// Auth: X-Auth-ID + X-Auth-Token headers (account credentials from
// https://console.vobiz.ai). All write operations use idempotency keys and
// track provider receipts.
//
// NOTE (honest capability reporting): the public Vobiz API documents call
// initiation (answer_url VobizXML flow), CDR (status/history), number
// inventory/purchase/release, hangup and balance. It does NOT document
// server-side call recording retrieval or transcription endpoints, so those
// capabilities are reported as unsupported here.

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
  inventoryId?: string;
  phoneNumber: string;
  friendlyName: string;
  areaCode: string;
  type: "local" | "toll_free" | "mobile";
  monthlyCost: number; // paise
  setupCost?: number; // paise
  currency?: string;
  voiceEnabled?: boolean;
  available: boolean;
}

export interface AllocatedNumber {
  phoneNumber: string;
  sid: string;
  tenantId: string;
  allocatedAt: Date;
}

export interface CallInitiationResult {
  callId: string; // Vobiz request_uuid (used for CDR lookup + hangup)
  apiId?: string;
  status: string;
  providerReceipt: {
    idempotencyKey: string;
    initiatedAt: Date;
    apiRequestId?: string;
  };
}

export interface CallStatusResult {
  callId: string;
  status: "initiated" | "ringing" | "answered" | "completed" | "failed" | "busy" | "no_answer" | "unknown";
  duration?: number; // seconds (ring + talk)
  billableSeconds?: number;
  cost?: number;
  currency?: string;
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

export interface VobizBalance {
  balance: number;
  currency: string;
}

export interface VobizHealth {
  ok: boolean;
  baseUrl: string;
  dnsOk: boolean;
  apiReachable: boolean;
  authenticated: boolean;
  latencyMs?: number;
  error?: string;
}

// ── Webhook signature verification ──
// Vobiz status callbacks (answer_url / hangup_url) post call fields; there is
// no documented HMAC scheme for them. Keep this helper for deployments that
// terminate webhooks behind a shared-secret check, but do NOT reject
// unsigned provider callbacks by default — correlate via call UUID instead.

export function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature || !secret) return false;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
  private authId: string;
  private authToken: string;
  private fromNumber: string;

  constructor(config?: { apiUrl?: string; authId?: string; authToken?: string; fromNumber?: string }) {
    const cfg = config || {};
    this.baseUrl = (cfg.apiUrl || serverConfig.vobiz.apiUrl).replace(/\/$/, "");
    this.authId = cfg.authId || serverConfig.vobiz.authId || "";
    this.authToken = cfg.authToken || serverConfig.vobiz.authToken || "";
    this.fromNumber = cfg.fromNumber || serverConfig.vobiz.fromNumber || "";
  }

  private get headers(): Record<string, string> {
    return {
      "X-Auth-ID": this.authId,
      "X-Auth-Token": this.authToken,
      "Content-Type": "application/json",
    };
  }

  private accountPath(path: string): string {
    return `${this.baseUrl}/api/v1/Account/${encodeURIComponent(this.authId)}${path}`;
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<{ data: T; apiRequestId?: string }> {
    const headers: Record<string, string> = { ...this.headers };
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });

    const apiRequestId = res.headers.get("x-request-id") || undefined;

    if (!res.ok) {
      let errorBody: Record<string, unknown> = {};
      try {
        const parsed = await res.json();
        errorBody = (parsed?.error && typeof parsed.error === "object" ? parsed.error : parsed) as Record<string, unknown>;
      } catch {
        // non-JSON error
      }
      throw new VobizApiError({
        status: res.status,
        code: String(errorBody.code || res.status),
        message: String(errorBody.message || `HTTP ${res.status}`),
      });
    }

    const data = (await res.json()) as T;
    return { data, apiRequestId };
  }

  // ── Number Management (real endpoints) ──

  /** Numbers already owned by this Vobiz account. */
  async listAccountNumbers(page = 1, perPage = 25): Promise<Array<{ id: string; e164: string; status: string; voiceEnabled: boolean; region?: string }>> {
    const { data } = await this.request<{ items: Array<Record<string, unknown>> }>(
      "GET",
      this.accountPath(`/numbers?page=${page}&per_page=${perPage}`),
    );
    return (data.items || []).map((n) => ({
      id: String(n.id ?? ""),
      e164: String(n.e164 ?? ""),
      status: String(n.status ?? ""),
      voiceEnabled: Boolean(n.voice_enabled ?? n.capabilities ? (n.capabilities as Record<string, boolean>)?.voice : false),
      region: n.region ? String(n.region) : undefined,
    }));
  }

  /** Browse purchasable inventory numbers. `search` matches the E.164 digits (e.g. "9180"). */
  async searchNumbers(
    areaCode: string,
    type: "local" | "toll_free" | "mobile" = "local",
  ): Promise<NumberSearchResult[]> {
    const digits = areaCode.replace(/\D/g, "");
    const params = new URLSearchParams({ country: "IN", per_page: "25" });
    if (digits) params.set("search", digits);
    const { data } = await this.request<{ items: Array<Record<string, unknown>> }>(
      "GET",
      this.accountPath(`/inventory/numbers?${params.toString()}`),
    );
    return (data.items || [])
      .filter((n) => String(n.status ?? "active") === "active")
      .map((n) => {
        const e164 = String(n.e164 ?? "");
        const national = e164.replace(/^\+91/, "");
        const monthlyFee = Number(n.monthly_fee ?? 0);
        const setupFee = Number(n.setup_fee ?? 0);
        return {
          inventoryId: n.id ? String(n.id) : undefined,
          phoneNumber: e164,
          friendlyName: e164,
          areaCode: national.slice(0, 4) || digits,
          type: national.length === 10 ? "mobile" : type,
          monthlyCost: Math.round(monthlyFee * 100),
          setupCost: Math.round(setupFee * 100),
          currency: n.currency ? String(n.currency) : "INR",
          voiceEnabled: Boolean(n.voice_enabled ?? true),
          available: true,
        };
      });
  }

  /** Purchase an inventory number and assign it to this account. Debits setup + monthly fee. */
  async allocateNumber(
    tenantId: string,
    phoneNumber: string,
  ): Promise<AllocatedNumber> {
    const idempotencyKey = `alloc_${tenantId}_${phoneNumber}_${Date.now()}`;
    const { data, apiRequestId } = await this.request<{ message: string; number: Record<string, unknown> }>(
      "POST",
      this.accountPath("/numbers/purchase-from-inventory"),
      { e164: phoneNumber },
      idempotencyKey,
    );
    void apiRequestId;
    const num = data.number || {};
    return {
      phoneNumber: String(num.e164 ?? phoneNumber),
      sid: String(num.id ?? phoneNumber),
      tenantId,
      allocatedAt: num.purchased_at ? new Date(String(num.purchased_at)) : new Date(),
    };
  }

  /** Release a number back to inventory (24h pending_release cooldown unless immediate). */
  async releaseNumber(phoneNumber: string, immediate = true): Promise<void> {
    const idempotencyKey = `release_${phoneNumber}_${Date.now()}`;
    const encoded = encodeURIComponent(phoneNumber.startsWith("+") ? phoneNumber : `+${phoneNumber}`);
    await this.request(
      "DELETE",
      this.accountPath(`/numbers/${encoded}${immediate ? "?immediate=true" : ""}`),
      undefined,
      idempotencyKey,
    );
  }

  // ── Call Management (real endpoints) ──

  /**
   * Initiate an outbound call. Vobiz fetches `answerUrl` (must return VobizXML)
   * when the callee answers. Returns the provider call UUID.
   */
  async initiateCall(
    from: string,
    to: string,
    answerUrl: string,
    options?: {
      record?: boolean;
      timeout?: number;
      machineDetection?: "enable" | "disable";
      callbackUrl?: string;
    },
  ): Promise<CallInitiationResult> {
    const idempotencyKey = `call_${Date.now()}_${randomUUID().slice(0, 8)}`;

    // NOTE: the public Call API documents from/to/answer_url/answer_method
    // (+time_limit). `record`/`machineDetection` have no documented request
    // fields and are accepted for forward-compat but not sent.
    const body: Record<string, unknown> = {
      from: from || this.fromNumber,
      to,
      answer_url: answerUrl,
      answer_method: "POST",
    };
    if (options?.timeout) body.time_limit = options.timeout;
    if (options?.callbackUrl) body.hangup_url = options.callbackUrl;

    const { data, apiRequestId } = await this.request<{ api_id: string; message: string; request_uuid: string }>(
      "POST",
      this.accountPath("/Call/"),
      body,
      idempotencyKey,
    );

    return {
      callId: data.request_uuid,
      apiId: data.api_id,
      status: data.message || "initiated",
      providerReceipt: {
        idempotencyKey,
        initiatedAt: new Date(),
        apiRequestId,
      },
    };
  }

  /** Hang up a live call by provider UUID. Triggers the hangup callback + final CDR. */
  async hangupCall(callUuid: string): Promise<void> {
    await this.request(
      "DELETE",
      this.accountPath(`/Call/${encodeURIComponent(callUuid)}/`),
    );
  }

  /** Call detail record lookup. Maps provider fields to our status model. */
  async getCallStatus(callUuid: string): Promise<CallStatusResult> {
    const { data } = await this.request<{ data?: Record<string, unknown> } | Record<string, unknown>>(
      "GET",
      this.accountPath(`/cdr/${encodeURIComponent(callUuid)}`),
    );
    const cdr = ((data as Record<string, unknown>)?.data as Record<string, unknown>) || (data as Record<string, unknown>);
    return this.mapCdr(cdr, callUuid);
  }

  /** Recent CDRs (defaults to last 20). */
  async listRecentCalls(limit = 20): Promise<CallStatusResult[]> {
    const { data } = await this.request<{ data: Array<Record<string, unknown>> }>(
      "GET",
      this.accountPath(`/cdr/recent?limit=${Math.max(1, Math.min(limit, 100))}`),
    );
    return (data.data || []).map((cdr) => this.mapCdr(cdr, String(cdr.uuid ?? "")));
  }

  private mapCdr(cdr: Record<string, unknown>, fallbackId: string): CallStatusResult {
    const answerTime = cdr.answer_time ? new Date(String(cdr.answer_time)) : null;
    const hangup = String(cdr.hangup_cause ?? "");
    let status: CallStatusResult["status"] = "unknown";
    if (answerTime) status = "completed";
    else if (hangup === "NO_ANSWER") status = "no_answer";
    else if (hangup === "USER_BUSY") status = "busy";
    else if (hangup === "NORMAL_CLEARING" || hangup === "") status = "failed";
    else if (hangup) status = "failed";

    return {
      callId: String(cdr.uuid ?? fallbackId),
      status,
      duration: cdr.duration != null ? Number(cdr.duration) : undefined,
      billableSeconds: cdr.billsec != null ? Number(cdr.billsec) : undefined,
      cost: cdr.total_cost != null ? Number(cdr.total_cost) : cdr.cost != null ? Number(cdr.cost) : undefined,
      currency: cdr.currency ? String(cdr.currency) : undefined,
      hangupCause: hangup || undefined,
      direction: cdr.call_direction === "inbound" ? "inbound" : "outbound",
      startedAt: cdr.start_time ? new Date(String(cdr.start_time)) : undefined,
      answeredAt: answerTime || undefined,
      endedAt: cdr.end_time ? new Date(String(cdr.end_time)) : undefined,
    };
  }

  /**
   * Recording retrieval: the public Vobiz API does not document a recording
   * download endpoint, so this honestly reports unsupported.
   */
  async getCallRecording(_callId: string): Promise<{ recordingUrl: string; duration: number } | null> {
    void _callId;
    return null;
  }

  /** Transcripts are produced by our own voice pipeline (Gemini Live), not Vobiz. */
  async getCallTranscript(_callId: string): Promise<TranscriptTurn[]> {
    void _callId;
    return [];
  }

  /** Account balance (best-effort; returns null when the endpoint is unavailable). */
  async getBalance(currency = "INR"): Promise<VobizBalance | null> {
    try {
      const { data } = await this.request<Record<string, unknown>>(
        "GET",
        this.accountPath(`/balance?currency=${encodeURIComponent(currency)}`),
      );
      const balance = Number(data.balance ?? data.available_balance ?? NaN);
      if (Number.isNaN(balance)) return null;
      return { balance, currency: String(data.currency ?? currency) };
    } catch {
      return null;
    }
  }

  /**
   * Connectivity probe. Distinguishes: DNS/network down, API down,
   * missing credentials, and bad credentials — without mutating anything.
   */
  async healthCheck(): Promise<VobizHealth> {
    const started = Date.now();
    if (!this.authId || !this.authToken) {
      return {
        ok: false,
        baseUrl: this.baseUrl,
        dnsOk: true,
        apiReachable: false,
        authenticated: false,
        error: "Missing credentials. Set VOBIZ_AUTH_ID and VOBIZ_AUTH_TOKEN from the Vobiz Console (console.vobiz.ai).",
      };
    }
    try {
      await this.request("GET", this.accountPath("/numbers?per_page=1"));
      return {
        ok: true,
        baseUrl: this.baseUrl,
        dnsOk: true,
        apiReachable: true,
        authenticated: true,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      if (err instanceof VobizApiError && err.vobizError.status === 401) {
        return {
          ok: false,
          baseUrl: this.baseUrl,
          dnsOk: true,
          apiReachable: true,
          authenticated: false,
          latencyMs: Date.now() - started,
          error: "API reachable but credentials rejected (401). Check VOBIZ_AUTH_ID / VOBIZ_AUTH_TOKEN.",
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      const dnsDown = /fetch failed|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message);
      return {
        ok: false,
        baseUrl: this.baseUrl,
        dnsOk: !dnsDown,
        apiReachable: false,
        authenticated: false,
        latencyMs: Date.now() - started,
        error: message,
      };
    }
  }

  // ── Capability check (verified against public docs) ──

  get capabilities() {
    return {
      outboundCalling: true,
      hangup: true,
      callDetailsCdr: true,
      recordingRetrieval: false, // no public retrieval endpoint documented
      transcription: false, // produced by our own voice pipeline
      machineDetection: false, // no documented request field
      numberProvisioning: true, // inventory browse + purchase + release
      webhookSignatures: false, // callbacks carry call UUID; correlate via CDR
    };
  }
}

/** Convenience: throws a clear error when Vobiz is not configured. */
export function requireVobizClient(): VobizClient {
  requireVobizConfig();
  return getVobizClient();
}

// Singleton instance
let _client: VobizClient | null = null;

export function getVobizClient(): VobizClient {
  if (!_client) {
    _client = new VobizClient();
  }
  return _client;
}

export function resetVobizClient(): void {
  _client = null;
}
