import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

// Always use PostgreSQL since we're deploying to Render with PostgreSQL
console.log("🔌 Connecting to database...");
console.log("📍 DATABASE_URL present:", !!process.env.DATABASE_URL);
console.log("🌍 NODE_ENV:", process.env.NODE_ENV);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

// Create PostgreSQL connection
const client = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1, // Render free tier limitation
});

// Create database instance
export const db = drizzle(client, { schema });

console.log("✅ Database connection established");
