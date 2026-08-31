import { db, schema } from "./src/backend/db/index";
import { randomUUID } from "crypto";

const clientId = "demo";

// ── Client ──
await db.insert(schema.clients).values({
  id: clientId,
  name: "Demo Client",
  icpTags: ["vp-sales", "saas", "enterprise"],
}).onConflictDoNothing();

// ── Lead definitions ──
// Each entry: { fn, ln, co, ti, city, industry, band, status, score }
interface LeadDef {
  fn: string;
  ln: string;
  co: string;
  ti: string;
  city: string;
  industry: string;
  band: "hot" | "warm" | "cold";
  status: "new" | "contacted" | "qualified" | "converted" | "booked" | "parked" | "lost";
  score: number;
}

const leads: LeadDef[] = [
  // 3 × new + cold (not yet called)
  { fn: "Aarav", ln: "Sharma", co: "TechFlow Solutions", ti: "Founder & CEO", city: "Bangalore", industry: "SaaS", band: "cold", status: "new", score: 32 },
  { fn: "Neha", ln: "Patel", co: "DataMinds Analytics", ti: "Data Lead", city: "Mumbai", industry: "Analytics", band: "cold", status: "new", score: 28 },
  { fn: "Rohan", ln: "Gupta", co: "CloudNine Infra", ti: "CTO", city: "Delhi", industry: "Cloud", band: "cold", status: "new", score: 35 },

  // 3 × contacted + warm (first call made)
  { fn: "Vikram", ln: "Mehta", co: "SaaSly Inc", ti: "VP Sales", city: "Hyderabad", industry: "SaaS", band: "warm", status: "contacted", score: 48 },
  { fn: "Ananya", ln: "Rao", co: "FinEdge Capital", ti: "Senior Manager", city: "Chennai", industry: "Fintech", band: "warm", status: "contacted", score: 52 },
  { fn: "Karan", ln: "Verma", co: "HealthKart India", ti: "Growth Lead", city: "Gurgaon", industry: "HealthTech", band: "warm", status: "contacted", score: 55 },

  // 2 × contacted + hot (waiting for reply, showed interest on call)
  { fn: "Diya", ln: "Bansal", co: "MarketMinds", ti: "CMO", city: "Pune", industry: "MarTech", band: "hot", status: "contacted", score: 82 },
  { fn: "Ishita", ln: "Nair", co: "SaaS Unicorn", ti: "CEO", city: "Mumbai", industry: "SaaS", band: "hot", status: "contacted", score: 91 },

  // 2 × booked + hot (meetings confirmed)
  { fn: "Arjun", ln: "Reddy", co: "FinTech Global", ti: "CTO", city: "Bangalore", industry: "Fintech", band: "hot", status: "booked", score: 88 },
  { fn: "Reyansh", ln: "Kumar", co: "GrowthLabs", ti: "Director of Sales", city: "Bangalore", industry: "SaaS", band: "hot", status: "booked", score: 87 },

  // 2 × qualified + hot (meetings completed)
  { fn: "Tanya", ln: "Shah", co: "Enterprise Corp", ti: "CFO", city: "Mumbai", industry: "Enterprise", band: "hot", status: "qualified", score: 95 },
  { fn: "Siddharth", ln: "Jain", co: "Unicorn SaaS", ti: "CEO", city: "Delhi", industry: "SaaS", band: "hot", status: "qualified", score: 93 },

  // 2 × converted + hot (deals closed)
  { fn: "Meera", ln: "Desai", co: "LogiChain", ti: "Head of Growth", city: "Pune", industry: "Logistics", band: "hot", status: "converted", score: 90 },
  { fn: "Aditya", ln: "Kapoor", co: "RetailHub", ti: "VP Sales", city: "Mumbai", industry: "RetailTech", band: "hot", status: "converted", score: 89 },

  // 2 × parked + cold (not interested)
  { fn: "Priya", ln: "Singh", co: "BrightLabs", ti: "Coordinator", city: "Pune", industry: "EdTech", band: "cold", status: "parked", score: 30 },
  { fn: "Sanya", ln: "Joshi", co: "EduTech Pro", ti: "Manager", city: "Jaipur", industry: "EdTech", band: "cold", status: "parked", score: 25 },

  // 2 × lost + cold (retries exhausted)
  { fn: "Kabir", ln: "Malhotra", co: "AI Ventures", ti: "VP Product", city: "Hyderabad", industry: "AI/ML", band: "cold", status: "lost", score: 20 },
  { fn: "Tanvi", ln: "Kulkarni", co: "DataStack", ti: "Engineering Head", city: "Pune", industry: "DataInfra", band: "cold", status: "lost", score: 22 },

  // 2 × new + hot (hot leads, not yet called)
  { fn: "Zara", ln: "Khan", co: "NovaTech", ti: "VP Engineering", city: "Bangalore", industry: "SaaS", band: "hot", status: "new", score: 85 },
  { fn: "Raj", ln: "Malik", co: "ScaleUp AI", ti: "Head of Sales", city: "Delhi", industry: "AI/ML", band: "hot", status: "new", score: 83 },
];

