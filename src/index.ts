import { Hono } from "hono";
import { cors } from "hono/cors";
import { apiRoutes } from "./routes/index.js";
import { createAuth } from "./auth.js";

const app = new Hono();

// CORS middleware
app.use(
  "*",
  cors({
    origin: ["handypay://", "https://handypay-backend.handypay.workers.dev"],
    allowHeaders: ["Content-Type", "Authorization", "Cookie"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

// Authentication middleware for protected routes
const authMiddleware = async (c: any, next: any) => {
  try {
    const { createAuth } = await import("./auth.js");
    const auth = createAuth(c.env);
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
  } catch (error) {
    console.error("Auth middleware error:", error);
    return c.json({ error: "Authentication failed" }, 401);
  }
};

// Authorization helper function
const requireOwnership = (
  authenticatedUserId: string,
  requestedUserId: string
) => {
  if (authenticatedUserId !== requestedUserId) {
    throw new Error("Forbidden - You can only access your own data");
  }
};

// Input sanitization helper functions
const sanitizeEmail = (email: string): string => {
  return email.trim().toLowerCase();
};

const sanitizeString = (input: string): string => {
  return input.trim().replace(/[<>]/g, ""); // Basic XSS prevention
};

const validateEmail = (email: string): boolean => {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
};

// Apply authentication to sensitive routes (excluding user sync and initial Stripe setup)
app.use("/api/users/*", async (c, next) => {
  // Skip auth for user sync endpoint (used for initial user registration)
  if (c.req.path === "/api/users/sync") {
    return next();
  }
  return authMiddleware(c, next);
});

// Allow initial Stripe account creation without authentication
app.use("/api/stripe/*", async (c, next) => {
  // Skip auth for initial account creation, status checks, user account data, Stripe redirects, and payment links (used during onboarding and payments)
  if (
    c.req.path === "/api/stripe/create-account-link" ||
    c.req.path.startsWith("/api/stripe/account-status") ||
    c.req.path.startsWith("/api/stripe/user-account/") ||
    c.req.path === "/api/stripe/return" ||
    c.req.path === "/api/stripe/refresh" ||
    c.req.path === "/api/stripe/create-payment-link"
  ) {
    return next();
  }
  return authMiddleware(c, next);
});
app.use("/api/transactions/*", authMiddleware);
app.use("/api/payouts/*", authMiddleware);

// Test endpoint for auth configuration
app.get("/test-auth", async (c) => {
  try {
    const { createAuth } = await import("./auth.js");
    const auth = createAuth(c.env);
    return c.json({ message: "Auth configured successfully" });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Auth configuration failed",
      },
      500
    );
  }
});

// Debug endpoint to test routing
app.get("/debug", async (c) => {
  console.log("Debug endpoint hit!");
  return c.json({
    message: "Debug endpoint working",
    timestamp: new Date().toISOString(),
    url: c.req.url,
    method: c.req.method,
  });
});

// Simple test route for auth paths
app.get("/auth/test", async (c) => {
  console.log("Auth test route hit");
  return c.json({
    message: "Auth test route working",
    timestamp: new Date().toISOString(),
  });
});

// Stripe onboarding redirects (root level for compatibility with frontend URLs)
app.get("/stripe/return", async (c) => {
  const accountId = c.req.query("account");
  const error = c.req.query("error");

  console.log("🎉 Stripe onboarding return (root):", { accountId, error });

  if (error) {
    console.error("❌ Stripe onboarding error:", error);
    // Redirect back to app with error
    return c.redirect(
      `handypay://stripe/error?error=${encodeURIComponent(error)}`,
      302
    );
  }

  if (accountId) {
    console.log("✅ Stripe account completed:", accountId);
    // Redirect back to app with success
    return c.redirect(
      `handypay://stripe/success?accountId=${encodeURIComponent(accountId)}`,
      302
    );
  }

  // Default redirect
  return c.redirect("handypay://stripe/complete", 302);
});

app.get("/stripe/refresh", async (c) => {
  const accountId = c.req.query("account");

  console.log("🔄 Stripe onboarding refresh (root):", { accountId });

  if (accountId) {
    // Redirect back to app to restart onboarding
    return c.redirect(
      `handypay://stripe/refresh?accountId=${encodeURIComponent(accountId)}`,
      302
    );
  }

  // Default refresh redirect
  return c.redirect("handypay://stripe/refresh", 302);
});

// Manual Google OAuth implementation (temporary workaround)
app.get("/auth/google", async (c) => {
  console.log("=== MANUAL GOOGLE OAUTH ===");

  const env = c.env as any;
  const GOOGLE_CLIENT_ID =
    env?.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const BETTER_AUTH_URL = env?.BETTER_AUTH_URL || process.env.BETTER_AUTH_URL;

  if (!GOOGLE_CLIENT_ID) {
    return c.json({ error: "Google Client ID not configured" }, 500);
  }

  // Construct Google OAuth URL manually
  const baseUrl = "https://accounts.google.com/o/oauth2/v2/auth";
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${BETTER_AUTH_URL}/auth/callback/google`,
    response_type: "code",
    scope: "openid profile email",
    prompt: "select_account",
    access_type: "offline",
  });

  const oauthUrl = `${baseUrl}?${params.toString()}`;

  console.log("Redirecting to:", oauthUrl);

  // Return redirect response
  return c.redirect(oauthUrl, 302);
});

app.post("/auth/google/token", async (c) => {
  try {
    const body = await c.req.json();
    const { code, redirectUri } = body;

    console.log("=== GOOGLE TOKEN EXCHANGE ===");
    console.log("Code received:", code ? "yes" : "no");
    console.log("Redirect URI:", redirectUri);

    if (!code) {
      return c.json({ error: "No authorization code provided" }, 400);
    }

    const env = c.env as any;
    const GOOGLE_CLIENT_ID =
      env?.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const GOOGLE_CLIENT_SECRET =
      env?.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      console.error("Missing Google OAuth credentials");
      return c.json({ error: "Server configuration error" }, 500);
    }

    // Exchange authorization code for access token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code: code,
        grant_type: "authorization_code",
        redirect_uri:
          redirectUri ||
          `${
            env?.BETTER_AUTH_URL || process.env.BETTER_AUTH_URL
          }/auth/callback/google`,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token exchange failed:", errorText);
      return c.json(
        { error: "Failed to exchange token", details: errorText },
        400
      );
    }

    const tokenData = await tokenResponse.json();
    console.log("Token exchange successful");

    // Get user info from Google
    const userResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      }
    );

    if (!userResponse.ok) {
      console.error("Failed to get user info from Google");
      return c.json({ error: "Failed to get user information" }, 400);
    }

    const userInfo = await userResponse.json();
    console.log("User info retrieved:", {
      id: userInfo.id,
      email: userInfo.email,
    });

    // Create user data in the expected format
    const userData = {
      user: {
        id: userInfo.id,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        provider: "google",
      },
      session: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in,
        token_type: tokenData.token_type,
      },
    };

    return c.json(userData);
  } catch (error) {
    console.error("Token exchange error:", error);
    return c.json(
      {
        error: "Token exchange failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

app.get("/auth/callback/google", async (c) => {
  console.log("=== GOOGLE OAUTH CALLBACK ===");

  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  console.log("Callback params:", { code: !!code, error });

  if (error) {
    console.error("OAuth error:", error);
    // Redirect back to app with error
    const errorRedirectUrl = `handypay://auth/callback?error=${encodeURIComponent(
      error
    )}`;
    console.log("Redirecting to app with error:", errorRedirectUrl);
    return c.redirect(errorRedirectUrl, 302);
  }

  if (!code) {
    console.log("No authorization code received");
    const errorRedirectUrl = `handypay://auth/callback?error=no_code`;
    return c.redirect(errorRedirectUrl, 302);
  }

  // Redirect back to mobile app with the authorization code
  const successRedirectUrl = `handypay://auth/callback?code=${encodeURIComponent(
    code
  )}`;
  console.log(
    "Redirecting to app with code:",
    successRedirectUrl.substring(0, 50) + "..."
  );

  return c.redirect(successRedirectUrl, 302);
});

