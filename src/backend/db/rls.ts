import { sql } from "drizzle-orm";
import { db } from "./index";
import * as schema from "./schema";

type Database = typeof db;

// ── RLS SQL Statements ──
// Each tenant-owned table gets ENABLE ROW LEVEL SECURITY + a tenant_isolation policy.
// Tables with client_id / organization_id / tenant_id use the direct column.
// Tables without a direct tenant column use a subquery through the parent.

export const rlsSql: string[] = [
  // ── client_id tables ──
  "ALTER TABLE client_leads ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON client_leads;",
  "CREATE POLICY tenant_isolation ON client_leads USING (client_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE calls ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON calls;",
  "CREATE POLICY tenant_isolation ON calls USING (client_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE messages ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON messages;",
  "CREATE POLICY tenant_isolation ON messages USING (client_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE consent ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON consent;",
  "CREATE POLICY tenant_isolation ON consent USING (client_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE retry_queue ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON retry_queue;",
  "CREATE POLICY tenant_isolation ON retry_queue USING (client_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE kpi_daily ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON kpi_daily;",
  "CREATE POLICY tenant_isolation ON kpi_daily USING (client_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON bookings;",
  "CREATE POLICY tenant_isolation ON bookings USING (client_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE inbound_messages ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON inbound_messages;",
  "CREATE POLICY tenant_isolation ON inbound_messages USING (client_id = current_setting('app.tenant_id')::text);",

  // ── organization_id tables ──
  "ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON subscriptions;",
  "CREATE POLICY tenant_isolation ON subscriptions USING (organization_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE payments ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON payments;",
  "CREATE POLICY tenant_isolation ON payments USING (organization_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON wallets;",
  "CREATE POLICY tenant_isolation ON wallets USING (organization_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON wallet_transactions;",
  "CREATE POLICY tenant_isolation ON wallet_transactions USING (wallet_id IN (SELECT id FROM wallets WHERE organization_id = current_setting('app.tenant_id')::text));",

  "ALTER TABLE entitlement_usage ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON entitlement_usage;",
  "CREATE POLICY tenant_isolation ON entitlement_usage USING (organization_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON business_profiles;",
  "CREATE POLICY tenant_isolation ON business_profiles USING (organization_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON organization_members;",
  "CREATE POLICY tenant_isolation ON organization_members USING (organization_id = current_setting('app.tenant_id')::text);",

  // ── tenant_id tables ──
  "ALTER TABLE graph_runs ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON graph_runs;",
  "CREATE POLICY tenant_isolation ON graph_runs USING (tenant_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON agent_runs;",
  "CREATE POLICY tenant_isolation ON agent_runs USING (graph_run_id IN (SELECT id FROM graph_runs WHERE tenant_id = current_setting('app.tenant_id')::text));",

  "ALTER TABLE tool_executions ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON tool_executions;",
  "CREATE POLICY tenant_isolation ON tool_executions USING (agent_run_id IN (SELECT id FROM agent_runs WHERE graph_run_id IN (SELECT id FROM graph_runs WHERE tenant_id = current_setting('app.tenant_id')::text)));",

  "ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON webhook_events;",
  "CREATE POLICY tenant_isolation ON webhook_events USING (tenant_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE integration_credentials ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON integration_credentials;",
  "CREATE POLICY tenant_isolation ON integration_credentials USING (tenant_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON audit_logs;",
  "CREATE POLICY tenant_isolation ON audit_logs USING (tenant_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE config_snapshots ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON config_snapshots;",
  "CREATE POLICY tenant_isolation ON config_snapshots USING (tenant_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE phone_numbers ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON phone_numbers;",
  "CREATE POLICY tenant_isolation ON phone_numbers USING (tenant_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE lead_memory ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON lead_memory;",
  "CREATE POLICY tenant_isolation ON lead_memory USING (tenant_id = current_setting('app.tenant_id')::text);",

  // ── tables without a direct tenant column (subquery through parent) ──
  "ALTER TABLE call_events ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON call_events;",
  "CREATE POLICY tenant_isolation ON call_events USING (call_id IN (SELECT id FROM calls WHERE client_id = current_setting('app.tenant_id')::text));",

  "ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON outbox_events;",
  "CREATE POLICY tenant_isolation ON outbox_events USING (tenant_id = current_setting('app.tenant_id')::text);",

  "ALTER TABLE inbox_events ENABLE ROW LEVEL SECURITY;",
  "DROP POLICY IF EXISTS tenant_isolation ON inbox_events;",
  "CREATE POLICY tenant_isolation ON inbox_events USING (tenant_id = current_setting('app.tenant_id')::text);",
];

/**
 * Set the tenant context for the current transaction.
 * Must be called inside an active transaction — SET LOCAL is transaction-scoped.
 *
 * @example
 *   await db.transaction(async (tx) => {
 *     await setTenantContext(tx, "org_abc123");
 *     const leads = await tx.select().from(clientLeads); // auto-filtered by RLS
 *   });
 */
export async function setTenantContext(
  database: Database,
  tenantId: string,
): Promise<void> {
  await database.execute(sql`SET LOCAL app.tenant_id = ${tenantId}`);
}

/**
 * Execute all RLS SQL statements: enables row-level security and creates
 * tenant_isolation policies on every tenant-owned table.
 */
export async function applyRls(database: Database): Promise<void> {
  for (const stmt of rlsSql) {
    await database.execute(sql.raw(stmt));
  }
}