// ── Insert leads + client_leads ──
const leadIds: string[] = [];

for (const d of leads) {
  const leadId = randomUUID();
  leadIds.push(leadId);

  await db.insert(schema.leads).values({
    id: leadId,
    phoneE164: `+9198${String(Math.floor(10000000 + Math.random() * 90000000)).slice(0, 8)}`,
    email: `${d.fn.toLowerCase()}.${d.ln.toLowerCase()}@${d.co.toLowerCase().replace(/\s/g, "")}.com`,
    firstName: d.fn,
    lastName: d.ln,
    company: d.co,
    title: d.ti,
    city: d.city,
    industry: d.industry,
    companySize: "201-500",
    icpTags: ["vp-sales", "saas", d.industry.toLowerCase()],
    freshness: new Date(),
    dnc: 0,
  });

  await db.insert(schema.clientLeads).values({
    id: randomUUID(),
    clientId,
    leadId,
    score: d.score,
    band: d.band,
    status: d.status,
    attemptCount: ["contacted", "booked", "qualified", "converted"].includes(d.status) ? Math.floor(1 + Math.random() * 3) : 0,
    lastCallAt: ["contacted", "booked", "qualified", "converted"].includes(d.status) ? new Date(Date.now() - Math.floor(Math.random() * 86400000 * 2)) : null,
  });
}

// Helper: get leadId by first name
function id(fn: string): string {
  const idx = leads.findIndex((l) => l.fn === fn);
  return leadIds[idx];
}

// ── Calls ──
// For contacted leads: 1 call each
const contactedLeads = ["Vikram", "Ananya", "Karan"];
for (const fn of contactedLeads) {
  const leadId = id(fn);
  await db.insert(schema.calls).values({
    id: randomUUID(),
    leadId,
    clientId,
    outcome: "interested",
    durationSec: 120 + Math.floor(Math.random() * 180),
    sentiment: "positive",
    summary: `${fn} showed interest in the product demo and pricing`,
    bant: { budget: "yes", authority: "yes", need: "yes", timeline: "2 weeks" },
    startedAt: new Date(Date.now() - 86400000),
    endedAt: new Date(Date.now() - 86400000 + 180000),
    attemptNumber: 1,
  });
}

// For interested leads: 2 calls each
const interestedLeads = ["Diya", "Ishita"];
for (const fn of interestedLeads) {
  const leadId = id(fn);
  await db.insert(schema.calls).values({
    id: randomUUID(),
    leadId,
    clientId,
    outcome: "interested",
    durationSec: 180 + Math.floor(Math.random() * 120),
    sentiment: "positive",
    summary: `${fn} is interested, wants to see a demo and discuss pricing`,
    bant: { budget: "yes", authority: "decision-maker", need: "automation", timeline: "1 month" },
    startedAt: new Date(Date.now() - 86400000 * 2),
    endedAt: new Date(Date.now() - 86400000 * 2 + 240000),
    attemptNumber: 1,
  });
  await db.insert(schema.calls).values({
    id: randomUUID(),
    leadId,
    clientId,
    outcome: "booked",
    durationSec: 90 + Math.floor(Math.random() * 60),
    sentiment: "positive",
    summary: `${fn} confirmed meeting for next week`,
    bant: { budget: "approved", authority: "yes", need: "scaling sales", timeline: "immediate" },
    startedAt: new Date(Date.now() - 3600000),
    endedAt: new Date(),
    attemptNumber: 2,
  });
}

// For booked leads: 2 calls + booking confirmation
const bookedLeads = ["Arjun", "Reyansh"];
for (const fn of bookedLeads) {
  const leadId = id(fn);
  await db.insert(schema.calls).values({
    id: randomUUID(),
    leadId,
    clientId,
    outcome: "booked",
    durationSec: 240 + Math.floor(Math.random() * 120),
    sentiment: "positive",
    summary: `${fn} booked a meeting to discuss enterprise plan`,
    bant: { budget: "yes", authority: "CTO", need: "platform migration", timeline: "2 weeks" },
    startedAt: new Date(Date.now() - 86400000),
    endedAt: new Date(Date.now() - 86400000 + 300000),
    attemptNumber: 1,
  });
  await db.insert(schema.calls).values({
    id: randomUUID(),
    leadId,
    clientId,
    outcome: "booked",
    durationSec: 60,
    sentiment: "positive",
    summary: `Booking confirmation call with ${fn} — meeting confirmed`,
    bant: { budget: "approved", authority: "CTO", need: "confirmed", timeline: "this week" },
    startedAt: new Date(Date.now() - 7200000),
    endedAt: new Date(Date.now() - 6900000),
    attemptNumber: 2,
  });
}

