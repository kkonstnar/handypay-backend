import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { StripeService } from "./stripe.js";
import { db } from "./db.js";
import { users, transactions, payouts, payoutRules } from "./schema.js";
import { eq, desc, sql } from "drizzle-orm";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_TEST_SECRET_KEY as string, {
  apiVersion: "2025-08-27.basil",
});

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
      return c.json(
        { error: "Missing required fields: userId, stripeAccountId" },
        400
      );
    }

    console.log(
      "✅ Completing Stripe onboarding for user:",
      userId,
      "account:",
      stripeAccountId
    );

    // Check the actual Stripe account status to verify onboarding completion
    const accountStatus = await StripeService.getAccountStatus(stripeAccountId);
    console.log("📊 Stripe account status:", {
      charges_enabled: accountStatus.charges_enabled,
      details_submitted: accountStatus.details_submitted,
      payouts_enabled: accountStatus.payouts_enabled,
    });

    // Only mark onboarding as complete if charges are enabled
    const onboardingCompleted = accountStatus.charges_enabled;

    if (!onboardingCompleted) {
      console.log("⚠️ Onboarding not yet complete - charges not enabled");
      return c.json({
        success: false,
        message:
          "Onboarding not yet complete. Please complete all required information in Stripe.",
        accountStatus,
      });
    }

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

    console.log(
      "✅ Onboarding completed and stored in database for user:",
      userId,
      "- charges enabled:",
      accountStatus.charges_enabled
    );

    return c.json({
      success: true,
      message: "Onboarding completed successfully",
      userId,
      stripeAccountId,
      accountStatus,
    });
  } catch (error) {
    console.error("❌ Error completing onboarding:", error);
    return c.json({ error: "Failed to complete onboarding" }, 500);
  }
});

// Get user account endpoint
app.get("/api/stripe/user-account/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");

    if (!userId) {
      return c.json({ error: "Missing userId parameter" }, 400);
    }

    console.log("🔍 Getting user account for:", userId);

    // Get user account data from database
    const userAccount = await db
      .select({
        id: users.id,
        stripeAccountId: users.stripeAccountId,
        stripeOnboardingCompleted: users.stripeOnboardingCompleted,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (userAccount.length === 0) {
      return c.json({ error: "User not found" }, 404);
    }

    const account = userAccount[0];

    return c.json({
      user_id: account.id,
      stripe_account_id: account.stripeAccountId,
      stripe_onboarding_completed: account.stripeOnboardingCompleted,
    });
  } catch (error) {
    console.error("❌ Error getting user account:", error);
    return c.json({ error: "Failed to get user account" }, 500);
  }
});

