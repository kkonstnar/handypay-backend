import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema.js";

// Environment-aware database function for both local and Cloudflare
export function getDb(env: any) {
  // Try Cloudflare env first, then fall back to process.env for local development
  const DATABASE_URL = env?.DATABASE_URL || process.env.DATABASE_URL;

  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const client = postgres(DATABASE_URL);
  return drizzle(client, { schema });
}
