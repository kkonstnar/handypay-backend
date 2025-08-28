import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { auth } from "./auth.js";
import { StripeService } from "./stripe.js";
import { db } from "./db.js";

const app = new Hono();

// CORS middleware first
app.use(
  "*",
  cors({
    origin: ["handypay://", "https://handypay-backend.onrender.com"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

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
  } catch (error) {
    console.error("Better Auth test error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : undefined;
    return c.json({ error: errorMessage, stack: errorStack }, 500);
  }
});

// Stripe Connect endpoint for creating account links
app.post("/api/stripe/create-account-link", async (c) => {
  try {
    const requestData = await c.req.json();
    console.log("Stripe onboarding request:", requestData);

    const {
      userId,
      account_id,
      refresh_url,
      return_url,
      firstName,
      lastName,
      email,
    } = requestData;

    if (
      !userId ||
      !refresh_url ||
      !return_url ||
      !firstName ||
      !lastName ||
      !email
    ) {
      return c.json(
        {
          error:
            "Missing required fields: userId, refresh_url, return_url, firstName, lastName, email",
        },
        400
      );
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
  } catch (error) {
    console.error("Stripe account link creation error:", error);
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create Stripe account link",
      },
      500
    );
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
  } catch (error) {
    console.error("Stripe account status error:", error);
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to retrieve account status",
      },
      500
    );
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
  } catch (error) {
    console.error("Stripe user account lookup error:", error);
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to retrieve user Stripe account",
      },
      500
    );
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
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background-color: #ffffff;
        height: 100vh;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .header {
        padding: 24px 24px 8px;
        text-align: right;
      }
      .close-btn {
        background: none;
        border: none;
        font-size: 24px;
        color: #6b7280;
        cursor: pointer;
        padding: 8px;
        border-radius: 8px;
      }
      .close-btn:hover {
        background-color: #f3f4f6;
      }
      .center-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 0 24px;
      }
      .success-icon {
        width: 48px;
        height: 48px;
        margin-bottom: 16px;
      }
      .title {
        font-size: 28px;
        font-weight: 600;
        color: #111827;
        margin-bottom: 8px;
        text-align: center;
        letter-spacing: -1px;
      }
      .subtitle {
        font-size: 16px;
        color: #6b7280;
        text-align: center;
        line-height: 1.5;
        margin-bottom: 32px;
        padding: 0 16px;
      }
      .continue-btn {
        background-color: #3AB75C;
        color: white;
        border: none;
        border-radius: 24px;
        padding: 12px 24px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        width: 100%;
        max-width: 280px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        text-decoration: none;
        margin: 0 auto 24px;
      }
      .continue-btn:hover {
        background-color: #2d8f4c;
      }
      .footer-text {
        text-align: center;
        font-size: 14px;
        color: #9ca3af;
        margin-bottom: 24px;
        padding: 0 24px;
      }
    </style>
  </head>
  <body>
    <div class="header">
      <button class="close-btn" onclick="closeWindow()">✕</button>
    </div>

    <div class="center-content">
      <svg class="success-icon" width="48" height="48" viewBox="0 0 49 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M24.5 48C37.7548 48 48.5 37.2548 48.5 24C48.5 10.7452 37.7548 0 24.5 0C11.2452 0 0.5 10.7452 0.5 24C0.5 37.2548 11.2452 48 24.5 48Z" fill="#3AB75C"/>
        <path d="M38.2217 17.5032L25.2289 30.4969L24.4995 31.2263L20.5883 35.1366L15.9477 30.4969L10.7773 25.3257L15.418 20.685L20.5883 25.8563L24.4995 21.945L33.5811 12.8635L38.2217 17.5032Z" fill="white"/>
      </svg>
      <h1 class="title">Setup Complete!</h1>
      <p class="subtitle">Your Stripe merchant account has been successfully configured.</p>
      <a href="handypay://stripe/success" class="continue-btn">Continue to HandyPay</a>
    </div>

    <p class="footer-text">This page will automatically close and redirect to the app</p>

    <script>
      // Auto-redirect after 2 seconds
      setTimeout(() => {
        window.location.href = 'handypay://stripe/success';
      }, 2000);

      // Close window function for manual close
      function closeWindow() {
        // Try to close the window or redirect to app
        window.location.href = 'handypay://stripe/success';
      }

      // Listen for visibility change to handle when user returns to app
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') {
          // User has switched away from this page (likely to the app)
          // The redirect will happen automatically
        }
      });
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
    <title>Setup Paused</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background-color: #ffffff;
        height: 100vh;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .header {
        padding: 24px 24px 8px;
        text-align: right;
      }
      .close-btn {
        background: none;
        border: none;
        font-size: 24px;
        color: #6b7280;
        cursor: pointer;
        padding: 8px;
        border-radius: 8px;
      }
      .close-btn:hover {
        background-color: #f3f4f6;
      }
      .center-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 0 24px;
      }
      .icon {
        width: 48px;
        height: 48px;
        margin-bottom: 16px;
        font-size: 48px;
      }
      .title {
        font-size: 28px;
        font-weight: 600;
        color: #111827;
        margin-bottom: 8px;
        text-align: center;
        letter-spacing: -1px;
      }
      .subtitle {
        font-size: 16px;
        color: #6b7280;
        text-align: center;
        line-height: 1.5;
        margin-bottom: 32px;
        padding: 0 16px;
      }
      .continue-btn {
        background-color: #3b82f6;
        color: white;
        border: none;
        border-radius: 24px;
        padding: 12px 24px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        width: 100%;
        max-width: 280px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        text-decoration: none;
        margin: 0 auto 24px;
      }
      .continue-btn:hover {
        background-color: #2563eb;
      }
      .footer-text {
        text-align: center;
        font-size: 14px;
        color: #9ca3af;
        margin-bottom: 24px;
        padding: 0 24px;
      }
    </style>
  </head>
  <body>
    <div class="header">
      <button class="close-btn" onclick="closeWindow()">✕</button>
    </div>

    <div class="center-content">
      <div class="icon">⏸️</div>
      <h1 class="title">Setup Paused</h1>
      <p class="subtitle">You exited the Stripe setup process. You can continue later.</p>
      <a href="handypay://stripe/refresh" class="continue-btn">Return to HandyPay</a>
    </div>

    <p class="footer-text">This page will automatically close and redirect to the app</p>

    <script>
      // Auto-redirect after 2 seconds
      setTimeout(() => {
        window.location.href = 'handypay://stripe/refresh';
      }, 2000);

      // Close window function for manual close
      function closeWindow() {
        window.location.href = 'handypay://stripe/refresh';
      }

      // Listen for visibility change
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') {
          // User has switched away from this page
        }
      });
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
  } catch (error) {
    console.error("Auth verification error:", error);
    return c.json(
      {
        error: "Verification failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// Better Auth handler - this should handle ALL /auth/* routes
app.all("/auth/*", async (c) => {
  console.log(`Better Auth route: ${c.req.method} ${c.req.url}`);
  console.log(
    "Request headers:",
    Object.fromEntries(c.req.raw.headers.entries())
  );

  try {
    const response = await auth.handler(c.req.raw);
    console.log("Better Auth response status:", response.status);
    return response;
  } catch (error) {
    console.error("Better Auth error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown authentication error";
    return c.json(
      { error: "Authentication error", details: errorMessage },
      500
    );
  }
});

const port = parseInt(process.env.PORT || "3000");

console.log(`🚀 Server starting on port ${port}`);
console.log(`📍 Better Auth URL: ${process.env.BETTER_AUTH_URL}`);
console.log(
  `🔑 Google Client ID configured: ${!!process.env.GOOGLE_CLIENT_ID}`
);

serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0", // Listen on all interfaces so iOS simulator can connect
});