// User synchronization endpoint for syncing authenticated users to backend DB
app.post("/api/users/sync", async (c) => {
  try {
    const userData = await c.req.json();
    console.log("🔄 User sync request:", userData);
    console.log("🔄 Stripe data:", {
      stripeAccountId: userData.stripeAccountId,
      stripeOnboardingCompleted: userData.stripeOnboardingCompleted,
    });

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
      stripeAccountId,
      stripeOnboardingCompleted,
    } = userData;

    if (!id || !authProvider || !memberSince) {
      return c.json(
        {
          error: "Missing required fields: id, authProvider, memberSince",
        },
        400
      );
    }

    // FIRST: Check if this provider ID is already associated with an existing account
    let existingAccountCheck = null;

    if (appleUserId) {
      existingAccountCheck = await db
        .select({ id: users.id, authProvider: users.authProvider })
        .from(users)
        .where(eq(users.appleUserId, appleUserId))
        .limit(1);
    } else if (googleUserId) {
      existingAccountCheck = await db
        .select({ id: users.id, authProvider: users.authProvider })
        .from(users)
        .where(eq(users.googleUserId, googleUserId))
        .limit(1);
    }

    // If provider ID already exists on a different account, return that account
    if (
      existingAccountCheck &&
      existingAccountCheck.length > 0 &&
      existingAccountCheck[0].id !== id
    ) {
      console.log(
        `🔄 Provider ID already linked to account: ${existingAccountCheck[0].id}`
      );
      return c.json({
        success: true,
        message: "Provider linked to existing account",
        userId: existingAccountCheck[0].id,
        existingAccount: true,
      });
    }

    // Check if user already exists
    const existingUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (existingUser.length > 0) {
      // Update existing user - preserve existing provider IDs
      const updateData: any = {
        email: email || null,
        fullName: fullName || null,
        firstName: firstName || null,
        lastName: lastName || null,
        stripeAccountId: stripeAccountId || null,
        stripeOnboardingCompleted: stripeOnboardingCompleted || false,
        updatedAt: new Date(),
      };

      // Only update authProvider if it's different (allows switching primary provider)
      if (authProvider) {
        updateData.authProvider = authProvider;
      }

      // Preserve existing provider IDs and add new ones
      if (appleUserId) {
        updateData.appleUserId = appleUserId;
      }
      if (googleUserId) {
        updateData.googleUserId = googleUserId;
      }

      await db.update(users).set(updateData).where(eq(users.id, id));

      console.log(`✅ Updated existing user in backend: ${id}`);
      console.log(
        `✅ Provider IDs: Apple=${!!appleUserId}, Google=${!!googleUserId}`
      );
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
        stripeAccountId: stripeAccountId || null,
        stripeOnboardingCompleted: stripeOnboardingCompleted || false,
        memberSince: new Date(memberSince),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      console.log(`✅ Created new user in backend: ${id}`);
      console.log(
        `✅ Provider IDs: Apple=${!!appleUserId}, Google=${!!googleUserId}`
      );
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

// Create payment link endpoint
app.post("/api/stripe/create-payment-link", async (c) => {
  try {
    const {
      handyproUserId,
      customerName,
      customerEmail,
      description,
      amount,
      taskDetails,
      dueDate,
    } = await c.req.json();

    if (!handyproUserId || !amount) {
      return c.json(
        {
          error: "Missing required fields: handyproUserId, amount",
        },
        400
      );
    }

    console.log(
      "💳 Creating payment link for user:",
      handyproUserId,
      "amount:",
      amount
    );

    const paymentLink = await StripeService.createPaymentLink({
      handyproUserId,
      customerName,
      customerEmail,
      description,
      amount,
      taskDetails,
      dueDate,
    });

    return c.json({
      success: true,
      invoice: paymentLink,
    });
  } catch (error) {
    console.error("❌ Payment link creation error:", error);
    return c.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to create payment link",
      },
      500
    );
  }
});

// Cancel payment link endpoint
app.post("/api/stripe/cancel-payment-link", async (c) => {
  try {
    const { paymentLinkId, userId } = await c.req.json();

    if (!paymentLinkId || !userId) {
      return c.json(
        {
          error: "Missing required fields: paymentLinkId, userId",
        },
        400
      );
    }

    console.log(
      "🗑️ Cancelling payment link:",
      paymentLinkId,
      "for user:",
      userId
    );

    const result = await StripeService.cancelPaymentLink(paymentLinkId, userId);

    return c.json({
      success: true,
      paymentLink: result,
    });
  } catch (error) {
    console.error("❌ Payment link cancellation error:", error);
    return c.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to cancel payment link",
      },
      500
    );
  }
});

// Expire payment link endpoint
app.post("/api/stripe/expire-payment-link", async (c) => {
  try {
    const { paymentLinkId, userId } = await c.req.json();

    if (!paymentLinkId || !userId) {
      return c.json(
        {
          error: "Missing required fields: paymentLinkId, userId",
        },
        400
      );
    }

    console.log(
      "⏰ Expiring payment link:",
      paymentLinkId,
      "for user:",
      userId
    );

    const result = await StripeService.expirePaymentLink(paymentLinkId, userId);

    return c.json({
      success: true,
      paymentLink: result,
    });
  } catch (error) {
    console.error("❌ Payment link expiration error:", error);
    return c.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to expire payment link",
      },
      500
    );
  }
});

// Stripe webhook endpoint
app.post("/api/stripe/webhook", async (c) => {
  try {
    const rawBody = await c.req.text();
    const signature = c.req.header("stripe-signature");

    if (!signature) {
      console.error("❌ No Stripe signature provided");
      return c.json({ error: "No signature" }, 400);
    }

    console.log("🎣 Processing Stripe webhook...");

    const result = await StripeService.handleWebhook(rawBody, signature);

    return c.json(result, 200);
  } catch (error) {
    console.error("❌ Webhook processing error:", error);
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Webhook processing failed",
      },
      400
    );
  }
});