// For qualified leads: 2-3 calls each
const qualifiedLeads = ["Tanya", "Siddharth"];
for (const fn of qualifiedLeads) {
  const leadId = id(fn);
  await db.insert(schema.calls).values({
    id: randomUUID(),
    leadId,
    clientId,
    outcome: "booked",
    durationSec: 300 + Math.floor(Math.random() * 120),
    sentiment: "positive",
    summary: `${fn} — deep-dive demo completed, very interested`,
    bant: { budget: "approved", authority: "C-suite", need: "enterprise automation", timeline: "immediate" },
    startedAt: new Date(Date.now() - 86400000 * 3),
    endedAt: new Date(Date.now() - 86400000 * 3 + 360000),
    attemptNumber: 1,
  });
  await db.insert(schema.calls).values({
    id: randomUUID(),
    leadId,
    clientId,
    outcome: "booked",
    durationSec: 180,
    sentiment: "positive",
    summary: `${fn} — meeting confirmed for proposal review`,
    bant: { budget: "yes", authority: "yes", need: "yes", timeline: "next week" },
    startedAt: new Date(Date.now() - 86400000),
    endedAt: new Date(Date.now() - 86400000 + 180000),
    attemptNumber: 2,
  });
}

// For converted leads: 3 calls each (full cycle)
const convertedLeads = ["Meera", "Aditya"];
for (const fn of convertedLeads) {
  const leadId = id(fn);
  await db.insert(schema.calls).values({
    id: randomUUID(),
    leadId,
    clientId,
    outcome: "interested",
    durationSec: 150,
    sentiment: "positive",
    summary: `${fn} — initial call, strong interest in platform`,
    bant: { budget: "yes", authority: "yes", need: "yes", timeline: "1 month" },
    startedAt: new Date(Date.now() - 86400000 * 5),
    endedAt: new Date(Date.now() - 86400000 * 5 + 150000),
    attemptNumber: 1,
  });
  await db.insert(schema.calls).values({
    id: randomUUID(),
    leadId,
    clientId,
    outcome: "booked",
    durationSec: 240,
    sentiment: "positive",
    summary: `${fn} — demo completed, meeting booked for proposal`,
    bant: { budget: "approved", authority: "decision-maker", need: "confirmed", timeline: "2 weeks" },
    startedAt: new Date(Date.now() - 86400000 * 3),
    endedAt: new Date(Date.now() - 86400000 * 3 + 240000),
    attemptNumber: 2,
  });
  await db.insert(schema.calls).values({
    id: randomUUID(),
    leadId,
    clientId,
    outcome: "booked",
    durationSec: 120,
    sentiment: "positive",
    summary: `${fn} — proposal presented, deal closed`,
    bant: { budget: "paid", authority: "yes", need: "delivered", timeline: "signed" },
    startedAt: new Date(Date.now() - 86400000),
    endedAt: new Date(Date.now() - 86400000 + 120000),
    attemptNumber: 3,
  });
}

// For parked leads: 1 call each (not interested)
const parkedLeads = ["Priya", "Sanya"];
for (const fn of parkedLeads) {
  const leadId = id(fn);
  await db.insert(schema.calls).values({
    id: randomUUID(),
    leadId,
    clientId,
    outcome: "not_interested",
    durationSec: 45,
    sentiment: "negative",
    summary: `${fn} — not interested at this time`,
    bant: { budget: "no", authority: "no", need: "no", timeline: "none" },
    startedAt: new Date(Date.now() - 86400000 * 4),
    endedAt: new Date(Date.now() - 86400000 * 4 + 45000),
    attemptNumber: 1,
  });
}

// For lost leads: 3 calls each (exhausted retries)
const lostLeads = ["Kabir", "Tanvi"];
for (const fn of lostLeads) {
  const leadId = id(fn);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await db.insert(schema.calls).values({
      id: randomUUID(),
      leadId,
      clientId,
      outcome: attempt < 3 ? "no_answer" : "failed",
      durationSec: 0,
      sentiment: "neutral",
      summary: `Attempt ${attempt}: ${fn} — no answer`,
      startedAt: new Date(Date.now() - 86400000 * (4 - attempt)),
      endedAt: new Date(Date.now() - 86400000 * (4 - attempt)),
      attemptNumber: attempt,
    });
  }
}

