import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { auth } from "./auth.js";
import { StripeService } from "./stripe.js";
import { db } from "./db.js";
import { users } from "./schema.js";
import { eq } from "drizzle-orm";

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
      hasBetterAuthUrl: !!process.env.BETTER_AUTH_URL,
      hasBetterAuthSecret: !!process.env.BETTER_AUTH_SECRET,
      hasDatabaseUrl: !!process.env.DATABASE_URL,
    },
  });
});

// Database test endpoint
app.get("/test-db", async (c) => {
  try {
    console.log("🧪 Testing database connection...");

    // Test basic user lookup
    const testUserId = "test-user-123";
    const result = await db
      .select({ id: users.id, stripeAccountId: users.stripeAccountId })
      .from(users)
      .where(eq(users.id, testUserId))
      .limit(1);

    console.log("✅ Database test query successful:", {
      found: result.length > 0,
      result: result[0] || null,
    });

    return c.json({
      status: "success",
      database: "connected",
      testQuery: {
        userId: testUserId,
        found: result.length > 0,
        data: result[0] || null,
      },
    });
  } catch (error) {
    console.error("❌ Database test failed:", error);
    return c.json(
      {
        status: "error",
        database: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
      500
    );
  }
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
    console.log("🎯 STRIPE ONBOARDING REQUEST RECEIVED:", requestData);

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

    // Fast response - check if account already exists
    let existingAccount = null;
    if (!account_id) {
      try {
        const existing = await StripeService.getUserStripeAccount(userId);
        if (existing) {
          existingAccount = existing;
        }
      } catch (error) {
        console.log("No existing account found, creating new one");
      }
    }

    // Use existing account if found, otherwise create new one
    console.log(
      `🚀 Calling StripeService.createAccountLink for user ${userId}...`
    );
    const result = await StripeService.createAccountLink({
      userId,
      account_id: account_id || existingAccount,
      firstName,
      lastName,
      email,
      refresh_url,
      return_url,
    });

    console.log(`✅ Account link created successfully for user ${userId}:`, {
      accountId: result.accountId,
      url: result.url ? "present" : "missing",
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

// Stripe Connect endpoint for getting user's Stripe account (legacy)
app.get("/api/stripe/user-account/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");
    console.log(`🔍 Looking up Stripe account for user: ${userId}`);

    if (!userId) {
      console.error("❌ No userId provided in request");
      return c.json({ error: "User ID is required" }, 400);
    }

    const stripeAccountId = await StripeService.getUserStripeAccount(userId);
    console.log(`📊 User account lookup result:`, {
      userId,
      stripeAccountId: stripeAccountId || "null",
      found: !!stripeAccountId,
    });

    if (!stripeAccountId) {
      console.log(
        `⚠️ No Stripe account found for user ${userId} - returning 404`
      );
      return c.json({ error: "No Stripe account found for user" }, 404);
    }

    console.log(
      `✅ Found Stripe account ${stripeAccountId} for user ${userId}`
    );
    return c.json({ stripeAccountId });
  } catch (error) {
    console.error("❌ Stripe user account lookup error:", error);
    console.error("❌ Error details:", {
      userId: c.req.param("userId"),
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
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

// New Stripe Connect endpoint for getting account data by account ID
app.post("/api/stripe/account", async (c) => {
  try {
    const { stripeAccountId } = await c.req.json();
    console.log(`🔍 Getting Stripe account data for: ${stripeAccountId}`);

    if (!stripeAccountId) {
      console.error("❌ No stripeAccountId provided in request");
      return c.json({ error: "Stripe Account ID is required" }, 400);
    }

    // Get account status from Stripe
    const accountData = await StripeService.getAccountStatus(stripeAccountId);

    console.log(`✅ Retrieved Stripe account data:`, {
      id: accountData.id,
      charges_enabled: accountData.charges_enabled,
      payouts_enabled: accountData.payouts_enabled,
      details_submitted: accountData.details_submitted,
    });

    return c.json({
      stripeAccountId: accountData.id,
      stripeOnboardingComplete: accountData.charges_enabled, // Use charges_enabled as completion indicator
      kycStatus: accountData.details_submitted ? "completed" : "pending",
      charges_enabled: accountData.charges_enabled,
      payouts_enabled: accountData.payouts_enabled,
      details_submitted: accountData.details_submitted,
      requirements: accountData.requirements,
    });
  } catch (error) {
    console.error("❌ Stripe account data lookup error:", error);
    console.error("❌ Error details:", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to retrieve Stripe account data",
      },
      500
    );
  }
});

// User synchronization endpoint for syncing authenticated users to backend DB
app.post("/api/users/sync", async (c) => {
  try {
    const userData = await c.req.json();
    console.log("🔄 User sync request:", userData);

    const {
      id,
      email,
      fullName,
      firstName,
      lastName,
      authProvider,
      memberSince,
      appleUserId,
    } = userData;

    if (!id || !authProvider || !memberSince) {
      return c.json(
        {
          error: "Missing required fields: id, authProvider, memberSince",
        },
        400
      );
    }

    // Check if user already exists
    const existingUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (existingUser.length > 0) {
      // Update existing user
      await db
        .update(users)
        .set({
          email: email || null,
          fullName: fullName || null,
          firstName: firstName || null,
          lastName: lastName || null,
          authProvider,
          appleUserId: appleUserId || null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id));

      console.log(`✅ Updated existing user in backend: ${id}`);
    } else {
      // Create new user
      await db.insert(users).values({
        id,
        email: email || null,
        fullName: fullName || null,
        firstName: firstName || null,
        lastName: lastName || null,
        authProvider,
        appleUserId: appleUserId || null,
        stripeAccountId: null,
        stripeOnboardingCompleted: false,
        memberSince: new Date(memberSince),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      console.log(`✅ Created new user in backend: ${id}`);
    }

    return c.json({
      success: true,
      message: "User synced successfully",
      userId: id,
    });
  } catch (error) {
    console.error("❌ User sync error:", error);
    return c.json(
      {
        error: error instanceof Error ? error.message : "Failed to sync user",
      },
      500
    );
  }
});

// Stripe Connect endpoint for updating onboarding completion status
app.post("/api/stripe/complete-onboarding", async (c) => {
  try {
    const requestData = await c.req.json();
    console.log("Stripe onboarding completion request:", requestData);

    const { userId, stripeAccountId } = requestData;

    if (!userId || !stripeAccountId) {
      return c.json(
        {
          error: "Missing required fields: userId, stripeAccountId",
        },
        400
      );
    }

    // First check if user exists in database
    const existingUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (existingUser.length > 0) {
      // User exists, update their onboarding completion status
      await db
        .update(users)
        .set({
          stripeAccountId: stripeAccountId,
          stripeOnboardingCompleted: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      console.log(
        `✅ Marked onboarding as completed for existing user ${userId} with account ${stripeAccountId}`
      );
    } else {
      // User doesn't exist, create a minimal user record
      await db.insert(users).values({
        id: userId,
        stripeAccountId: stripeAccountId,
        stripeOnboardingCompleted: true,
        authProvider: "unknown", // We'll need to update this when we know
        memberSince: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      console.log(
        `✅ Created new user record and marked onboarding as completed for user ${userId} with account ${stripeAccountId}`
      );
    }

    return c.json({
      success: true,
      message: "Onboarding completion status updated successfully",
    });
  } catch (error) {
    console.error("Stripe onboarding completion error:", error);
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update onboarding completion status",
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

// Simple Google OAuth token exchange (non-PKCE)
app.post("/auth/google/token", async (c) => {
  const code = c.req.query("code");
  const error = c.req.query("error");
  const state = c.req.query("state");

  console.log("Google OAuth callback:", { code: !!code, error, state });

  let redirectUrl: string;
  let pageTitle: string;
  let pageMessage: string;

  if (error) {
    console.error("Google OAuth error:", error);
    redirectUrl = `handypay://google/error?error=${encodeURIComponent(error)}`;
    pageTitle = "Authentication Error";
    pageMessage =
      "There was an error with Google authentication. Redirecting back to HandyPay...";
  } else if (code) {
    console.log("Google OAuth success, redirecting to app with code");
    redirectUrl = `handypay://google/success?code=${encodeURIComponent(
      code
    )}&state=${encodeURIComponent(state || "")}`;
    pageTitle = "Authentication Successful";
    pageMessage =
      "Google authentication successful! Redirecting back to HandyPay...";
  } else {
    console.error("Google OAuth callback missing code and error");
    redirectUrl = `handypay://google/error?error=invalid_request`;
    pageTitle = "Authentication Error";
    pageMessage =
      "Invalid authentication response. Redirecting back to HandyPay...";
  }

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${pageTitle}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background-color: #ffffff;
        height: 100vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        padding: 24px;
        text-align: center;
      }
      .spinner {
        border: 3px solid #f3f3f3;
        border-top: 3px solid #3AB75C;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        animation: spin 1s linear infinite;
        margin-bottom: 16px;
      }
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      .title {
        font-size: 24px;
        font-weight: 600;
        color: #111827;
        margin-bottom: 8px;
      }
      .message {
        font-size: 16px;
        color: #6b7280;
        margin-bottom: 24px;
        line-height: 1.5;
      }
      .manual-link {
        color: #3AB75C;
        text-decoration: none;
        font-weight: 500;
        padding: 12px 24px;
        border: 1px solid #3AB75C;
        border-radius: 8px;
        display: inline-block;
        margin-top: 16px;
      }
      .manual-link:hover {
        background-color: #3AB75C;
        color: white;
      }
    </style>
  </head>
  <body>
    <div class="spinner"></div>
    <h1 class="title">${pageTitle}</h1>
    <p class="message">${pageMessage}</p>
    <a href="${redirectUrl}" class="manual-link">Tap here if not redirected automatically</a>

    <script>
      console.log('Attempting redirect to:', '${redirectUrl}');
      
      // Immediate redirect attempt
      window.location.href = '${redirectUrl}';
      
      // Backup redirect after 1 second
      setTimeout(() => {
        console.log('Backup redirect attempt');
        window.location.href = '${redirectUrl}';
      }, 1000);
      
      // Final fallback after 3 seconds
      setTimeout(() => {
        console.log('Final redirect attempt');
        try {
          window.location.replace('${redirectUrl}');
        } catch (error) {
          console.error('Redirect failed:', error);
        }
      }, 3000);
    </script>
  </body>
  </html>
  `;

  return c.html(html);
});

// Simple Google OAuth token exchange (non-PKCE)
app.post("/auth/google/token", async (c) => {
  try {
    // Log all request details for debugging
    console.log("=== GOOGLE TOKEN EXCHANGE REQUEST RECEIVED ===");
    console.log("Method:", c.req.method);
    console.log("URL:", c.req.url);
    console.log("Headers:", Object.fromEntries(c.req.raw.headers.entries()));
    console.log("Content-Type:", c.req.header("content-type"));
    console.log("User-Agent:", c.req.header("user-agent"));
    console.log("Origin:", c.req.header("origin"));

    const rawBody = await c.req.text();
    console.log("Raw request body:", rawBody.substring(0, 300) + "...");

    let parsedBody;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch (parseError) {
      console.error("❌ Failed to parse request body as JSON:", parseError);
      console.error("Raw body that failed to parse:", rawBody);
      return c.json(
        {
          error: "Invalid JSON in request body",
          details:
            parseError instanceof Error ? parseError.message : "Parse error",
          receivedBody: rawBody.substring(0, 100),
        },
        400
      );
    }

    const { code, provider, redirectUri, codeVerifier } = parsedBody;

    console.log(
      `✅ ${provider || "unknown"} token exchange request parsed successfully`
    );
    console.log("Redirect URI:", redirectUri);
    console.log(
      "Code received:",
      code ? code.substring(0, 20) + "..." : "null"
    );
    console.log("Code length:", code?.length || 0);
    console.log("Code verifier present:", !!codeVerifier);
    console.log("Client ID available:", !!process.env.GOOGLE_CLIENT_ID);
    console.log("Client Secret available:", !!process.env.GOOGLE_CLIENT_SECRET);

    if (!code) {
      return c.json({ error: "Authorization code is required" }, 400);
    }

    if (!process.env.GOOGLE_CLIENT_SECRET) {
      console.error("GOOGLE_CLIENT_SECRET not configured in environment");
      return c.json(
        {
          error: "Server configuration error",
          details: "GOOGLE_CLIENT_SECRET not set",
        },
        500
      );
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      console.error("GOOGLE_CLIENT_ID not configured in environment");
      return c.json(
        {
          error: "Server configuration error",
          details: "GOOGLE_CLIENT_ID not set",
        },
        500
      );
    }

    const finalRedirectUri =
      redirectUri ||
      "https://handypay-backend.onrender.com/auth/google/callback";

    // Use PKCE (code_verifier) if provided, otherwise use client_secret
    const tokenRequestBody = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      code: code,
      grant_type: "authorization_code",
      redirect_uri: finalRedirectUri,
    });

    if (codeVerifier) {
      // PKCE flow: use code_verifier instead of client_secret
      tokenRequestBody.append("code_verifier", codeVerifier);
      console.log("🔐 Using PKCE flow with code_verifier");
    } else {
      // Regular OAuth flow: use client_secret
      tokenRequestBody.append(
        "client_secret",
        process.env.GOOGLE_CLIENT_SECRET!
      );
      console.log("🔑 Using regular OAuth flow with client_secret");
    }

    console.log("Token exchange request details:");
    console.log("- URL: https://oauth2.googleapis.com/token");
    console.log("- Method: POST");
    console.log("- Content-Type: application/x-www-form-urlencoded");
    console.log("- Body keys:", Array.from(tokenRequestBody.keys()));
    console.log("- Code length:", code.length);
    console.log("- Redirect URI:", finalRedirectUri);

    // Exchange code for tokens using client secret
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenRequestBody,
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error(
        "Google token exchange failed - Status:",
        tokenResponse.status
      );
      console.error("Google token exchange failed - Response:", errorText);

      let parsedError;
      try {
        parsedError = JSON.parse(errorText);
      } catch {
        parsedError = errorText;
      }

      return c.json(
        {
          error: "Token exchange failed",
          details: parsedError,
          status: tokenResponse.status,
        },
        400
      );
    }

    const tokens = await tokenResponse.json();
    console.log("Google tokens received:", {
      access_token: !!tokens.access_token,
      refresh_token: !!tokens.refresh_token,
      expires_in: tokens.expires_in,
    });

    // Get user info from Google
    const userResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      }
    );

    if (!userResponse.ok) {
      console.error("Failed to get user info from Google");
      return c.json({ error: "Failed to get user info" }, 400);
    }

    const userInfo = await userResponse.json();
    console.log("Google user info:", {
      id: userInfo.id,
      email: userInfo.email,
      name: userInfo.name,
    });

    // Return user data to mobile app
    return c.json({
      user: {
        id: userInfo.id,
        email: userInfo.email,
        name: userInfo.name,
        firstName: userInfo.given_name,
        lastName: userInfo.family_name,
        picture: userInfo.picture,
      },
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
      },
    });
  } catch (error) {
    console.error("Google token exchange error:", error);
    return c.json(
      {
        error: "Token exchange failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
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
