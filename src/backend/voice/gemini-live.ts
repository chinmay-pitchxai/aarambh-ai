// @google/genai is optional — install with: npm install @google/genai
// Dynamic import to avoid build failure when not installed
let GoogleGenAI: any = null;
let SessionType: any = null;

async function loadGenAI() {
  if (!GoogleGenAI) {
    try {
      const mod = await import("@google/genai");
      GoogleGenAI = mod.GoogleGenAI;
    } catch {
      throw new Error("@google/genai not installed. Run: npm install @google/genai");
    }
  }
  return GoogleGenAI;
}
import { serverConfig } from "../config";

// ── Gemini Live API Client ──
// Manages WebSocket-based real-time audio sessions with Gemini Live API.
// Handles audio input/output, transcription, interruption, and session lifecycle.

export interface GeminiLiveConfig {
  model: string;
  voiceName: string;
  systemInstruction: string;
}

export interface GeminiLiveCallbacks {
  onUserTranscript?: (text: string) => void;
  onAssistantTranscript?: (text: string) => void;
  onAudioResponse?: (audioData: string) => void;
  onInterruption?: () => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: "idle" | "listening" | "speaking") => void;
}

export interface GeminiLiveSession {
  sendAudio: (base64Pcm: string) => void;
  triggerGreeting: () => void;
  close: () => void;
  isClosed: boolean;
}

let aiClient: any = null;

async function getClient(): Promise<any> {
  if (!aiClient) {
    const GenAI = await loadGenAI();
    const apiKey = serverConfig.geminiApiKey;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured");
    }
    aiClient = new GenAI({
      apiKey,
      httpOptions: {
        headers: { "User-Agent": "aistudio-build" },
      },
    });
  }
  return aiClient;
}

/**
 * Creates a Gemini Live voice session.
 * Returns a session handle for sending audio and managing the conversation.
 */
export async function createGeminiLiveSession(
  config: GeminiLiveConfig,
  callbacks: GeminiLiveCallbacks = {},
): Promise<GeminiLiveSession> {
  const client = await getClient();
  const { model, voiceName, systemInstruction } = config;

  let sessionClosed = false;
  let sessionPromise: Promise<any> | null = null;

  sessionPromise = client.live.connect({
    model,
    config: {
      responseModalities: ["AUDIO" as any],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
      systemInstruction,
      outputAudioTranscription: {},
      inputAudioTranscription: {},
    },
    callbacks: {
      onmessage: (message: any) => {
        try {
          // User transcription
          if (message.serverContent?.userTurn?.parts) {
            const text = message.serverContent.userTurn.parts
              .map((p: any) => p.text)
              .join("");
            if (text) {
              callbacks.onUserTranscript?.(text);
            }
          }

          // Assistant response audio & transcripts
          if (message.serverContent?.modelTurn?.parts) {
            const modelParts = message.serverContent.modelTurn.parts;
            const text = modelParts.map((p: any) => p.text).join("");
            if (text) {
              callbacks.onAssistantTranscript?.(text);
            }

            for (const part of modelParts) {
              if (part.inlineData?.data) {
                callbacks.onStatusChange?.("speaking");
                callbacks.onAudioResponse?.(part.inlineData.data);
              }
            }
          }

          // Interruption / Barge-in
          if (message.serverContent?.interrupted) {
            callbacks.onInterruption?.();
            callbacks.onStatusChange?.("listening");
          }
        } catch (e: any) {
          callbacks.onError?.(
            e instanceof Error ? e : new Error(String(e)),
          );
        }
      },
    },
  }).catch((err: any) => {
    const error = err instanceof Error ? err : new Error(String(err));
    callbacks.onError?.(error);
    throw error;
  });

  return {
    sendAudio(base64Pcm: string) {
      if (sessionClosed) return;
      callbacks.onStatusChange?.("listening");
      sessionPromise?.then((session) => {
        try {
          session.sendRealtimeInput({
            audio: {
              data: base64Pcm,
              mimeType: "audio/pcm;rate=16000",
            },
          });
        } catch (e: any) {
          callbacks.onError?.(
            e instanceof Error ? e : new Error(String(e)),
          );
        }
      }).catch(() => {});
    },

    triggerGreeting() {
      if (sessionClosed) return;
      sessionPromise?.then((session) => {
        try {
          session.sendClientContent({ turnComplete: true });
        } catch (e: any) {
          callbacks.onError?.(
            e instanceof Error ? e : new Error(String(e)),
          );
        }
      }).catch(() => {});
    },

    close() {
      if (sessionClosed) return;
      sessionClosed = true;
      sessionPromise?.then((session) => {
        try {
          session.close();
        } catch {
          // ignore close errors
        }
      }).catch(() => {});
      sessionPromise = null;
    },

    get isClosed() {
      return sessionClosed;
    },
  };
}
