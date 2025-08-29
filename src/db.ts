import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

// Always use PostgreSQL since we're deploying to Render with PostgreSQL
console.log("🔌 Initializing database connection...");
console.log("📍 DATABASE_URL present:", !!process.env.DATABASE_URL);
console.log("🌍 NODE_ENV:", process.env.NODE_ENV);

let db: any;

try {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  // Create PostgreSQL connection
  const client = postgres(process.env.DATABASE_URL, {
    prepare: false,
    max: 1, // Render free tier limitation
  });

  // Create database instance
  db = drizzle(client, { schema });

  console.log("✅ Database connection established");
} catch (error) {
  console.error("❌ Database connection failed during initialization:", error);
  console.log("⚠️  Server will continue without database connection");
  console.log("💡 Check your DATABASE_URL and database status");

  // Create a mock database object that will fail gracefully
  db = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => [] }) }) }),
    insert: () => ({ values: () => ({}) }),
    update: () => ({ set: () => ({ where: () => ({}) }) }),
    execute: () => Promise.reject(new Error("Database not connected")),
  };
}

export { db };
