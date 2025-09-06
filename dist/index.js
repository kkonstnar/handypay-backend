import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth.js";
import { apiRoutes } from "./routes/index.js";
const app = new Hono();
// CORS middleware
app.use("*", cors({
    origin: ["handypay://", "https://handypay-backend.handypay.workers.dev"],
    allowHeaders: ["Content-Type", "Authorization", "Cookie"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
}));
// Authentication middleware for protected routes
const authMiddleware = async (c, next) => {
    try {
        const session = await auth.api.getSession({
            headers: c.req.raw.headers,
        });
        if (!session) {
            return c.json({ error: "Unauthorized - Please log in" }, 401);
        }
        // Add user to context for use in route handlers
        c.set("user", session.user);
        c.set("session", session);
        await next();
    }
    catch (error) {
        console.error("Auth middleware error:", error);
        return c.json({ error: "Authentication failed" }, 401);
    }
};
// Authorization helper function
const requireOwnership = (authenticatedUserId, requestedUserId) => {
    if (authenticatedUserId !== requestedUserId) {
        throw new Error("Forbidden - You can only access your own data");
    }
};
// Input sanitization helper functions
const sanitizeEmail = (email) => {
    return email.trim().toLowerCase();
};
const sanitizeString = (input) => {
    return input.trim().replace(/[<>]/g, ""); // Basic XSS prevention
};
const validateEmail = (email) => {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
};
// Apply authentication to sensitive routes (excluding user sync for initial registration)
app.use("/api/users/*", async (c, next) => {
    // Skip auth for user sync endpoint (used for initial user registration)
    if (c.req.path === "/api/users/sync") {
        return next();
    }
    return authMiddleware(c, next);
});
app.use("/api/stripe/*", authMiddleware);
app.use("/api/transactions/*", authMiddleware);
app.use("/api/payouts/*", authMiddleware);
// Mount Better Auth routes (commented out for now - needs proper integration)
// app.all('/api/auth/*', async (c) => {
//   return await auth.handler(c.req.raw);
// });
// Health check endpoint
app.get("/", (c) => {
    return c.json({
        message: "HandyPay Auth Server is running!",
        timestamp: new Date().toISOString(),
        version: "1.0.1",
        authType: "Apple-only",
        status: "clean",
    });
});
// Database test endpoint
app.get("/test-db", async (c) => {
    try {
        console.log("Testing database connection...");
        console.log("DATABASE_URL available:", !!process.env.DATABASE_URL);
        console.log("DATABASE_URL starts with:", process.env.DATABASE_URL?.substring(0, 20));
        // Use the database instance with fallback env support
        const { getDb } = await import("./utils/database.js");
        const db = getDb(c.env);
        const result = await db.execute("SELECT 1 as test");
        return c.json({
            success: true,
            message: "Database connected",
            result: result,
        });
    }
    catch (error) {
        console.error("Database error details:", error);
        return c.json({
            success: false,
            error: "Database not connected",
            details: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString(),
        }, 500);
    }
});
// Mount API routes
app.route("/api", apiRoutes);
// Debug endpoints
app.get("/api/debug/check-columns", async (c) => {
    try {
        console.log("🔍 Checking database columns...");
        // Check if users table has the required columns
        const { db } = await import("./db.js");
        const { sql } = await import("drizzle-orm");
        const { users } = await import("./schema.js");
        const usersColumns = await db.execute(sql `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'users'
      AND column_name IN ('stripe_account_id', 'stripe_onboarding_completed')
      ORDER BY column_name;
    `);
        // Check if transactions table exists
        const transactionsTable = await db.execute(sql `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'transactions';
    `);
        return c.json({
            success: true,
            usersColumns: usersColumns,
            transactionsTable: transactionsTable,
        });
    }
    catch (error) {
        console.error("❌ Debug check error:", error);
        return c.json({
            error: "Failed to check database",
            details: error instanceof Error ? error.message : "Unknown error",
        }, 500);
    }
});
// Debug endpoint to manually update user Stripe account
app.post("/api/debug/update-stripe-account", async (c) => {
    try {
        const { userId, stripeAccountId } = await c.req.json();
        console.log(`🔧 Manually updating user ${userId} with Stripe account ${stripeAccountId}`);
        const { db } = await import("./db.js");
        const { users } = await import("./schema.js");
        const { eq } = await import("drizzle-orm");
        const result = await db
            .update(users)
            .set({
            stripeAccountId: stripeAccountId,
            stripeOnboardingCompleted: true,
            updatedAt: new Date(),
        })
            .where(eq(users.id, userId));
        return c.json({
            success: true,
            message: "Stripe account updated successfully",
            userId,
            stripeAccountId,
        });
    }
    catch (error) {
        console.error("❌ Error updating Stripe account:", error);
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        }, 500);
    }
});
// Debug endpoint to test basic database write
app.post("/api/debug/test-update", async (c) => {
    try {
        const { userId } = await c.req.json();
        console.log(`🔧 Testing database update for user ${userId}`);
        // First, let's see what the current user data looks like
        const { db } = await import("./db.js");
        const { users } = await import("./schema.js");
        const { eq } = await import("drizzle-orm");
        const currentUser = await db
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        console.log(`📊 Current user data:`, currentUser[0]);
        const result = await db
            .update(users)
            .set({
            email: "updated-" + Date.now() + "@test.com",
            updatedAt: new Date(),
        })
            .where(eq(users.id, userId));
        console.log(`✅ Basic update result:`, result);
        // Now check what it looks like after the update
        const updatedUser = await db
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        console.log(`📊 Updated user data:`, updatedUser[0]);
        return c.json({
            success: true,
            message: "Basic update test completed",
            before: currentUser[0],
            after: updatedUser[0],
        });
    }
    catch (error) {
        console.error("❌ Debug test error:", error);
        return c.json({
            error: "Failed to test update",
            details: error instanceof Error ? error.message : "Unknown error",
        }, 500);
    }
});
// Export the authorization helper for use in routes
export { requireOwnership };
// Cloudflare Workers export
export default {
    fetch: app.fetch,
    async scheduled(event, env, ctx) {
        // Handle scheduled tasks if needed
    },
};