// ── Messages ──
// Interested leads: WA + Gmail
for (const fn of interestedLeads) {
  const leadId = id(fn);
  const callId = randomUUID();

  await db.insert(schema.messages).values({
    id: randomUUID(),
    leadId,
    clientId,
    callId,
    channel: "whatsapp",
    direction: "outbound",
    body: `Hi ${fn}, thanks for your interest! Here's the info we discussed. Book a meeting at your convenience.`,
    templateName: "info_send_v1",
    sentAt: new Date(Date.now() - 3600000),
  });

  await db.insert(schema.messages).values({
    id: randomUUID(),
    leadId,
    clientId,
    callId,
    channel: "gmail",
    direction: "outbound",
    body: `Following up on our conversation. Product demo and pricing details attached.`,
    sentAt: new Date(Date.now() - 3500000),
  });
}

// Booked leads: WA confirmation
for (const fn of bookedLeads) {
  const leadId = id(fn);
  await db.insert(schema.messages).values({
    id: randomUUID(),
    leadId,
    clientId,
    callId: randomUUID(),
    channel: "whatsapp",
    direction: "outbound",
    body: `Meeting confirmed with ${fn}! Calendar invite sent. Join link will be shared 1 hour before.`,
    templateName: "meeting_link_v1",
    sentAt: new Date(Date.now() - 7200000),
  });
}

// ── Bookings ──
// 1 booking: tomorrow (for Arjun)
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
tomorrow.setHours(10, 30, 0, 0);

await db.insert(schema.bookings).values({
  id: randomUUID(),
  leadId: id("Arjun"),
  clientId,
  callId: randomUUID(),
  status: "scheduled",
  scheduledAt: tomorrow,
  durationMin: 30,
  meetingUrl: "https://meet.google.com/abc-defg-hij",
  notes: "Enterprise plan demo — bring pricing deck",
  reminderDayBeforeSent: false,
  reminderDayOfSent: false,
});

// 1 booking: in 3 days (for Reyansh)
const in3Days = new Date();
in3Days.setDate(in3Days.getDate() + 3);
in3Days.setHours(14, 0, 0, 0);

await db.insert(schema.bookings).values({
  id: randomUUID(),
  leadId: id("Reyansh"),
  clientId,
  callId: randomUUID(),
  status: "scheduled",
  scheduledAt: in3Days,
  durationMin: 45,
  meetingUrl: "https://meet.google.com/xyz-uvwx-rst",
  notes: "Growth plan review — discuss integration timeline",
  reminderDayBeforeSent: false,
  reminderDayOfSent: false,
});

// ── Retry Queue ──
// 2 entries: one for a lost lead needing retry, one for a new hot lead
await db.insert(schema.retryQueue).values({
  id: randomUUID(),
  leadId: id("Kabir"),
  clientId,
  attempt: 3,
  reason: "no_answer",
  nextAttemptAt: new Date(Date.now() + 4 * 3600000),
  maxAttempts: 3,
  status: "pending",
});

await db.insert(schema.retryQueue).values({
  id: randomUUID(),
  leadId: id("Tanvi"),
  clientId,
  attempt: 2,
  reason: "failed",
  nextAttemptAt: new Date(Date.now() + 3600000),
  maxAttempts: 3,
  status: "pending",
});

// ── KPI Daily ──
const today = new Date().toISOString().split("T")[0];

await db.insert(schema.kpiDaily).values({
  id: randomUUID(),
  clientId,
  date: today,
  leadsPulled: 20,
  leadsReused: 5,
  callsMade: 18,
  callsAnswered: 12,
  meetingsBooked: 4,
  costApollo: 42000,
  costVobiz: 18000,
  costGemini: 3500,
}).onConflictDoNothing();

// ── Summary ──
console.log("=== Seed Complete ===");
console.log(`Client: ${clientId}`);
console.log(`Leads: ${leads.length}`);
console.log(`  - new/cold: 3`);
console.log(`  - contacted/warm: 3`);
console.log(`  - interested/hot: 2`);
console.log(`  - booked/hot: 2`);
console.log(`  - qualified/hot: 2`);
console.log(`  - converted/hot: 2`);
console.log(`  - parked/cold: 2`);
console.log(`  - lost/cold: 2`);
console.log(`  - new/hot: 2`);
console.log(`Calls: ~25`);
console.log(`Messages: 6`);
console.log(`Bookings: 2`);
console.log(`Retry queue: 2`);
console.log(`KPI daily: 1`);
process.exit(0);
