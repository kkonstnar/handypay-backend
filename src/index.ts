import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
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
    timestamp: new Date().toISOString(),
    version: "1.0.1",
    authType: "Apple-only",
    status: "clean",
  });
});

// Database test endpoint
// Simple database test
app.get("/test-db", async (c) => {
  try {
    await db.execute("SELECT 1");
    return c.json({ success: true, message: "Database connected" });
  } catch (error) {
    return c.json({ success: false, error: "Database not connected" }, 500);
  }
});

// Stripe onboarding return endpoint
app.get("/stripe/return", async (c) => {
  const accountId = c.req.query("account");
  const error = c.req.query("error");

  console.log("🎉 Stripe onboarding return:", { accountId, error });

  if (error) {
    console.error("❌ Stripe onboarding error:", error);
    // Redirect back to app with error
    return c.redirect(
      `handypay://stripe/error?error=${encodeURIComponent(error)}`
    );
  }

  if (accountId) {
    console.log("✅ Stripe account completed:", accountId);
    // Redirect back to app with success
    return c.redirect(
      `handypay://stripe/success?accountId=${encodeURIComponent(accountId)}`
    );
  }

  // Default redirect
  return c.redirect("handypay://stripe/complete");
});

// Stripe onboarding refresh endpoint
app.get("/stripe/refresh", async (c) => {
  const accountId = c.req.query("account");

  console.log("🔄 Stripe onboarding refresh:", { accountId });

  if (accountId) {
    // Redirect back to app to restart onboarding
    return c.redirect(
      `handypay://stripe/refresh?accountId=${encodeURIComponent(accountId)}`
    );
  }

  // Default refresh redirect
  return c.redirect("handypay://stripe/refresh");
});

// Complete Stripe onboarding endpoint
app.post("/api/stripe/complete-onboarding", async (c) => {
  try {
    const { userId, stripeAccountId } = await c.req.json();

    if (!userId || !stripeAccountId) {
      return c.json({ error: "Missing required fields: userId, stripeAccountId" }, 400);
    }

    console.log("✅ Completing Stripe onboarding for user:", userId, "account:", stripeAccountId);

    // Update user with onboarding completion
    const existingUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (existingUser.length === 0) {
      return c.json({ error: "User not found" }, 404);
    }

    await db
      .update(users)
      .set({
        stripeAccountId: stripeAccountId,
        stripeOnboardingCompleted: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    console.log("✅ Onboarding completed and stored in database for user:", userId);

    return c.json({
      success: true,
      message: "Onboarding completed successfully",
      userId,
      stripeAccountId
    });
  } catch (error) {
    console.error("❌ Error completing onboarding:", error);
    return c.json({ error: "Failed to complete onboarding" }, 500);
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
      googleUserId,
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
          googleUserId: googleUserId || null,
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
        googleUserId: googleUserId || null,
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
      message: `User ${
        existingUser.length > 0 ? "updated" : "created"
      } successfully`,
      userId: id,
    });
  } catch (error) {
    console.error("❌ User sync error:", error);
    return c.json(
      {
        success: false,
        error: "User sync failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
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

    if (!userId || !refresh_url || !return_url) {
      return c.json(
        {
          error: "Missing required fields: userId, refresh_url, return_url",
        },
        400
      );
    }

    // Check if user exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (existingUser.length === 0) {
      return c.json(
        {
          error: `User ${userId} not found. Please ensure user is authenticated first.`,
        },
        404
      );
    }

    const user = existingUser[0];
    console.log("✅ Found user:", user.id);

    // Create Stripe account and account link
    const result = await StripeService.createAccountLink({
      userId,
      account_id: user.stripeAccountId || undefined,
      refresh_url,
      return_url,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email || "",
    });

    console.log("✅ Stripe account link created:", result);

    // Update user with Stripe account ID if it's a new account
    if (
      result.accountId &&
      (!user.stripeAccountId || user.stripeAccountId !== result.accountId)
    ) {
      await db
        .update(users)
        .set({
          stripeAccountId: result.accountId,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      console.log(
        `✅ Updated user ${userId} with Stripe account ID: ${result.accountId}`
      );
    }

    return c.json({
      success: true,
      account_id: result.accountId,
      url: result.url,
      message: "Stripe account link created successfully",
    });
  } catch (error) {
    console.error("❌ Stripe account creation error:", error);
    return c.json(
      {
        success: false,
        error: "Stripe account creation failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// Stripe account status endpoint
app.post("/api/stripe/account-status", async (c) => {
  try {
    const { stripeAccountId } = await c.req.json();

    if (!stripeAccountId) {
      return c.json(
        {
          error: "Missing required field: stripeAccountId",
        },
        400
      );
    }

    console.log("📊 Checking Stripe account status for:", stripeAccountId);

    const accountStatus = await StripeService.getAccountStatus(stripeAccountId);

    return c.json({
      success: true,
      stripeOnboardingComplete: accountStatus.charges_enabled,
      accountStatus,
    });
  } catch (error) {
    console.error("❌ Stripe account status error:", error);
    return c.json(
      {
        success: false,
        error: "Failed to get Stripe account status",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

const port = process.env.PORT || 3000;

console.log(`🚀 Server starting on port ${port}...`);

serve({
  fetch: app.fetch,
  port: Number(port),
});

console.log(`✅ Server running on http://localhost:${port}`);
