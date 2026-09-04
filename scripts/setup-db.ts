import { db } from "../src/backend/db/index";
import { applyRls } from "../src/backend/db/rls";

// ── DB Setup ──
// Applies RLS + tenant isolation policies after `drizzle-kit push` has
// created the tables. Run: npm run db:setup

async function main() {
  console.log("Applying RLS + tenant isolation policies...");
  await applyRls(db);
  console.log("Done. Tenant isolation enabled.");
  process.exit(0);
}

main().catch((err) => {
  console.error("DB setup failed:", err);
  process.exit(1);
});
