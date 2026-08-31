import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  console.warn("[db] DATABASE_URL not set — DB operations will fail. Set it in .env");
}

const client = postgres(url || "postgresql://surya@localhost:5432/aarambhai", {
  connect_timeout: 5,
});
export const db = drizzle(client, { schema });
export { schema };
