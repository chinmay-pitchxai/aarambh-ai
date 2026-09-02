import type { Intent } from "./types";

// Keyword lists mirror the legacy inbound-handler but with the explicit DNC
// set the task requires: "stop/dnc/not interested" always wins over interest.
const DNC_KEYWORDS = [
  "stop",
  "dnc",
  "not interested",
  "don't call",
  "dont call",
  "do not call",
  "unsubscribe",
  "opt out",
  "opt-out",
  "remove",
  "no thanks",
  "take me off",
  "do not contact",
  "don't contact",
];

const INTEREST_KEYWORDS = [
  "interested",
  "best time",
  "meeting",
  "pricing",
  "price",
  "cost",
  "demo",
  "book",
  "schedule",
  "yes",
  "sure",
  "call me",
  "tell me more",
  "more info",
  "details",
  "how much",
  "what's the cost",
  "what is the cost",
];

export function detectIntent(body: string): Intent {
  const lower = body.toLowerCase().trim();
  if (!lower) return "neutral";

  // DNC has priority — e.g. "not interested" contains "interested".
  for (const keyword of DNC_KEYWORDS) {
    if (lower.includes(keyword)) return "dnc";
  }
  for (const keyword of INTEREST_KEYWORDS) {
    if (lower.includes(keyword)) return "interested";
  }
  return "neutral";
}