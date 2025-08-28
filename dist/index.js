import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { auth } from "./auth.js";
const app = new Hono();
// CORS middleware first
app.use("*", cors({
    origin: ["handypay://", "https://handypay-backend.onrender.com"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
}));
// Health check endpoint
app.get("/", (c) => {
    return c.json({
        message: "HandyPay Auth Server is running!",
        auth: !!auth,
        env: {
            hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
            hasGoogleClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
            hasBetterAuthUrl: !!process.env.BETTER_AUTH_URL,
            hasBetterAuthSecret: !!process.env.BETTER_AUTH_SECRET,
            hasDatabaseUrl: !!process.env.DATABASE_URL,
        },
    });
});
// Test route to check Better Auth initialization
app.get("/test-auth", async (c) => {
    try {
        console.log("Testing Better Auth initialization...");
        // Try to call a simple Better Auth API method
        const result = await auth.api.listSessions({
            headers: c.req.raw.headers,
        });
        return c.json({ message: "Better Auth is working", result });
    }
    catch (error) {
        console.error("Better Auth test error:", error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const errorStack = error instanceof Error ? error.stack : undefined;
        return c.json({ error: errorMessage, stack: errorStack }, 500);
    }
});
// Auth verification endpoint for mobile app
app.post("/auth/verify", async (c) => {
    try {
        const { provider, tokens, userInfo } = await c.req.json();
        console.log(`Verifying ${provider} authentication:`, {
            hasAccessToken: !!tokens?.access_token,
            hasIdToken: !!tokens?.id_token,
            hasRefreshToken: !!tokens?.refresh_token,
            userInfo: userInfo
                ? { name: userInfo.name, email: userInfo.email }
                : null,
        });
        // Here you would typically:
        // 1. Verify the token with the provider
        // 2. Create or update user in your database
        // 3. Return user session/token
        // For now, just validate the request structure
        if (!provider || !tokens) {
            return c.json({ error: "Missing provider or tokens" }, 400);
        }
        // Mock successful verification
        return c.json({
            success: true,
            message: `${provider} authentication verified`,
            user: {
                id: userInfo?.id || userInfo?.sub,
                email: userInfo?.email,
                name: userInfo?.name,
                provider: provider,
            },
        });
    }
    catch (error) {
        console.error("Auth verification error:", error);
        return c.json({
            error: "Verification failed",
            details: error instanceof Error ? error.message : "Unknown error",
        }, 500);
    }
});
// Better Auth handler - this should handle ALL /auth/* routes
app.all("/auth/*", async (c) => {
    console.log(`Better Auth route: ${c.req.method} ${c.req.url}`);
    console.log("Request headers:", Object.fromEntries(c.req.raw.headers.entries()));
    try {
        const response = await auth.handler(c.req.raw);
        console.log("Better Auth response status:", response.status);
        return response;
    }
    catch (error) {
        console.error("Better Auth error:", error);
        const errorMessage = error instanceof Error ? error.message : "Unknown authentication error";
        return c.json({ error: "Authentication error", details: errorMessage }, 500);
    }
});
const port = parseInt(process.env.PORT || "3000");
console.log(`🚀 Server starting on port ${port}`);
console.log(`📍 Better Auth URL: ${process.env.BETTER_AUTH_URL}`);
console.log(`🔑 Google Client ID configured: ${!!process.env.GOOGLE_CLIENT_ID}`);
serve({
    fetch: app.fetch,
    port,
});