// Get payment status endpoint
app.get("/api/stripe/payment-status/:paymentIntentId", async (c) => {
  try {
    const paymentIntentId = c.req.param("paymentIntentId");

    if (!paymentIntentId) {
      return c.json({ error: "Missing paymentIntentId parameter" }, 400);
    }

    console.log("📊 Getting payment status for:", paymentIntentId);

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    return c.json({
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      metadata: paymentIntent.metadata,
    });
  } catch (error) {
    console.error("❌ Payment status error:", error);
    return c.json({ error: "Failed to get payment status" }, 500);
  }
});

// Refresh transaction status endpoint
app.post("/api/stripe/refresh-transaction", async (c) => {
  try {
    const { transactionId, userId } = await c.req.json();

    if (!transactionId || !userId) {
      return c.json(
        { error: "Missing required fields: transactionId, userId" },
        400
      );
    }

    console.log(
      "🔄 Refreshing transaction status for:",
      transactionId,
      "user:",
      userId
    );

    // For now, just return success - in a real implementation,
    // this would check the latest status from Stripe and update the database
    return c.json({
      success: true,
      message: "Transaction status refreshed",
      transactionId,
      userId,
    });
  } catch (error) {
    console.error("❌ Transaction refresh error:", error);
    return c.json({ error: "Failed to refresh transaction" }, 500);
  }
});

// Get user transactions endpoint
app.get("/api/transactions/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");

    if (!userId) {
      return c.json({ error: "Missing userId parameter" }, 400);
    }

    console.log("📊 Getting transactions for user:", userId);

    const userTransactions = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.createdAt));

    // Transform to match frontend interface
    const formattedTransactions = userTransactions.map((tx) => ({
      id: tx.id,
      type: tx.type,
      amount: tx.amount / 100, // Convert cents to dollars for frontend
      description: tx.description,
      merchant: tx.merchant,
      date: tx.date,
      status: tx.status,
      cardLast4: tx.cardLast4,
      qrCode: tx.qrCode,
      expiresAt: tx.expiresAt,
      paymentMethod: tx.paymentMethod,
      stripePaymentIntentId: tx.stripePaymentIntentId,
      stripeInvoiceId: tx.stripeInvoiceId,
      stripePaymentLinkId: tx.stripePaymentLinkId,
      customerName: tx.customerName,
      customerEmail: tx.customerEmail,
    }));

    return c.json({
      success: true,
      transactions: formattedTransactions,
    });
  } catch (error) {
    console.error("❌ Transactions error:", error);
    return c.json({ error: "Failed to get transactions" }, 500);
  }
});

