import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
// Create the connection
const client = postgres(process.env.DATABASE_URL, { prepare: false });
// Create the database instance
export const db = drizzle(client, { schema });
