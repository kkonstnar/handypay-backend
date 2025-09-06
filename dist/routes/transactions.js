import { Hono } from "hono";
import { db } from "../db.js";
import { transactions } from "../schema.js";
import { eq, desc } from "drizzle-orm";
import { requireOwnership } from "../index.js";
const transactionRoutes = new Hono();
// Get user transactions endpoint
transactionRoutes.get("/:userId", async (c) => {
    try {
        const authenticatedUser = c.get("user");
        const userId = c.req.param("userId");
        if (!userId) {
            return c.json({ error: "Missing userId parameter" }, 400);
        }
        // Verify ownership - users can only access their own transactions
        requireOwnership(authenticatedUser.id, userId);
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
    }
    catch (error) {
        console.error("❌ Transactions error:", error);
        return c.json({ error: "Failed to get transactions" }, 500);
    }
});
// Cancel transaction endpoint
transactionRoutes.post("/cancel", async (c) => {
    try {
        const { transactionId, userId } = await c.req.json();
        if (!transactionId || !userId) {
            return c.json({ error: "Missing required fields: transactionId, userId" }, 400);
        }
        console.log("🗑️ Cancelling transaction:", transactionId, "for user:", userId);
        // Try to find transaction by multiple methods to handle different ID formats
        let transaction;
        // First, try exact match with transaction ID
        console.log("🔍 Attempt 1: Exact match with transaction ID:", transactionId);
        transaction = await db
            .select()
            .from(transactions)
            .where(eq(transactions.id, transactionId))
            .limit(1);
        console.log("🔍 Attempt 1 result:", transaction.length > 0 ? "FOUND" : "NOT FOUND");
        // If not found, try matching with stripePaymentLinkId
        if (transaction.length === 0) {
            console.log("🔍 Attempt 2: Trying stripePaymentLinkId match with:", transactionId);
            transaction = await db
                .select()
                .from(transactions)
                .where(eq(transactions.stripePaymentLinkId, transactionId))
                .limit(1);
            console.log("🔍 Attempt 2 result:", transaction.length > 0 ? "FOUND" : "NOT FOUND");
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
            console.log("🔍 Attempt 3 result:", transaction.length > 0 ? "FOUND" : "NOT FOUND");
        }
        // If still not found, try to find any transaction for this user and log them
        if (transaction.length === 0) {
            console.log("🔍 Attempt 4: Listing all transactions for user:", userId);
            const allUserTransactions = await db
                .select()
                .from(transactions)
                .where(eq(transactions.userId, userId))
                .limit(10);
            console.log("🔍 All user transactions:", allUserTransactions.map((tx) => ({
                id: tx.id,
                type: tx.type,
                status: tx.status,
                stripePaymentLinkId: tx.stripePaymentLinkId,
            })));
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
            return c.json({
                error: `Cannot cancel transaction with status: ${tx.status}`,
            }, 400);
        }
        // Handle payment link cancellation
        if (tx.stripePaymentLinkId && tx.status === "pending") {
            console.log("🔗 Cancelling Stripe payment link:", tx.stripePaymentLinkId);
            const { StripeService } = await import("../services/stripe.js");
            await StripeService.cancelPaymentLink(c.env, tx.stripePaymentLinkId, userId);
        }
        else {
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
    }
    catch (error) {
        console.error("❌ Transaction cancellation error:", error);
        return c.json({
            success: false,
            error: error instanceof Error
                ? error.message
                : "Failed to cancel transaction",
        }, 500);
    }
});
export { transactionRoutes };
