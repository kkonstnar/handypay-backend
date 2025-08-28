import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { auth } from "./auth.js";
import { StripeService } from "./stripe.js";
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
// Stripe Connect endpoint for creating account links
app.post("/api/stripe/create-account-link", async (c) => {
    try {
        const requestData = await c.req.json();
        console.log("Stripe onboarding request:", requestData);
        const { userId, account_id, refresh_url, return_url, firstName, lastName, email, } = requestData;
        if (!userId ||
            !refresh_url ||
            !return_url ||
            !firstName ||
            !lastName ||
            !email) {
            return c.json({
                error: "Missing required fields: userId, refresh_url, return_url, firstName, lastName, email",
            }, 400);
        }
        const result = await StripeService.createAccountLink({
            userId,
            account_id,
            firstName,
            lastName,
            email,
            refresh_url,
            return_url,
        });
        return c.json(result);
    }
    catch (error) {
        console.error("Stripe account link creation error:", error);
        return c.json({
            error: error instanceof Error
                ? error.message
                : "Failed to create Stripe account link",
        }, 500);
    }
});
// Stripe Connect endpoint for checking account status
app.get("/api/stripe/account-status/:accountId", async (c) => {
    try {
        const accountId = c.req.param("accountId");
        if (!accountId) {
            return c.json({ error: "Account ID is required" }, 400);
        }
        const status = await StripeService.getAccountStatus(accountId);
        return c.json(status);
    }
    catch (error) {
        console.error("Stripe account status error:", error);
        return c.json({
            error: error instanceof Error
                ? error.message
                : "Failed to retrieve account status",
        }, 500);
    }
});
// Stripe Connect endpoint for getting user's Stripe account
app.get("/api/stripe/user-account/:userId", async (c) => {
    try {
        const userId = c.req.param("userId");
        if (!userId) {
            return c.json({ error: "User ID is required" }, 400);
        }
        const stripeAccountId = await StripeService.getUserStripeAccount(userId);
        if (!stripeAccountId) {
            return c.json({ error: "No Stripe account found for user" }, 404);
        }
        return c.json({ stripeAccountId });
    }
    catch (error) {
        console.error("Stripe user account lookup error:", error);
        return c.json({
            error: error instanceof Error
                ? error.message
                : "Failed to retrieve user Stripe account",
        }, 500);
    }
});
// Stripe onboarding redirect endpoints
app.get("/stripe/return", async (c) => {
    console.log("Stripe onboarding completed - showing success page");
    const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Setup Complete</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        text-align: center;
        padding: 40px 20px;
        background: #f8fafc;
        margin: 0;
      }
      .container {
        max-width: 400px;
        margin: 0 auto;
        background: white;
        border-radius: 12px;
        padding: 32px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      }
      .success-icon {
        font-size: 48px;
        color: #10b981;
        margin-bottom: 16px;
      }
      h1 {
        color: #1f2937;
        font-size: 24px;
        font-weight: 600;
        margin: 0 0 8px 0;
      }
      p {
        color: #6b7280;
        font-size: 16px;
        line-height: 1.5;
        margin: 0 0 24px 0;
      }
      .button {
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 12px 24px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        text-decoration: none;
        display: inline-block;
        width: 100%;
        box-sizing: border-box;
      }
      .button:hover {
        background: #2563eb;
      }
      .secondary {
        background: #f3f4f6;
        color: #374151;
        margin-top: 12px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="success-icon">✅</div>
      <h1>Setup Complete!</h1>
      <p>Your Stripe merchant account has been successfully configured.</p>

      <div id="countdown" style="font-size: 14px; margin-top: 16px; color: #6b7280;">
        Returning to HandyPay in <span id="count">2</span> seconds...
      </div>

      <a href="handypay://stripe/success" class="button">
        Return to HandyPay
      </a>

      <p style="font-size: 14px; margin-top: 16px; color: #9ca3af;">
        If the automatic redirect doesn't work, tap the button above.
      </p>
    </div>

    <script>
      let count = 2;
      const countdownEl = document.getElementById('count');

      const countdown = setInterval(() => {
        count--;
        if (countdownEl) {
          countdownEl.textContent = count.toString();
        }

        if (count <= 0) {
          clearInterval(countdown);
          // Redirect immediately
          window.location.href = 'handypay://stripe/success';
        }
      }, 1000);

      // Also try immediate redirect for better UX
      setTimeout(() => {
        window.location.href = 'handypay://stripe/success';
      }, 500);
    </script>
  </body>
  </html>
  `;
    return c.html(html);
});
app.get("/stripe/refresh", async (c) => {
    console.log("Stripe onboarding refresh - user exited");
    const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Setup Cancelled</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        text-align: center;
        padding: 40px 20px;
        background: #f8fafc;
        margin: 0;
      }
      .container {
        max-width: 400px;
        margin: 0 auto;
        background: white;
        border-radius: 12px;
        padding: 32px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      }
      .icon {
        font-size: 48px;
        color: #f59e0b;
        margin-bottom: 16px;
      }
      h1 {
        color: #1f2937;
        font-size: 24px;
        font-weight: 600;
        margin: 0 0 8px 0;
      }
      p {
        color: #6b7280;
        font-size: 16px;
        line-height: 1.5;
        margin: 0 0 24px 0;
      }
      .button {
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 12px 24px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        text-decoration: none;
        display: inline-block;
        width: 100%;
        box-sizing: border-box;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="icon">⏸️</div>
      <h1>Setup Paused</h1>
      <p>You exited the Stripe setup process. You can continue later.</p>

      <div id="countdown" style="font-size: 14px; margin-top: 16px; color: #6b7280;">
        Returning to HandyPay in <span id="count">2</span> seconds...
      </div>

      <a href="handypay://stripe/refresh" class="button">
        Return to HandyPay
      </a>

      <p style="font-size: 14px; margin-top: 16px; color: #9ca3af;">
        If the automatic redirect doesn't work, tap the button above.
      </p>
    </div>

    <script>
      let count = 2;
      const countdownEl = document.getElementById('count');

      const countdown = setInterval(() => {
        count--;
        if (countdownEl) {
          countdownEl.textContent = count.toString();
        }

        if (count <= 0) {
          clearInterval(countdown);
          // Redirect immediately
          window.location.href = 'handypay://stripe/refresh';
        }
      }, 1000);

      // Also try immediate redirect for better UX
      setTimeout(() => {
        window.location.href = 'handypay://stripe/refresh';
      }, 500);
    </script>
  </body>
  </html>
  `;
    return c.html(html);
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
    hostname: "0.0.0.0", // Listen on all interfaces so iOS simulator can connect
});
