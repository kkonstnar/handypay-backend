import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
// Use lazy loading to avoid issues during Cloudflare Workers deployment
let dbInstance = null;
function getDatabaseInstance() {
    if (!dbInstance) {
        // Try different environment variable access patterns for Cloudflare Workers
        const DATABASE_URL = process.env.DATABASE_URL || globalThis.DATABASE_URL;
        if (!DATABASE_URL) {
            console.error("DATABASE_URL not found in environment");
            throw new Error("DATABASE_URL is required");
        }
        console.log("DATABASE_URL found, creating database connection");
        const client = postgres(DATABASE_URL);
        dbInstance = drizzle(client, { schema });
    }
    return dbInstance;
}
export const db = new Proxy({}, {
    get(target, prop) {
        const instance = getDatabaseInstance();
        return instance[prop];
    },
});
