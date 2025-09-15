import { Hono } from "hono";
import { db, initializeDatabase } from "../db.js";
import { transactions } from "../schema.js";
import { eq, desc } from "drizzle-orm";
import { requireOwnership } from "../index.js";

const transactionRoutes = new Hono();

// Get user transactions endpoint
transactionRoutes.get("/:userId", async (c) => {
  try {
    // Initialize database with environment variables
    initializeDatabase((c as any).env);

    // Add timeout to prevent hanging requests (30 seconds)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Request timeout")), 30000);
    });

    const mainLogic = async () => {
      const userId = c.req.param("userId");

      if (!userId) {
        return c.json({ error: "Missing userId parameter" }, 400);
      }

      // Verify ownership - users can only access their own transactions
      const authenticatedUser = (c as any).get("user") as
        | { id: string }
        | undefined;

      console.log("🔐 Authenticated user in transactions route:", {
        hasUser: !!authenticatedUser,
        userId: authenticatedUser?.id,
        userType: typeof authenticatedUser?.id,
        requestUserId: userId,
        requestUserIdType: typeof userId,
      });

      if (!authenticatedUser || !authenticatedUser.id) {
        console.error("❌ No authenticated user found in context");
        return c.json({ error: "Authentication required" }, 401);
      }

      requireOwnership(authenticatedUser.id, userId);

      console.log("📊 Getting transactions for user:", userId);

      try {
        console.log("🔍 Executing database query for user:", userId);

        let userTransactions;
        try {
          userTransactions = await db
            .select()
            .from(transactions)
            .where(eq(transactions.userId, userId))
            .orderBy(desc(transactions.createdAt));
        } catch (dbQueryError) {
          console.error(
            "❌ Database query failed, attempting retry:",
            dbQueryError
          );

          // Force database reconnection and retry once
          const dbModule = await import("../db.js");
          if (
            dbModule &&
            typeof (dbModule as any).resetDatabaseConnection === "function"
          ) {
            (dbModule as any).resetDatabaseConnection();
          }

          // Wait a moment before retrying
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Retry the query
          userTransactions = await db
            .select()
            .from(transactions)
            .where(eq(transactions.userId, userId))
            .orderBy(desc(transactions.createdAt));

          console.log("✅ Database query retry successful");
        }

        console.log("📊 Database query completed:", {
          transactionCount: userTransactions.length,
          firstTransaction: userTransactions[0]
            ? {
                id: userTransactions[0].id,
                type: userTransactions[0].type,
                status: userTransactions[0].status,
              }
            : null,
        });

        // Transform to match frontend interface
        const formattedTransactions = userTransactions.map((tx) => ({
          id: tx.id,
          type: tx.type,
          amount: tx.amount / 100, // Convert cents to dollars for frontend
          currency: tx.currency, // Include currency field
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
          createdAt: tx.createdAt ? new Date(tx.createdAt) : undefined, // When transaction was created
          completedAt:
            tx.status === "completed" && tx.updatedAt
              ? new Date(tx.updatedAt)
              : undefined, // When transaction was completed
        }));

        console.log(
          "✅ Returning formatted transactions:",
          formattedTransactions.length
        );
        return c.json({
          success: true,
          transactions: formattedTransactions,
        });
      } catch (dbError) {
        console.error("❌ Database query error:", dbError);
        return c.json({ error: "Database query failed" }, 500);
      }
    };

    // Execute main logic with timeout protection
    const result = await Promise.race([mainLogic(), timeoutPromise]);
    return result as any;
  } catch (error) {
    console.error("❌ Transactions error:", error);
    if (error instanceof Error && error.message === "Request timeout") {
      return c.json({ error: "Request timeout" }, 408);
    }
    return c.json({ error: "Failed to get transactions" }, 500);
  }
});

// Cancel transaction endpoint
transactionRoutes.post("/cancel", async (c) => {
  try {
    // Initialize database with environment variables
    initializeDatabase((c as any).env);

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

    // Verify ownership - users can only cancel their own transactions
    const authenticatedUser = (c as any).get("user") as { id: string };
    requireOwnership(authenticatedUser.id, userId);

    // Try to find transaction by multiple methods to handle different ID formats
    let transaction;

    // First, try exact match with transaction ID
    console.log(
      "🔍 Attempt 1: Exact match with transaction ID:",
      transactionId
    );
    transaction = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .limit(1);

    console.log(
      "🔍 Attempt 1 result:",
      transaction.length > 0 ? "FOUND" : "NOT FOUND"
    );

    // If not found, try matching with stripePaymentLinkId
    if (transaction.length === 0) {
      console.log(
        "🔍 Attempt 2: Trying stripePaymentLinkId match with:",
        transactionId
      );
      transaction = await db
        .select()
        .from(transactions)
        .where(eq(transactions.stripePaymentLinkId, transactionId))
        .limit(1);

      console.log(
        "🔍 Attempt 2 result:",
        transaction.length > 0 ? "FOUND" : "NOT FOUND"
      );
    }

    // If still not found and transactionId starts with 'plink_', try removing the prefix
    if (transaction.length === 0 && transactionId.startsWith("plink_")) {
      const stripeId = transactionId.replace("plink_", "");
      console.log("🔍 Attempt 3: Trying without plink_ prefix:", stripeId);
      transaction = await db
        .select()
        .from(transactions)
        .where(eq(transactions.stripePaymentLinkId, stripeId))
        .limit(1);

      console.log(
        "🔍 Attempt 3 result:",
        transaction.length > 0 ? "FOUND" : "NOT FOUND"
      );
    }

    // If still not found, try to find any transaction for this user and log them
    if (transaction.length === 0) {
      console.log("🔍 Attempt 4: Listing all transactions for user:", userId);
      const allUserTransactions = await db
        .select()
        .from(transactions)
        .where(eq(transactions.userId, userId))
        .limit(10);

      console.log(
        "🔍 All user transactions:",
        allUserTransactions.map((tx) => ({
          id: tx.id,
          type: tx.type,
          status: tx.status,
          stripePaymentLinkId: tx.stripePaymentLinkId,
        }))
      );

      console.log("❌ Transaction not found with any method");
      return c.json({ error: "Transaction not found" }, 404);
    }

    const tx = transaction[0];
    console.log("✅ Found transaction:", tx.id, "for user:", tx.userId);

    // Check if user owns this transaction
    if (tx.userId !== userId) {
      return c.json({ error: "Unauthorized" }, 403);
    }

    // Check if transaction can be cancelled
    if (tx.status !== "pending") {
      return c.json(
        {
          error: `Cannot cancel transaction with status: ${tx.status}`,
        },
        400
      );
    }

    // Handle payment link cancellation
    if (tx.stripePaymentLinkId && tx.status === "pending") {
      console.log("🔗 Cancelling Stripe payment link:", tx.stripePaymentLinkId);
      const { StripeService } = await import("../services/stripe.js");
      await StripeService.cancelPaymentLink(
        c.env,
        tx.stripePaymentLinkId,
        userId
      );
    } else {
      // Update transaction status directly
      console.log("💾 Updating transaction status to cancelled");
      await db
        .update(transactions)
        .set({
          status: "cancelled",
          updatedAt: new Date(),
          notes: "Transaction cancelled by user",
        })
        .where(eq(transactions.id, tx.id));
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

export { transactionRoutes };
