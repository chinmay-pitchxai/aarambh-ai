import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/backend/auth/middleware";
import { db } from "@/backend/db";
import { schema } from "@/backend/db";
import { eq, desc, like, or, and, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")));
  const search = searchParams.get("search")?.trim() || "";
  const offset = (page - 1) * limit;

  try {
    const conditions = [eq(schema.clientLeads.clientId, auth.ctx.tenantId)];

    if (search) {
      conditions.push(
        or(
          like(schema.leads.firstName, `%${search}%`),
          like(schema.leads.lastName, `%${search}%`),
          like(schema.leads.company, `%${search}%`),
          like(schema.leads.email, `%${search}%`),
        )!,
      );
    }

    const where = and(...conditions);

    const [rows, countResult] = await Promise.all([
      db
        .select({
          id: schema.clientLeads.id,
          leadId: schema.clientLeads.leadId,
          score: schema.clientLeads.score,
          band: schema.clientLeads.band,
          status: schema.clientLeads.status,
          reusedFrom: schema.clientLeads.reusedFrom,
          assignedAt: schema.clientLeads.assignedAt,
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
        .leftJoin(schema.leads, eq(schema.clientLeads.leadId, schema.leads.id))
        .where(where)
        .orderBy(desc(schema.clientLeads.assignedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(schema.clientLeads)
        .leftJoin(schema.leads, eq(schema.clientLeads.leadId, schema.leads.id))
        .where(eq(schema.clientLeads.clientId, auth.ctx.tenantId)),
    ]);

    const total = (countResult[0] as { value: number }).value ?? 0;

    return NextResponse.json({ leads: rows, total, page, limit });
  } catch (err) {
    console.error("[api/leads] GET error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
