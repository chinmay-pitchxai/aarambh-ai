import { db, schema } from "./src/backend/db/index";
import { randomUUID } from "crypto";

const clientId = "demo";
await db.insert(schema.clients).values({ id: clientId, name: "Demo Client", icpTags: ["vp-sales", "saas"] }).onConflictDoNothing();

const dummy = [
  // ICP — new, cold
  { fn: "Aarav", ln: "Sharma", co: "TechFlow", ti: "Founder", city: "Bangalore", band: "cold", status: "new", score: 32 },
  { fn: "Neha", ln: "Patel", co: "DataMinds", ti: "Associate", city: "Mumbai", band: "cold", status: "new", score: 28 },
  { fn: "Rohan", ln: "Gupta", co: "CloudNine", ti: "Analyst", city: "Delhi", band: "cold", status: "new", score: 35 },
  { fn: "Priya", ln: "Singh", co: "BrightLabs", ti: "Coordinator", city: "Pune", band: "cold", status: "new", score: 30 },
  // Following Up — contacted
  { fn: "Vikram", ln: "Mehta", co: "SaaSly", ti: "Manager", city: "Hyderabad", band: "warm", status: "contacted", score: 48 },
  { fn: "Ananya", ln: "Rao", co: "FinEdge", ti: "Senior Manager", city: "Chennai", band: "warm", status: "contacted", score: 52 },
  { fn: "Karan", ln: "Verma", co: "HealthKart", ti: "Lead", city: "Gurgaon", band: "warm", status: "contacted", score: 55 },
  // Warm
  { fn: "Sanya", ln: "Joshi", co: "EduTech Pro", ti: "Director", city: "Bangalore", band: "warm", status: "new", score: 62 },
  { fn: "Aditya", ln: "Kapoor", co: "RetailHub", ti: "VP Sales", city: "Mumbai", band: "warm", status: "new", score: 68 },
  { fn: "Meera", ln: "Desai", co: "LogiChain", ti: "Head of Growth", city: "Delhi", band: "warm", status: "new", score: 65 },
  // Hot
  { fn: "Arjun", ln: "Reddy", co: "FinTech Global", ti: "CTO", city: "Bangalore", band: "hot", status: "new", score: 88 },
  { fn: "Ishita", ln: "Nair", co: "SaaS Unicorn", ti: "CEO", city: "Mumbai", band: "hot", status: "new", score: 92 },
  { fn: "Kabir", ln: "Malhotra", co: "AI Ventures", ti: "VP Product", city: "Hyderabad", band: "hot", status: "new", score: 85 },
  // Calls Booked — qualified
  { fn: "Diya", ln: "Bansal", co: "MarketMinds", ti: "CMO", city: "Pune", band: "hot", status: "qualified", score: 90 },
  { fn: "Reyansh", ln: "Kumar", co: "GrowthLabs", ti: "Director", city: "Bangalore", band: "hot", status: "qualified", score: 87 },
  // Meetings Over — converted
  { fn: "Tanya", ln: "Shah", co: "Enterprise Co", ti: "CFO", city: "Mumbai", band: "hot", status: "converted", score: 95 },
  { fn: "Siddharth", ln: "Jain", co: "Unicorn SaaS", ti: "CEO", city: "Delhi", band: "hot", status: "converted", score: 93 },
];

for (const d of dummy) {
  const leadId = randomUUID();
  await db.insert(schema.leads).values({
    id: leadId,
    phoneE164: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: `${d.fn.toLowerCase()}.${d.ln.toLowerCase()}@${d.co.toLowerCase().replace(/\s/g, "")}.com`,
    firstName: d.fn,
    lastName: d.ln,
    company: d.co,
    title: d.ti,
    city: d.city,
    industry: "SaaS",
    companySize: "201-500",
    icpTags: ["vp-sales", "saas"],
    freshness: new Date(),
    dnc: 0,
  });
  await db.insert(schema.clientLeads).values({
    id: randomUUID(),
    clientId,
    leadId,
    score: d.score,
    band: d.band as "hot" | "warm" | "cold",
    status: d.status as "new" | "contacted" | "qualified" | "converted" | "parked",
  });
  // add a call for some
  if (["qualified", "converted", "contacted"].includes(d.status)) {
    await db.insert(schema.calls).values({
      id: randomUUID(),
      leadId,
      clientId,
      outcome: d.status === "qualified" ? "booked" : d.status === "converted" ? "booked" : "interested",
      durationSec: 120 + Math.floor(Math.random() * 180),
      sentiment: ["positive", "neutral", "positive"][Math.floor(Math.random() * 3)] as "positive" | "neutral" | "negative",
      summary: `${d.fn} showed ${d.status === "qualified" ? "strong interest, meeting requested" : "interest in pricing"}`,
      bant: { budget: "yes", authority: "yes", need: "yes", timeline: "2 weeks" },
      startedAt: new Date(Date.now() - Math.floor(Math.random() * 86400000 * 3)),
      endedAt: new Date(),
    });
  }
}

// kpiDaily
const today = new Date().toISOString().split("T")[0];
await db.insert(schema.kpiDaily).values({
  id: randomUUID(),
  clientId,
  date: today,
  leadsPulled: 17,
  leadsReused: 5,
  callsMade: 8,
  callsAnswered: 6,
  meetingsBooked: 4,
  costApollo: 35000,
  costVobiz: 12000,
}).onConflictDoNothing();

console.log("Seeded", dummy.length, "leads + calls + kpiDaily");
process.exit(0);
