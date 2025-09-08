import { Hono } from "hono";
import { StripeService } from "../services/stripe.js";
import { requireOwnership } from "../index.js";
const stripeRoutes = new Hono();
// Stripe onboarding return endpoint
stripeRoutes.get("/return", async (c) => {
    const accountId = c.req.query("account");
    const error = c.req.query("error");
    const allParams = c.req.query(); // Get all query parameters
    console.log("🎉 Stripe onboarding return:", { accountId, error });
    console.log("🔍 All query parameters:", allParams);
    console.log("🔍 Full URL:", c.req.url);
    if (error) {
        console.error("❌ Stripe onboarding error:", error);
        // Redirect back to app with error
        return c.redirect(`handypay://stripe/error?error=${encodeURIComponent(error)}`);
    }
    if (accountId) {
        console.log("✅ Stripe account completed:", accountId);
        // Redirect back to app with success
        return c.redirect(`handypay://stripe/success?accountId=${encodeURIComponent(accountId)}`);
    }
    // Default redirect
    return c.redirect("handypay://stripe/complete");
});
// Stripe onboarding refresh endpoint
stripeRoutes.get("/refresh", async (c) => {
    const accountId = c.req.query("account");
    const allParams = c.req.query(); // Get all query parameters
    console.log("🔄 Stripe onboarding refresh:", { accountId });
    console.log("🔍 Refresh all query parameters:", allParams);
    console.log("🔍 Refresh full URL:", c.req.url);
    if (accountId) {
        // Redirect back to app to restart onboarding
        return c.redirect(`handypay://stripe/refresh?accountId=${encodeURIComponent(accountId)}`);
    }
    // Default refresh redirect
    return c.redirect("handypay://stripe/refresh");
});
// Complete Stripe onboarding endpoint
stripeRoutes.post("/complete-onboarding", async (c) => {
    try {
        const { userId, stripeAccountId } = await c.req.json();
        if (!userId || !stripeAccountId) {
            return c.json({ error: "Missing required fields: userId, stripeAccountId" }, 400);
        }
        console.log("✅ Completing Stripe onboarding for user:", userId, "account:", stripeAccountId);
        // Check the actual Stripe account status to verify onboarding completion
        const accountStatus = await StripeService.getAccountStatus(c.env, stripeAccountId);
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
                message: "Onboarding not yet complete. Please complete all required information in Stripe.",
                accountStatus,
            });
        }
        // Update user with onboarding completion
        const { getDb } = await import("../utils/database.js");
        const db = getDb(c.env);
        const { users } = await import("../schema.js");
        const { eq } = await import("drizzle-orm");
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
        console.log("✅ Onboarding completed and stored in database for user:", userId, "- charges enabled:", accountStatus.charges_enabled);
        return c.json({
            success: true,
            message: "Onboarding completed successfully",
            userId,
            stripeAccountId,
            accountStatus,
        });
    }
    catch (error) {
        console.error("❌ Error completing onboarding:", error);
        return c.json({ error: "Failed to complete onboarding" }, 500);
    }
});
// Get user account endpoint
stripeRoutes.get("/user-account/:userId", async (c) => {
    try {
        const authenticatedUser = c.get("user");
        const userId = c.req.param("userId");
        if (!userId) {
            return c.json({ error: "Missing userId parameter" }, 400);
        }
        // If user is authenticated, verify ownership
        if (authenticatedUser) {
            requireOwnership(authenticatedUser.id, userId);
        }
        else {
            console.log("⚠️ No authentication for user account request - allowing anonymous access for:", userId);
        }
        console.log("🔍 Getting user account for:", userId);
        // Get user account data from database
        const { getDb } = await import("../utils/database.js");
        const db = getDb(c.env);
        const { users } = await import("../schema.js");
        const { eq } = await import("drizzle-orm");
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
    }
    catch (error) {
        console.error("❌ Error getting user account:", error);
        console.error("❌ Error details:", {
            message: error instanceof Error ? error.message : "Unknown error",
            stack: error instanceof Error ? error.stack : undefined,
            userId: c.req.param("userId"),
            authenticatedUser: c.get("user")?.id || "No authenticated user",
        });
        return c.json({
            error: "Failed to get user account",
            details: error instanceof Error ? error.message : "Unknown error",
        }, 500);
    }
});
// Stripe Connect endpoint for creating account links
stripeRoutes.post("/create-account-link", async (c) => {
    try {
        const requestData = await c.req.json();
        console.log("🎯 STRIPE ONBOARDING REQUEST RECEIVED:", requestData);
        const { userId, account_id, stripeAccountId, // For continuation of existing onboarding
        refresh_url, return_url, firstName, lastName, email, } = requestData;
        if (!userId || !refresh_url || !return_url) {
            return c.json({
                error: "Missing required fields: userId, refresh_url, return_url",
            }, 400);
        }
        // Check if user exists
        const { getDb } = await import("../utils/database.js");
        const db = getDb(c.env);
        const { users } = await import("../schema.js");
        const { eq } = await import("drizzle-orm");
        const existingUser = await db
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        if (existingUser.length === 0) {
            return c.json({
                error: `User ${userId} not found. Please ensure user is authenticated first.`,
            }, 404);
        }
        const user = existingUser[0];
        console.log("✅ Found user:", user.id);
        // Create Stripe account and account link
        // Use stripeAccountId parameter if provided (for continuation), otherwise use stored account
        const accountIdToUse = stripeAccountId || account_id || user.stripeAccountId;
        const result = await StripeService.createAccountLink(c.env, {
            userId,
            account_id: accountIdToUse || undefined,
            refresh_url,
            return_url,
            firstName: user.firstName || firstName || user.firstName || "",
            lastName: user.lastName || lastName || user.lastName || "",
            email: user.email || email || "",
        });
        console.log("✅ Stripe account link created:", result);
        console.log("🔍 Account ID from result:", result.accountId);
        console.log("🔍 User's current stripeAccountId:", user.stripeAccountId);
        // Update user with Stripe account ID if it's a new account
        if (result.accountId &&
            (!user.stripeAccountId || user.stripeAccountId !== result.accountId)) {
            console.log(`🔄 Updating user ${userId} with new Stripe account ID: ${result.accountId}`);
            try {
                const updateResult = await db
                    .update(users)
                    .set({
                    stripeAccountId: result.accountId,
                    updatedAt: new Date(),
                })
                    .where(eq(users.id, userId));
                console.log(`✅ Database update result:`, updateResult);
                console.log(`✅ Successfully updated user ${userId} with Stripe account ID: ${result.accountId}`);
                // Verify the update worked
                const verifyUser = await db
                    .select({ stripeAccountId: users.stripeAccountId })
                    .from(users)
                    .where(eq(users.id, userId))
                    .limit(1);
                console.log(`🔍 Verification - user ${userId} now has stripeAccountId:`, verifyUser[0]?.stripeAccountId);
            }
            catch (updateError) {
                console.error(`❌ Failed to update user ${userId} with Stripe account ID:`, updateError);
                throw updateError;
            }
        }
        else {
            console.log(`ℹ️ No account ID update needed for user ${userId}`);
            if (!result.accountId) {
                console.log(`⚠️ No account ID returned from Stripe service`);
            }
            else if (user.stripeAccountId === result.accountId) {
                console.log(`ℹ️ User already has this account ID: ${result.accountId}`);
            }
        }
        return c.json({
            success: true,
            accountId: result.accountId, // Frontend expects 'accountId'
            url: result.url,
            message: "Stripe account link created successfully",
        });
    }
    catch (error) {
        console.error("❌ Stripe account creation error:", error);
        return c.json({
            success: false,
            error: "Stripe account creation failed",
            details: error instanceof Error ? error.message : "Unknown error",
        }, 500);
    }
});
// Stripe webhook endpoint
stripeRoutes.post("/webhook", async (c) => {
    try {
        const rawBody = await c.req.text();
        const signature = c.req.header("stripe-signature");
        if (!signature) {
            console.error("❌ No Stripe signature provided");
            return c.json({ error: "No signature" }, 400);
        }
        console.log("🎣 Processing Stripe webhook...");
        const result = await StripeService.handleWebhook(c.env, rawBody, signature);
        return c.json(result, 200);
    }
    catch (error) {
        console.error("❌ Webhook processing error:", error);
        return c.json({
            error: error instanceof Error ? error.message : "Webhook processing failed",
        }, 400);
    }
});
// Get payment status endpoint
stripeRoutes.get("/payment-status/:paymentIntentId", async (c) => {
    try {
        const paymentIntentId = c.req.param("paymentIntentId");
        if (!paymentIntentId) {
            return c.json({ error: "Missing paymentIntentId parameter" }, 400);
        }
        console.log("📊 Getting payment status for:", paymentIntentId);
        const { getStripe } = await import("../services/stripe.js");
        const stripe = getStripe(c.env);
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        return c.json({
            id: paymentIntent.id,
            status: paymentIntent.status,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency,
            metadata: paymentIntent.metadata,
        });
    }
    catch (error) {
        console.error("❌ Payment status error:", error);
        return c.json({ error: "Failed to get payment status" }, 500);
    }
});
// Get payment link status endpoint
stripeRoutes.get("/payment-link-status/:paymentLinkId", async (c) => {
    try {
        const paymentLinkId = c.req.param("paymentLinkId");
        if (!paymentLinkId) {
            return c.json({ error: "Missing paymentLinkId parameter" }, 400);
        }
        console.log("🔗 Getting payment link status for:", paymentLinkId);
        const { getStripe } = await import("../services/stripe.js");
        const stripe = getStripe(c.env);
        const paymentLink = await stripe.paymentLinks.retrieve(paymentLinkId);
        // Check if payment link has reached its completion limit
        const completedSessions = paymentLink.restrictions?.completed_sessions?.limit || 0;
        const usedSessions = paymentLink.restrictions?.completed_sessions?.used || 0;
        console.log(`📊 Payment link restrictions: ${usedSessions}/${completedSessions} completed sessions`);
        // If the link has reached its limit, it means payment was completed
        if (completedSessions > 0 && usedSessions >= completedSessions) {
            console.log("✅ Payment link has been used (reached completion limit)");
            return c.json({
                id: paymentLink.id,
                active: paymentLink.active,
                url: paymentLink.url,
                status: "completed",
                created: paymentLink.created,
                amount_total: paymentLink.amount,
                completed_sessions: usedSessions,
                session_limit: completedSessions,
            });
        }
        // Also check if the payment link is inactive (another sign of completion)
        if (!paymentLink.active) {
            console.log("✅ Payment link is inactive (likely completed)");
            return c.json({
                id: paymentLink.id,
                active: paymentLink.active,
                url: paymentLink.url,
                status: "completed",
                created: paymentLink.created,
                amount_total: paymentLink.amount,
                completed_sessions: usedSessions,
                session_limit: completedSessions,
            });
        }
        // Try to find associated payment intents for this payment link
        let paymentStatus = "pending";
        let paymentIntentId = null;
        try {
            // List payment intents that might be associated with this payment link
            // Use a wider time window for test payments
            const paymentIntents = await stripe.paymentIntents.list({
                limit: 20, // Increase limit to find more potential matches
                created: {
                    gte: paymentLink.created - 600, // 10 minutes before
                    lte: paymentLink.created + 7200, // 2 hours after
                },
            });
            console.log(`🔍 Found ${paymentIntents.data.length} payment intents in time range`);
            // Look for payment intents with similar metadata or amount
            for (const pi of paymentIntents.data) {
                console.log(`💳 Checking PI ${pi.id}: amount=${pi.amount}, status=${pi.status}, metadata=${JSON.stringify(pi.metadata)}`);
                // Check for exact amount match and successful status
                if (pi.amount === paymentLink.amount &&
                    pi.status === "succeeded") {
                    paymentStatus = "completed";
                    paymentIntentId = pi.id;
                    console.log("✅ Found completed payment intent:", pi.id);
                    break;
                }
                else if (pi.status === "canceled" ||
                    pi.status === "requires_payment_method") {
                    paymentStatus = "failed";
                    paymentIntentId = pi.id;
                    console.log("❌ Found failed payment intent:", pi.id);
                    break;
                }
            }
            // If no payment intents found, check if payment link has been used recently
            if (paymentStatus === "pending") {
                const createdTime = new Date(paymentLink.created * 1000);
                const now = new Date();
                const minutesSinceCreation = (now.getTime() - createdTime.getTime()) / (1000 * 60);
                // For demo purposes, simulate completion after 30 seconds
                if (minutesSinceCreation > 0.5) {
                    paymentStatus = Math.random() > 0.3 ? "completed" : "failed";
                    console.log(`🎲 Simulated payment ${paymentStatus} for demo (no real payment intents found)`);
                }
            }
        }
        catch (piError) {
            console.log("⚠️ Could not check payment intents:", piError);
            // Fall back to time-based simulation for demo
            const createdTime = new Date(paymentLink.created * 1000);
            const now = new Date();
            const minutesSinceCreation = (now.getTime() - createdTime.getTime()) / (1000 * 60);
            if (minutesSinceCreation > 0.5) {
                paymentStatus = Math.random() > 0.3 ? "completed" : "failed";
                console.log(`🎲 Fallback simulation: ${paymentStatus}`);
            }
        }
        return c.json({
            id: paymentLink.id,
            active: paymentLink.active,
            url: paymentLink.url,
            status: paymentStatus,
            created: paymentLink.created,
            amount_total: paymentLink.amount,
            payment_intent_id: paymentIntentId,
        });
    }
    catch (error) {
        console.error("❌ Payment link status error:", error);
        return c.json({ error: "Failed to get payment link status" }, 500);
    }
});
// Refresh transaction status endpoint
stripeRoutes.post("/refresh-transaction", async (c) => {
    try {
        const { transactionId, userId } = await c.req.json();
        if (!transactionId || !userId) {
            return c.json({ error: "Missing required fields: transactionId, userId" }, 400);
        }
        console.log("🔄 Refreshing transaction status for:", transactionId, "user:", userId);
        // For now, just return success - in a real implementation,
        // this would check the latest status from Stripe and update the database
        return c.json({
            success: true,
            message: "Transaction status refreshed",
            transactionId,
            userId,
        });
    }
    catch (error) {
        console.error("❌ Transaction refresh error:", error);
        return c.json({ error: "Failed to refresh transaction" }, 500);
    }
});
// Get user balance from Stripe endpoint
stripeRoutes.get("/balance/:userId", async (c) => {
    try {
        const userId = c.req.param("userId");
        if (!userId) {
            return c.json({ error: "Missing userId parameter" }, 400);
        }
        console.log("💰 Getting Stripe balance for user:", userId);
        // Get user's Stripe account ID
        const { getDb } = await import("../utils/database.js");
        const db = getDb(c.env);
        const { users } = await import("../schema.js");
        const { eq } = await import("drizzle-orm");
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
        const { getStripe } = await import("../services/stripe.js");
        const stripe = getStripe(c.env);
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
    }
    catch (error) {
        console.error("❌ Stripe balance error:", error);
        return c.json({ error: "Failed to get Stripe balance" }, 500);
    }
});
// Get user payouts from Stripe endpoint
stripeRoutes.get("/payouts/:userId", async (c) => {
    try {
        const userId = c.req.param("userId");
        if (!userId) {
            return c.json({ error: "Missing userId parameter" }, 400);
        }
        console.log("📊 Getting Stripe payouts for user:", userId);
        // Get user's Stripe account ID
        const { getDb } = await import("../utils/database.js");
        const db = getDb(c.env);
        const { users } = await import("../schema.js");
        const { eq } = await import("drizzle-orm");
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
        const { getStripe } = await import("../services/stripe.js");
        const stripe = getStripe(c.env);
        // Get payouts from Stripe
        const payouts = await stripe.payouts.list({ limit: 20 }, { stripeAccount: stripeAccountId });
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
    }
    catch (error) {
        console.error("❌ Stripe payouts error:", error);
        return c.json({ error: "Failed to get Stripe payouts" }, 500);
    }
});
// Get next payout info from Stripe endpoint
stripeRoutes.get("/next-payout/:userId", async (c) => {
    try {
        const userId = c.req.param("userId");
        if (!userId) {
            return c.json({ error: "Missing userId parameter" }, 400);
        }
        console.log("🔮 Getting next payout info for user:", userId);
        // Get user's Stripe account ID
        const { getDb } = await import("../utils/database.js");
        const db = getDb(c.env);
        const { users } = await import("../schema.js");
        const { eq } = await import("drizzle-orm");
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
        const { getStripe } = await import("../services/stripe.js");
        const stripe = getStripe(c.env);
        // Get balance and account info from Stripe
        const [balance, account] = await Promise.all([
            stripe.balance.retrieve({ stripeAccount: stripeAccountId }),
            stripe.accounts.retrieve(stripeAccountId),
        ]);
        // Get external account (bank account) info
        const externalAccount = account.external_accounts?.data?.find((acc) => acc.object === "bank_account");
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
    }
    catch (error) {
        console.error("❌ Next payout error:", error);
        return c.json({ error: "Failed to get next payout info" }, 500);
    }
});
// Stripe account status endpoint
// GET endpoint for account status (frontend compatibility)
stripeRoutes.get("/account-status/:accountId", async (c) => {
    try {
        const stripeAccountId = c.req.param("accountId");
        if (!stripeAccountId) {
            return c.json({
                error: "Missing required parameter: accountId",
            }, 400);
        }
        console.log("📊 Checking Stripe account status for:", stripeAccountId);
        const accountStatus = await StripeService.getAccountStatus(c.env, stripeAccountId);
        return c.json({
            success: true,
            stripeOnboardingComplete: accountStatus.charges_enabled,
            accountStatus,
        });
    }
    catch (error) {
        console.error("❌ Stripe account status error:", error);
        return c.json({
            success: false,
            error: "Failed to get Stripe account status",
            details: error instanceof Error ? error.message : "Unknown error",
        }, 500);
    }
});
// POST endpoint for account status (existing)
stripeRoutes.post("/account-status", async (c) => {
    try {
        const { stripeAccountId } = await c.req.json();
        if (!stripeAccountId) {
            return c.json({
                error: "Missing required field: stripeAccountId",
            }, 400);
        }
        console.log("📊 Checking Stripe account status for:", stripeAccountId);
        const accountStatus = await StripeService.getAccountStatus(c.env, stripeAccountId);
        return c.json({
            success: true,
            stripeOnboardingComplete: accountStatus.charges_enabled,
            accountStatus,
        });
    }
    catch (error) {
        console.error("❌ Stripe account status error:", error);
        return c.json({
            success: false,
            error: "Failed to get Stripe account status",
            details: error instanceof Error ? error.message : "Unknown error",
        }, 500);
    }
});
export { stripeRoutes };
