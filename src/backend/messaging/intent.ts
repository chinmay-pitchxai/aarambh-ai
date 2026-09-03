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

const QUESTION_KEYWORDS = [
  "what",
  "how",
  "when",
  "where",
  "why",
  "which",
  "who",
  "can you",
  "could you",
  "tell me",
  "explain",
  "does it",
  "do you",
  "is there",
  "are there",
  "what's",
  "what is",
  "how much",
  "how long",
  "how does",
  "what do",
  "what kind",
];

const MEETING_REQUEST_KEYWORDS = [
  "book a meeting",
  "book meeting",
  "schedule a meeting",
  "schedule meeting",
  "set up a meeting",
  "set up meeting",
  "book a call",
  "book call",
  "schedule a call",
  "schedule call",
  "let's meet",
  "lets meet",
  "can we meet",
  "when can we meet",
  "pick a time",
  "choose a time",
  "available time",
  "available slots",
  "what times",
  "what time works",
];

export function detectIntent(body: string): Intent {
  const lower = body.toLowerCase().trim();
  if (!lower) return "neutral";

  for (const keyword of DNC_KEYWORDS) {
    if (lower.includes(keyword)) return "dnc";
  }
  for (const keyword of MEETING_REQUEST_KEYWORDS) {
    if (lower.includes(keyword)) return "meeting_request";
  }
  for (const keyword of INTEREST_KEYWORDS) {
    if (lower.includes(keyword)) return "interested";
  }
  for (const keyword of QUESTION_KEYWORDS) {
    if (lower.startsWith(keyword) || lower.includes(keyword + " ")) return "question";
  }
  return "neutral";
}