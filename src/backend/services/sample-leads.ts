import { randomUUID } from "node:crypto";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/backend/db/schema";

export type Database = PostgresJsDatabase<typeof schema>;

export interface SampleLead {
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  city: string;
  industry: string;
  email: string;
}

function generateLeadsForProfile(profile: {
  companyName: string;
  industry?: string | null;
  location?: string | null;
  category?: string | null;
}): SampleLead[] {
  const industry = profile.industry || profile.category || "Technology";
  const location = profile.location || "Mumbai";
  const company = profile.companyName;

  return [
    {
      firstName: "Priya",
      lastName: "Sharma",
      title: "Head of Growth",
      company,
      city: location.split(",")[0]?.trim() || "Mumbai",
      industry,
      email: `priya.sharma@${company.toLowerCase().replace(/[^a-z0-9]/g, "")}.example.com`,
    },
    {
      firstName: "Rahul",
      lastName: "Mehta",
      title: "VP Sales",
      company,
      city: location.split(",")[0]?.trim() || "Mumbai",
      industry,
      email: `rahul.mehta@${company.toLowerCase().replace(/[^a-z0-9]/g, "")}.example.com`,
    },
    {
      firstName: "Anita",
      lastName: "Patel",
      title: "Marketing Director",
      company,
      city: location.split(",")[0]?.trim() || "Mumbai",
      industry,
      email: `anita.patel@${company.toLowerCase().replace(/[^a-z0-9]/g, "")}.example.com`,
    },
  ];
}

export async function generateSampleLeads(
  db: Database,
  tenantId: string,
  profile: {
    companyName: string;
    industry?: string | null;
    location?: string | null;
    category?: string | null;
    website?: string | null;
  },
): Promise<string[]> {
  const sampleLeads = generateLeadsForProfile(profile);
  const leadIds: string[] = [];

  for (const lead of sampleLeads) {
    const leadId = `lead_${randomUUID().slice(0, 8)}`;
    try {
      await db.insert(schema.leads).values({
        id: leadId,
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        company: lead.company,
        title: lead.title,
        city: lead.city,
        industry: lead.industry,
        sourceRef: "onboarding_sample",
        rawData: { generatedFor: tenantId, sample: true },
        icpTags: [lead.title.toLowerCase(), lead.industry.toLowerCase()],
      });

      await db.insert(schema.clientLeads).values({
        id: `cl_${randomUUID().slice(0, 8)}`,
        clientId: tenantId,
        leadId,
        score: 75,
        band: "warm",
        status: "new",
      });

      leadIds.push(leadId);
    } catch (error) {
      console.warn("[sample-leads] failed to create lead", error);
    }
  }

  return leadIds;
}