// Cancel transaction endpoint
app.post("/api/transactions/cancel", async (c) => {
  try {
    const { transactionId, userId } = await c.req.json();

    if (!transactionId || !userId) {
      return c.json(
        { error: "Missing required fields: transactionId, userId" },
        400
      );
    }

    console.log(
      "🗑️ Cancelling transaction:",
      transactionId,
      "for user:",
      userId
    );

    // Get transaction details
    const transaction = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .limit(1);

    if (transaction.length === 0) {
      return c.json({ error: "Transaction not found" }, 404);
    }

    const tx = transaction[0];

    // Check if user owns this transaction
    if (tx.userId !== userId) {
      return c.json({ error: "Unauthorized" }, 403);
    }

    // Handle payment link cancellation
    if (tx.stripePaymentLinkId && tx.status === "pending") {
      await StripeService.cancelPaymentLink(tx.stripePaymentLinkId, userId);
    } else {
      // Update transaction status directly
      await db
        .update(transactions)
        .set({
          status: "cancelled",
          updatedAt: new Date(),
          notes: "Transaction cancelled by user",
        })
        .where(eq(transactions.id, transactionId));
    }

    return c.json({
      success: true,
      message: "Transaction cancelled successfully",
    });
  } catch (error) {
    console.error("❌ Transaction cancellation error:", error);
    return c.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to cancel transaction",
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

// Debug endpoint to check database columns
app.get("/api/debug/check-columns", async (c) => {
  try {
    console.log("🔍 Checking database columns...");

    // Check if users table has the required columns
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

// Test endpoint to manually trigger account update webhook logic
app.post("/api/stripe/test-account-update", async (c) => {
  try {
    const { accountId, userId } = await c.req.json();

    console.log("🧪 Testing account update webhook logic:", {
      accountId,
      userId,
    });

    // Simulate account updated event
    const mockAccount = {
      id: accountId,
      charges_enabled: true,
      details_submitted: true,
      // Add other typical account fields
    };

    // Call our webhook handler
    await StripeService.handleAccountUpdated(mockAccount);

    return c.json({
      success: true,
      message: "Account update test completed",
      accountId,
      userId,
    });
  } catch (error) {
    console.error("❌ Error in test account update:", error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// Stripe account status endpoint
// GET endpoint for account status (frontend compatibility)
app.get("/api/stripe/account-status/:accountId", async (c) => {
  try {
    const stripeAccountId = c.req.param("accountId");

    if (!stripeAccountId) {
      return c.json(
        {
          error: "Missing required parameter: accountId",
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

// POST endpoint for account status (existing)
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

// Google OAuth initiation endpoint (redirects to Google)
app.get("/auth/google", async (c) => {
  try {
    const state = c.req.query("state");
    const redirectUri = c.req.query("redirect_uri");

    if (!redirectUri) {
      return c.json({ error: "Missing redirect_uri parameter" }, 400);
    }

    console.log("🔄 Initiating Google OAuth flow:", { state, redirectUri });

    // Google OAuth parameters
    const googleAuthUrl = new URL(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    googleAuthUrl.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
    googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
    googleAuthUrl.searchParams.set("response_type", "code");
    googleAuthUrl.searchParams.set("scope", "openid profile email");
    googleAuthUrl.searchParams.set("access_type", "offline");
    googleAuthUrl.searchParams.set("prompt", "select_account");

    if (state) {
      googleAuthUrl.searchParams.set("state", state);
    }

    console.log("🔗 Redirecting to Google OAuth:", googleAuthUrl.toString());

    // Redirect to Google OAuth
    return c.redirect(googleAuthUrl.toString());
  } catch (error) {
    console.error("❌ Google OAuth initiation error:", error);
    return c.json({ error: "Failed to initiate Google OAuth" }, 500);
  }
});

// Google OAuth callback endpoint (handles redirect from Google)
app.get("/auth/google/callback", async (c) => {
  try {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    console.log("🔄 Google OAuth callback received:", {
      code: !!code,
      state,
      error,
    });

    if (error) {
      console.error("❌ Google OAuth error:", error);
      // Redirect back to app with error
      return c.redirect(`handypay://oauth?error=${encodeURIComponent(error)}`);
    }

    if (code) {
      console.log("✅ Google OAuth code received, redirecting to app...");

      // Redirect back to app with the authorization code
      return c.redirect(
        `handypay://oauth?code=${encodeURIComponent(
          code
        )}&state=${encodeURIComponent(state || "")}`
      );
    }

    console.error("❌ No authorization code or error received");
    return c.redirect(`handypay://oauth?error=no_code`);
  } catch (error) {
    console.error("❌ Google OAuth callback error:", error);
    return c.redirect(`handypay://oauth?error=callback_error`);
  }
});

// Google OAuth token exchange endpoint (for mobile app)
app.post("/api/auth/google/token", async (c) => {
  try {
    const { code, redirectUri, codeVerifier } = await c.req.json();

    console.log("🔄 Processing Google OAuth token exchange");

    if (!code) {
      return c.json({ error: "Authorization code is required" }, 400);
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri || "handypay://",
        ...(codeVerifier && { code_verifier: codeVerifier }), // Add code verifier for PKCE
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error(
        "Google token exchange failed - Status:",
        tokenResponse.status
      );
      console.error("Google token exchange failed - Response:", errorText);
      return c.json({ error: "Failed to exchange authorization code" }, 400);
    }

    const tokenData = await tokenResponse.json();
    console.log("Google tokens received:", {
      access_token: !!tokenData.access_token,
      refresh_token: !!tokenData.refresh_token,
      expires_in: tokenData.expires_in,
    });

    // Get user info from Google
    const userInfoResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      }
    );

    if (!userInfoResponse.ok) {
      console.error("Failed to get user info from Google");
      return c.json({ error: "Failed to get user information" }, 400);
    }

    const userInfo = await userInfoResponse.json();
    console.log("Google user info:", {
      id: userInfo.id,
      email: userInfo.email,
      name: userInfo.name,
      verified: userInfo.verified_email,
    });

    return c.json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type,
      user: userInfo,
    });
  } catch (error) {
    console.error("❌ Google token exchange error:", error);
    return c.json(
      {
        error: "Google authentication failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// Payout Rules Management
// Initialize default payout rules if they don't exist
app.get("/api/payout-rules/init", async (c) => {
  try {
    const existingRules = await db
      .select()
      .from(payoutRules)
      .where(eq(payoutRules.id, "default_rule"))
      .limit(1);

    if (existingRules.length === 0) {
      await db.insert(payoutRules).values({
        id: "default_rule",
        ruleName: "Standard Payout Rule",
        firstTransactionDelayDays: 7,
        subsequentDelayDaysMin: 2,
        subsequentDelayDaysMax: 5,
        minimumPayoutAmount: "0.00",
        isActive: true,
      });

      console.log("✅ Default payout rules initialized");
    }

    return c.json({ success: true, message: "Payout rules initialized" });
  } catch (error) {
    console.error("❌ Error initializing payout rules:", error);
    return c.json({ error: "Failed to initialize payout rules" }, 500);
  }
});

// Get user balance from Stripe endpoint
app.get("/api/stripe/balance/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");

    if (!userId) {
      return c.json({ error: "Missing userId parameter" }, 400);
    }

    console.log("💰 Getting Stripe balance for user:", userId);

    // Get user's Stripe account ID
    const userAccount = await db
      .select({
        stripeAccountId: users.stripeAccountId,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (userAccount.length === 0 || !userAccount[0].stripeAccountId) {
      return c.json({ error: "No Stripe account found for user" }, 404);
    }

    const stripeAccountId = userAccount[0].stripeAccountId;

    // Get balance from Stripe
    const balance = await stripe.balance.retrieve({
      stripeAccount: stripeAccountId,
    });

    // Calculate available balance (pending payouts are deducted automatically by Stripe)
    const availableBalance = balance.available.reduce((total, balanceItem) => {
      if (balanceItem.currency === "usd") {
        // Stripe uses USD, convert to JMD
        return total + balanceItem.amount * 160; // Approximate USD to JMD conversion
      }
      return total;
    }, 0);

    console.log("💰 Stripe balance retrieved:", {
      available: availableBalance,
      currency: "JMD",
      stripeBalance: balance.available,
    });

    return c.json({
      success: true,
      balance: availableBalance / 100, // Convert from cents
      currency: "JMD",
      stripeBalance: balance.available,
    });
  } catch (error) {
    console.error("❌ Stripe balance error:", error);
    return c.json({ error: "Failed to get Stripe balance" }, 500);
  }
});

// Get user payouts from Stripe endpoint
app.get("/api/stripe/payouts/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");

    if (!userId) {
      return c.json({ error: "Missing userId parameter" }, 400);
    }

    console.log("📊 Getting Stripe payouts for user:", userId);

    // Get user's Stripe account ID
    const userAccount = await db
      .select({
        stripeAccountId: users.stripeAccountId,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (userAccount.length === 0 || !userAccount[0].stripeAccountId) {
      return c.json({ error: "No Stripe account found for user" }, 404);
    }

    const stripeAccountId = userAccount[0].stripeAccountId;

    // Get payouts from Stripe
    const payouts = await stripe.payouts.list(
      { limit: 20 },
      { stripeAccount: stripeAccountId }
    );

    // Transform to match frontend interface
    const formattedPayouts = payouts.data.map((payout) => ({
      id: payout.id,
      amount: payout.amount / 100, // Convert from cents
      currency: payout.currency.toUpperCase(),
      status: payout.status,
      payoutDate: new Date(payout.created * 1000).toISOString().split("T")[0],
      processedAt: payout.arrival_date
        ? new Date(payout.arrival_date * 1000).toISOString()
        : null,
      bankAccount: payout.destination
        ? `****${String(payout.destination).slice(-4)}`
        : "****0000",
      stripePayoutId: payout.id,
      description: payout.description || "Bank payout",
      createdAt: new Date(payout.created * 1000).toISOString(),
    }));

    return c.json({
      success: true,
      payouts: formattedPayouts,
    });
  } catch (error) {
    console.error("❌ Stripe payouts error:", error);
    return c.json({ error: "Failed to get Stripe payouts" }, 500);
  }
});

// Get next payout info from Stripe endpoint
app.get("/api/stripe/next-payout/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");

    if (!userId) {
      return c.json({ error: "Missing userId parameter" }, 400);
    }

    console.log("🔮 Getting next payout info for user:", userId);

    // Get user's Stripe account ID
    const userAccount = await db
      .select({
        stripeAccountId: users.stripeAccountId,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (userAccount.length === 0 || !userAccount[0].stripeAccountId) {
      return c.json({ error: "No Stripe account found for user" }, 404);
    }

    const stripeAccountId = userAccount[0].stripeAccountId;

    // Get balance and account info from Stripe
    const [balance, account] = await Promise.all([
      stripe.balance.retrieve({ stripeAccount: stripeAccountId }),
      stripe.accounts.retrieve(stripeAccountId),
    ]);

    // Get external account (bank account) info
    const externalAccount = account.external_accounts?.data?.find(
      (acc: any) => acc.object === "bank_account"
    );

    const bankAccountEnding = externalAccount?.last4
      ? `****${externalAccount.last4}`
      : "****0000";

    // Calculate available balance
    const availableBalance = balance.available.reduce((total, balanceItem) => {
      if (balanceItem.currency === "usd") {
        return total + balanceItem.amount * 160; // USD to JMD conversion
      }
      return total;
    }, 0);

    // Stripe typically pays out automatically, so we estimate next payout
    const now = new Date();
    const nextPayoutDate = new Date(now);
    nextPayoutDate.setDate(now.getDate() + 2); // Stripe usually pays out every 2 days

    return c.json({
      success: true,
      nextPayout: {
        date: nextPayoutDate.toISOString(),
        amount: availableBalance / 100, // Convert from cents
        currency: "JMD",
        bankAccountEnding,
        estimatedProcessingDays: 1,
        stripeSchedule: "Every 2 days",
      },
    });
  } catch (error) {
    console.error("❌ Next payout error:", error);
    return c.json({ error: "Failed to get next payout info" }, 500);
  }
});

// Automatic payout generation endpoint (called by cron job or scheduled task)
app.post("/api/payouts/generate-automatic", async (c) => {
  try {
    console.log("🤖 Starting automatic payout generation...");

    // Get all users with available balance above minimum
    const usersWithBalance = await db.execute(sql`
      SELECT DISTINCT t.user_id,
             SUM(CASE WHEN t.status = 'completed' AND t.type IN ('received', 'payment_link', 'qr_payment') THEN t.amount ELSE 0 END) -
             COALESCE(SUM(CASE WHEN p.status = 'completed' THEN CAST(p.amount AS DECIMAL) * 100 ELSE 0 END), 0) as available_balance
      FROM transactions t
      LEFT JOIN payouts p ON t.user_id = p.user_id
      WHERE t.status = 'completed'
      GROUP BY t.user_id
      HAVING (SUM(CASE WHEN t.status = 'completed' AND t.type IN ('received', 'payment_link', 'qr_payment') THEN t.amount ELSE 0 END) -
              COALESCE(SUM(CASE WHEN p.status = 'completed' THEN CAST(p.amount AS DECIMAL) * 100 ELSE 0 END), 0)) > 0
    `);

    const results = [];

    for (const userBalance of usersWithBalance || []) {
      const userId = String(userBalance.user_id);
      const availableBalance =
        parseFloat(String(userBalance.available_balance)) / 100; // Convert from cents

      // Get payout rules
      const rules = await db
        .select()
        .from(payoutRules)
        .where(eq(payoutRules.isActive, true))
        .limit(1);

      if (
        rules.length === 0 ||
        !rules[0].minimumPayoutAmount ||
        availableBalance < parseFloat(rules[0].minimumPayoutAmount)
      ) {
        continue;
      }

      // Check if user should get a payout today based on rules
      const shouldProcessPayout = await shouldProcessPayoutForUser(
        String(userId)
      );

      if (shouldProcessPayout) {
        const payout = await createAutomaticPayout(
          String(userId),
          availableBalance
        );
        results.push(payout);
      }
    }

    return c.json({
      success: true,
      message: `Processed ${results.length} automatic payouts`,
      payoutsGenerated: results.length,
      results,
    });
  } catch (error) {
    console.error("❌ Automatic payout generation error:", error);
    return c.json({ error: "Failed to generate automatic payouts" }, 500);
  }
});

// Helper function to determine if user should get payout
async function shouldProcessPayoutForUser(userId: string): Promise<boolean> {
  // Get payout rules
  const rules = await db
    .select()
    .from(payoutRules)
    .where(eq(payoutRules.isActive, true))
    .limit(1);

  if (rules.length === 0) return false;

  const rule = rules[0];

  // Check if rule properties are valid
  if (
    !rule.firstTransactionDelayDays ||
    !rule.subsequentDelayDaysMin ||
    !rule.subsequentDelayDaysMax
  ) {
    return false;
  }

  // Get user's most recent payout
  const recentPayout = await db
    .select({
      payoutDate: payouts.payoutDate,
    })
    .from(payouts)
    .where(eq(payouts.userId, userId))
    .orderBy(desc(payouts.payoutDate))
    .limit(1);

  const now = new Date();

  if (recentPayout.length === 0) {
    // First payout - check if first transaction delay has passed
    const firstTransaction = await db
      .select({
        date: transactions.date,
      })
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.date))
      .limit(1);

    if (firstTransaction.length === 0) return false;

    const daysSinceFirstTransaction = Math.floor(
      (now.getTime() - firstTransaction[0].date.getTime()) /
        (24 * 60 * 60 * 1000)
    );

    return daysSinceFirstTransaction >= rule.firstTransactionDelayDays;
  } else {
    // Subsequent payout - check if random delay has passed
    const daysSinceLastPayout = Math.floor(
      (now.getTime() - recentPayout[0].payoutDate.getTime()) /
        (24 * 60 * 60 * 1000)
    );

    const randomDelay =
      Math.floor(
        Math.random() *
          (rule.subsequentDelayDaysMax - rule.subsequentDelayDaysMin + 1)
      ) + rule.subsequentDelayDaysMin;

    return daysSinceLastPayout >= randomDelay;
  }
}

// Helper function to create automatic payout
async function createAutomaticPayout(
  userId: string,
  amount: number
): Promise<any> {
  console.log(
    `💸 Creating automatic payout for user ${userId}, amount: $${amount}`
  );

  // Get user's Stripe account
  const userAccount = await db
    .select({
      stripeAccountId: users.stripeAccountId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (userAccount.length === 0 || !userAccount[0].stripeAccountId) {
    throw new Error(`No Stripe account found for user ${userId}`);
  }

  const payoutDate = new Date();
  const payoutId = `payout_${Date.now()}_${userId}`;

  // Create payout record
  await db.insert(payouts).values({
    id: payoutId,
    userId,
    amount: amount.toFixed(2),
    currency: "JMD",
    status: "pending",
    payoutDate,
    bankAccount: "****8689", // In real implementation, get from Stripe
    description: `Automatic payout - ${payoutDate.toLocaleDateString()}`,
  });

  // In a real implementation, you would:
  // 1. Create a Stripe Transfer to the user's account
  // 2. Update the payout status based on the transfer result
  // 3. Handle any errors

  // For now, we'll mark it as completed immediately
  await db
    .update(payouts)
    .set({
      status: "completed",
      processedAt: new Date(),
      stripePayoutId: `stripe_payout_${Date.now()}`,
      updatedAt: new Date(),
    })
    .where(eq(payouts.id, payoutId));

  return {
    payoutId,
    userId,
    amount,
    status: "completed",
  };
}

const port = process.env.PORT || 3000;

console.log(`🚀 Server starting on port ${port}...`);

serve({
  fetch: app.fetch,
  port: Number(port),
});

console.log(`✅ Server running on http://localhost:${port}`);
