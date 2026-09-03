import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/backend/db";
import { sql, desc, asc, eq, and, or, ilike } from "drizzle-orm";
import { getSession } from "@/backend/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
  const band = searchParams.get("band");
  const status = searchParams.get("status");
  const search = searchParams.get("search")?.trim();
  const order = searchParams.get("order") || "desc";

  const offset = (page - 1) * limit;

  // Build conditions — combined with AND
  const conditions: ReturnType<typeof eq>[] = [eq(schema.clientLeads.clientId, session.activeOrganizationId)];
  if (band) conditions.push(eq(schema.clientLeads.band, band as "hot" | "warm" | "cold"));
  if (status) conditions.push(eq(schema.clientLeads.status, status as typeof schema.clientLeads.status._.data));

  // Search uses ilike with escaped wildcards, parameterized via drizzle
  const searchPattern = search ? `%${search.replace(/[%_\\]/g, "\\$&")}%` : null;
  if (searchPattern) {
    conditions.push(
      or(
        ilike(schema.leads.firstName, searchPattern),
        ilike(schema.leads.lastName, searchPattern),
        ilike(schema.leads.company, searchPattern),
      ) as unknown as ReturnType<typeof eq>,
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Query with where before limit/offset
  let query = db
    .select({
      id: schema.clientLeads.id,
      leadId: schema.clientLeads.leadId,
      clientId: schema.clientLeads.clientId,
      score: schema.clientLeads.score,
      band: schema.clientLeads.band,
      status: schema.clientLeads.status,
      reusedFrom: schema.clientLeads.reusedFrom,
      assignedAt: schema.clientLeads.assignedAt,
      lastCallAt: schema.clientLeads.lastCallAt,
      attemptCount: schema.clientLeads.attemptCount,
      firstName: schema.leads.firstName,
      lastName: schema.leads.lastName,
      email: schema.leads.email,
      phone: schema.leads.phoneE164,
      company: schema.leads.company,
      title: schema.leads.title,
      city: schema.leads.city,
      industry: schema.leads.industry,
    })
    .from(schema.clientLeads)
    .innerJoin(schema.leads, eq(schema.clientLeads.leadId, schema.leads.id));

  if (whereClause) query = query.where(whereClause) as typeof query;

  // Order before limit
  query = query.orderBy(order === "asc" ? asc(schema.clientLeads.score) : desc(schema.clientLeads.score)) as typeof query;

  const leads = await query.limit(limit).offset(offset);

  // Total count with same filters
  let countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.clientLeads)
    .innerJoin(schema.leads, eq(schema.clientLeads.leadId, schema.leads.id));

  if (whereClause) countQuery = countQuery.where(whereClause) as typeof countQuery;

  const [{ count: total }] = await countQuery;

  return NextResponse.json({ leads, total, page, limit });
}
