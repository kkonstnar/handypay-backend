import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { StripeService } from "./stripe.js";
import { db } from "./db.js";
import { users, transactions } from "./schema.js";
import { eq, desc } from "drizzle-orm";

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
      userId
    );

    return c.json({
      success: true,
      message: "Onboarding completed successfully",
      userId,
      stripeAccountId,
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
          stripeAccountId: stripeAccountId || null,
          stripeOnboardingCompleted: stripeOnboardingCompleted || false,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id));

      console.log(`✅ Updated existing user in backend: ${id}`);
      console.log(`✅ Stripe data saved:`, {
        stripeAccountId: stripeAccountId,
        stripeOnboardingCompleted: stripeOnboardingCompleted,
      });
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
      console.log(`✅ Stripe data saved:`, {
        stripeAccountId: stripeAccountId,
        stripeOnboardingCompleted: stripeOnboardingCompleted,
      });
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
      amount: tx.amount,
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
    return c.json({
      error: "Failed to test update",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
});

// Debug endpoint to manually update user Stripe account
app.post("/api/debug/update-stripe-account", async (c) => {
  try {
    const { userId, stripeAccountId } = await c.req.json();

    console.log(`🔧 Manually updating user ${userId} with Stripe account ${stripeAccountId}`);

    const result = await db
      .update(users)
      .set({
        stripeAccountId: stripeAccountId,
        stripeOnboardingCompleted: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    console.log(`✅ Update result:`, result);

    return c.json({
      success: true,
      message: "User Stripe account updated",
      userId,
      stripeAccountId,
    });
  } catch (error) {
    console.error("❌ Debug update error:", error);
    return c.json({ error: "Failed to update user" }, 500);
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

const port = process.env.PORT || 3000;

console.log(`🚀 Server starting on port ${port}...`);

serve({
  fetch: app.fetch,
  port: Number(port),
});

console.log(`✅ Server running on http://localhost:${port}`);
