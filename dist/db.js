import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
// Use lazy loading to avoid issues during Cloudflare Workers deployment
let dbInstance = null;
let lastConnectionTime = 0;
let connectionAttempts = 0;
let isInitializing = false; // Prevent concurrent initialization
// Store environment variables for database connection
let envVars = null;
export function initializeDatabase(env) {
    if (!envVars) {
        envVars = env;
        console.log("🔧 Database environment initialized");
    }
}
function getDatabaseInstance() {
    const now = Date.now();
    // Reset connection if it's been more than 30 seconds (serverless optimization)
    if (dbInstance && now - lastConnectionTime > 30000) {
        console.log("🔄 Resetting stale database connection");
        dbInstance = null;
    }
    if (!dbInstance) {
        // Prevent concurrent initialization
        if (isInitializing) {
            console.log("⏳ Database initialization already in progress, waiting...");
            // Simple busy wait - in production you'd want a proper queue
            let waitCount = 0;
            while (isInitializing && waitCount < 50) {
                // Max 5 seconds wait
                waitCount++;
                // Small delay
                const start = Date.now();
                while (Date.now() - start < 100) { } // Busy wait 100ms
            }
            if (dbInstance) {
                console.log("✅ Database initialization completed, returning instance");
                return dbInstance;
            }
            else {
                console.error("❌ Database initialization timeout");
                throw new Error("Database initialization timeout");
            }
        }
        if (!envVars) {
            throw new Error("Database not initialized - call initializeDatabase() first");
        }
        // Try different environment variable access patterns for Cloudflare Workers
        const DATABASE_URL = envVars?.DATABASE_URL || envVars?.DATABASE_URL;
        if (!DATABASE_URL) {
            console.error("DATABASE_URL not found in environment variables");
            throw new Error("DATABASE_URL is required");
        }
        // Set initialization flag
        isInitializing = true;
        try {
            connectionAttempts++;
            console.log(`🔗 Creating database connection (attempt ${connectionAttempts})`);
            // Configure postgres client for Cloudflare Workers
            const client = postgres(DATABASE_URL, {
                // Optimize for Cloudflare Workers serverless environment
                max: 1, // Single connection per request
                idle_timeout: 5, // Short timeout
                connect_timeout: 5, // Fast connection timeout
                // Handle connection errors gracefully
                onnotice: () => { }, // Ignore notices
                onparameter: () => { }, // Ignore parameter status messages
                // Additional Cloudflare Workers optimizations
                keep_alive: 0, // Disable keep alive for serverless
            });
            dbInstance = drizzle(client, { schema });
            lastConnectionTime = now;
            console.log("✅ Database connection established successfully");
        }
        catch (error) {
            console.error("❌ Failed to create database connection:", error);
            isInitializing = false; // Reset flag on error
            throw error;
        }
        // Reset initialization flag
        isInitializing = false;
    }
    return dbInstance;
}
export const db = new Proxy({}, {
    get(target, prop) {
        const instance = getDatabaseInstance();
        return instance[prop];
    },
});