// Test route to verify routing is working
app.get("/test-route", async (c) => {
  return c.json({
    message: "Test route working",
    timestamp: new Date().toISOString(),
  });
});

// Removed catch-all route to avoid conflicts with specific routes

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
    console.log(
      "DATABASE_URL starts with:",
      process.env.DATABASE_URL?.substring(0, 20)
    );

    // Use the database instance with fallback env support
    const { getDb } = await import("./utils/database.js");
    const db = getDb(c.env);
    const result = await db.execute("SELECT 1 as test");
    return c.json({
      success: true,
      message: "Database connected",
      result: result,
    });
  } catch (error) {
    console.error("Database error details:", error);
    return c.json(
      {
        success: false,
        error: "Database not connected",
        details: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
      },
      500
    );
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

    const usersColumns = await db.execute(sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'users'
      AND column_name IN ('stripe_account_id', 'stripe_onboarding_completed')
      ORDER BY column_name;
    `);

    // Check if transactions table exists
    const transactionsTable = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'transactions';
    `);

    return c.json({
      success: true,
      usersColumns: usersColumns,
      transactionsTable: transactionsTable,
    });
  } catch (error) {
    console.error("❌ Debug check error:", error);
    return c.json(
      {
        error: "Failed to check database",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// Debug endpoint to manually update user Stripe account
app.post("/api/debug/update-stripe-account", async (c) => {
  try {
    const { userId, stripeAccountId } = await c.req.json();

    console.log(
      `🔧 Manually updating user ${userId} with Stripe account ${stripeAccountId}`
    );

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
  } catch (error) {
    console.error("❌ Error updating Stripe account:", error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
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
  } catch (error) {
    console.error("❌ Debug test error:", error);
    return c.json(
      {
        error: "Failed to test update",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// Export the authorization helper for use in routes
export { requireOwnership };

// Cloudflare Workers export
export default {
  fetch: app.fetch,
  async scheduled(event: any, env: any, ctx: any) {
    // Handle scheduled tasks if needed
  },
};
