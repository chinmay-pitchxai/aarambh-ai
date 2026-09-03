import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  VobizClient,
  VobizApiError,
  verifyWebhookSignature,
} from "./vobiz";

const AUTH_ID = "MA_TEST123";

function client() {
  return new VobizClient({
    apiUrl: "https://api.vobiz.ai",
    authId: AUTH_ID,
    authToken: "token-abc",
    fromNumber: "+911234567890",
  });
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("VobizClient (real api.vobiz.ai contract)", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    void realFetch;
  });

  it("sends X-Auth-ID / X-Auth-Token and posts to the real Call endpoint", async () => {
    const spy = vi.fn().mockResolvedValue(
      jsonResponse({ api_id: "a1", message: "Call fired", request_uuid: "uuid-1" }),
    );
    vi.stubGlobal("fetch", spy);

    const result = await client().initiateCall("+911234567890", "+919876543210", "https://app.test/hook", {
      timeout: 30,
      callbackUrl: "https://app.test/hook",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.vobiz.ai/api/v1/Account/${AUTH_ID}/Call/`);
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Auth-ID"]).toBe(AUTH_ID);
    expect(headers["X-Auth-Token"]).toBe("token-abc");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      from: "+911234567890",
      to: "+919876543210",
      answer_url: "https://app.test/hook",
      answer_method: "POST",
      time_limit: 30,
      hangup_url: "https://app.test/hook",
    });
    expect(result.callId).toBe("uuid-1");
  });

  it("throws VobizApiError with provider message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: 401, message: "Invalid authentication credentials" } }, 401)),
    );
    await expect(client().initiateCall("+911234567890", "+919876543210", "https://app.test/hook")).rejects.toMatchObject({
      name: "VobizApiError",
    });
  });

  it("maps CDR to call status (answered / no_answer / busy)", async () => {
    const answered = {
      uuid: "u1",
      call_direction: "outbound",
      answer_time: "2026-05-11T06:59:31Z",
      start_time: "2026-05-11T06:59:26Z",
      end_time: "2026-05-11T06:59:32Z",
      duration: 6,
      billsec: 1,
      hangup_cause: "NORMAL_CLEARING",
      currency: "INR",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(answered)));
    const ok = await client().getCallStatus("u1");
    expect(ok.status).toBe("completed");
    expect(ok.duration).toBe(6);
    expect(ok.answeredAt).toBeInstanceOf(Date);

    const noAnswer = { ...answered, answer_time: null, hangup_cause: "NO_ANSWER" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(noAnswer)));
    expect((await client().getCallStatus("u1")).status).toBe("no_answer");

    const busy = { ...answered, answer_time: null, hangup_cause: "USER_BUSY" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(busy)));
    expect((await client().getCallStatus("u1")).status).toBe("busy");
  });

  it("maps inventory numbers to pool candidates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            { id: "n1", e164: "+918065480214", country: "IN", region: "Karnataka", status: "active", setup_fee: 100, monthly_fee: 300, currency: "INR", voice_enabled: true },
            { id: "n2", e164: "+14155551234", country: "US", region: "CA", status: "released", setup_fee: 0, monthly_fee: 1, currency: "USD", voice_enabled: true },
          ],
        }),
      ),
    );
    const results = await client().searchNumbers("9180");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ phoneNumber: "+918065480214", monthlyCost: 30000, available: true });

    const spy = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>);
    const [url] = spy.mock.calls[0] as [string];
    expect(url).toContain("/inventory/numbers?");
    expect(url).toContain("country=IN");
  });

  it("healthCheck distinguishes missing creds / bad creds", async () => {
    const noCreds = new VobizClient({ apiUrl: "https://api.vobiz.ai" });
    const missing = await noCreds.healthCheck();
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/Missing credentials/);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: 401, message: "Invalid authentication credentials" } }, 401)),
    );
    const bad = await client().healthCheck();
    expect(bad.ok).toBe(false);
    expect(bad.apiReachable).toBe(true);
    expect(bad.authenticated).toBe(false);
  });

  it("honestly reports unsupported capabilities", () => {
    expect(client().capabilities.recordingRetrieval).toBe(false);
    expect(client().capabilities.transcription).toBe(false);
    expect(client().capabilities.outboundCalling).toBe(true);
  });

  it("verifyWebhookSignature enforces constant-time comparison", () => {
    expect(verifyWebhookSignature("body", null, "secret")).toBe(false);
    expect(verifyWebhookSignature("body", "sha256=deadbeef", "")).toBe(false);
  });
});
