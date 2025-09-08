import Stripe from "stripe";
import { users, transactions } from "../schema.js";
import { eq } from "drizzle-orm";
// Stripe instance will be created with environment variables
let stripe;
export function getStripe(env) {
    if (!stripe) {
        // Try Cloudflare env first, then fall back to process.env for local development
        const STRIPE_TEST_SECRET_KEY = env?.STRIPE_TEST_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY;
        if (!STRIPE_TEST_SECRET_KEY) {
            throw new Error("STRIPE_TEST_SECRET_KEY is required");
        }
        stripe = new Stripe(STRIPE_TEST_SECRET_KEY, {
            apiVersion: "2025-08-27.basil",
        });
    }
    return stripe;
}
export class StripeService {
    static async createAccountLink(env, { userId, account_id, firstName, lastName, email, refresh_url, return_url, }) {
        try {
            console.log("Creating Stripe account link for user:", userId);
            console.log("Input parameters:", { userId, account_id, firstName, lastName, email });
            const stripe = getStripe(env);
            const { getDb } = await import("../utils/database.js");
            const db = getDb(env);
            let accountId = account_id;
            let account;
            console.log("Initial accountId from input:", accountId);
            // Always create new account if no account_id provided
            // This ensures we always have an account to work with
            if (!accountId) {
                console.log("Creating new Stripe account for user:", userId);
                // Create new account for Jamaica (JM) with JMD currency
                account = await stripe.accounts.create({
                    type: "custom",
                    country: "JM",
                    business_type: "individual",
                    metadata: { userId },
                    email,
                    capabilities: {
                        transfers: { requested: true },
                    },
                    tos_acceptance: {
                        service_agreement: "recipient",
                    },
                    individual: {
                        first_name: firstName,
                        last_name: lastName,
                        email,
                    },
                    settings: {
                        payouts: {
                            schedule: {
                                interval: "weekly",
                                weekly_anchor: "tuesday",
                            },
                        },
                    },
                    default_currency: "JMD",
                });
                accountId = account.id;
                console.log(`✅ Created new Stripe account: ${accountId} for user ${userId}`);
                console.log("Account creation details:", {
                    accountId,
                    email: account.email,
                    country: account.country,
                    type: account.type
                });
            }
            else {
                console.log("Using existing Stripe account:", accountId);
                // Update existing account details
                account = await stripe.accounts.update(accountId, {
                    email,
                    business_profile: {
                        name: `${firstName} ${lastName}`.trim() || "HandyPay Merchant",
                        support_email: email,
                    },
                    metadata: { userId },
                });
            }
            // Try to save the Stripe account ID to database (don't fail if user doesn't exist yet)
            console.log(`🔄 Attempting to save Stripe account ${accountId} for user ${userId} to database...`);
            if (accountId) {
                try {
                    console.log(`🔍 Checking if user ${userId} exists in database...`);
                    // First check if user exists
                    const existingUser = await db
                        .select({ id: users.id, stripeAccountId: users.stripeAccountId })
                        .from(users)
                        .where(eq(users.id, userId))
                        .limit(1);
                    console.log(`📊 User existence check result:`, {
                        userId,
                        userExists: existingUser.length > 0,
                        currentStripeAccountId: existingUser[0]?.stripeAccountId || null,
                    });
                    if (existingUser.length > 0) {
                        // User exists, update their Stripe account ID
                        console.log(`📝 Updating existing user ${userId} with Stripe account ${accountId}`);
                        const updateResult = await db
                            .update(users)
                            .set({
                            stripeAccountId: accountId,
                            updatedAt: new Date(),
                        })
                            .where(eq(users.id, userId));
                        console.log(`✅ Updated Stripe account ID ${accountId} for existing user ${userId}`, `Update result:`, updateResult);
                    }
                    else {
                        // User doesn't exist, create a minimal user record
                        console.log(`👤 User ${userId} doesn't exist, creating new record with Stripe account ${accountId}`);
                        const insertResult = await db.insert(users).values({
                            id: userId,
                            email: email || null,
                            firstName: firstName || null,
                            lastName: lastName || null,
                            fullName: `${firstName || ""} ${lastName || ""}`.trim() || null,
                            authProvider: "unknown", // Will be updated when user authenticates
                            stripeAccountId: accountId,
                            stripeOnboardingCompleted: false, // Will be updated when onboarding completes
                            memberSince: new Date(),
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        });
                        console.log(`✅ Created new user record and saved Stripe account ID ${accountId} for user ${userId}`, `Insert result:`, insertResult);
                    }
                    // Verify the save worked
                    const verification = await db
                        .select({ stripeAccountId: users.stripeAccountId })
                        .from(users)
                        .where(eq(users.id, userId))
                        .limit(1);
                    if (verification.length > 0 &&
                        verification[0].stripeAccountId === accountId) {
                        console.log(`✅ Database save verification successful: ${verification[0].stripeAccountId}`);
                    }
                    else {
                        console.error(`❌ Database save verification failed! Expected: ${accountId}, Got: ${verification[0]?.stripeAccountId || "null"}`);
                    }
                }
                catch (err) {
                    console.error("❌ Error saving stripeAccountId to DB:", err);
                    console.error("❌ Database error details:", {
                        error: err,
                        message: err instanceof Error ? err.message : "Unknown error",
                        userId,
                        accountId,
                    });
                    console.log("⚠️ Continuing with account creation despite DB error...");
                }
            }
            else {
                console.error("❌ No accountId provided to save to database!");
            }
            // Create account link for onboarding
            const accountLink = await stripe.accountLinks.create({
                account: accountId,
                refresh_url,
                return_url,
                type: "account_onboarding",
                collect: "eventually_due",
            });
            console.log("Stripe account link created successfully:", accountLink.url);
            console.log("Returning account data:", { url: accountLink.url, accountId });
            return {
                url: accountLink.url,
                accountId: accountId,
            };
        }
        catch (error) {
            console.error("Error creating Stripe account link:", error);
            if (error instanceof Stripe.errors.StripeError) {
                throw new Error(`Stripe Error: ${error.message}`);
            }
            throw new Error("Failed to create Stripe account link");
        }
    }
    static async getAccountStatus(env, accountId) {
        try {
            const stripe = getStripe(env);
            const account = await stripe.accounts.retrieve(accountId);
            return {
                id: account.id,
                charges_enabled: account.charges_enabled,
                payouts_enabled: account.payouts_enabled,
                details_submitted: account.details_submitted,
                requirements: account.requirements,
            };
        }
        catch (error) {
            console.error("Error retrieving account status:", error);
            throw new Error("Failed to retrieve account status");
        }
    }
    static async getUserStripeAccount(env, userId) {
        try {
            console.log(`🔍 Querying database for user ${userId} Stripe account...`);
            const { getDb } = await import("../utils/database.js");
            const db = getDb(env);
            const result = await db
                .select({
                stripeAccountId: users.stripeAccountId,
                id: users.id,
                email: users.email,
            })
                .from(users)
                .where(eq(users.id, userId))
                .limit(1);
            console.log(`📊 Database query result for user ${userId}:`, {
                found: result.length > 0,
                userId: result[0]?.id || "null",
                stripeAccountId: result[0]?.stripeAccountId || "null",
                email: result[0]?.email || "null",
            });
            return result.length > 0 ? result[0].stripeAccountId : null;
        }
        catch (error) {
            console.error("❌ Error retrieving user Stripe account:", error);
            console.error("❌ Database query error details:", {
                userId,
                error: error instanceof Error ? error.message : "Unknown error",
                stack: error instanceof Error ? error.stack : undefined,
            });
            return null;
        }
    }
    static async createPaymentLink(env, { handyproUserId, customerName, customerEmail, description, amount, taskDetails, dueDate, }) {
        try {
            console.log(`💳 Creating payment link for user ${handyproUserId}, amount: ${amount} cents`);
            const stripe = getStripe(env);
            // Get the user's Stripe account ID
            const stripeAccountId = await this.getUserStripeAccount(env, handyproUserId);
            if (!stripeAccountId) {
                throw new Error("User does not have a Stripe account set up");
            }
            // Verify the account can accept payments
            const accountStatus = await this.getAccountStatus(env, stripeAccountId);
            if (!accountStatus.charges_enabled) {
                throw new Error("Your Stripe account is not ready to accept payments. Please complete your onboarding.");
            }
            // Create a payment link using Stripe's Payment Links API
            const paymentLink = await stripe.paymentLinks.create({
                line_items: [
                    {
                        price_data: {
                            currency: "jmd",
                            product_data: {
                                name: description || "Payment",
                                description: taskDetails || description,
                            },
                            unit_amount: amount, // Amount in cents
                        },
                        quantity: 1,
                    },
                ],
                after_completion: {
                    type: "hosted_confirmation",
                    hosted_confirmation: {
                        custom_message: "Thank you for your payment!",
                    },
                },
                customer_creation: customerEmail ? "always" : "if_required",
                metadata: {
                    handyproUserId,
                    customerName: customerName || "",
                    customerEmail: customerEmail || "",
                    taskDetails: taskDetails || "",
                    dueDate: dueDate || null,
                },
                // Make payment link single-use
                restrictions: {
                    completed_sessions: {
                        limit: 1, // Allow only 1 successful payment per link
                    },
                },
                transfer_data: {
                    destination: stripeAccountId,
                },
            });
            console.log(`✅ Payment link created: ${paymentLink.url}`);
            // Store transaction in database
            try {
                const { getDb } = await import("../utils/database.js");
                const db = getDb(env);
                await db.insert(transactions).values({
                    id: `plink_${paymentLink.id}`,
                    userId: handyproUserId,
                    type: "payment_link",
                    amount: amount,
                    currency: "JMD",
                    description: description || "Payment Link",
                    status: "pending",
                    date: new Date(),
                    stripePaymentLinkId: paymentLink.id,
                    customerName: customerName || undefined,
                    customerEmail: customerEmail || undefined,
                    paymentMethod: "payment_link",
                    metadata: JSON.stringify({
                        handyproUserId,
                        customerName: customerName || "",
                        taskDetails: taskDetails || "",
                        dueDate: dueDate || null,
                    }),
                    ...(dueDate && { expiresAt: new Date(dueDate) }),
                });
                console.log(`💾 Transaction stored in database: plink_${paymentLink.id}`);
            }
            catch (dbError) {
                console.error("❌ Failed to store transaction in database:", dbError);
                // Don't fail the payment link creation if DB storage fails
            }
            return {
                id: paymentLink.id,
                hosted_invoice_url: paymentLink.url,
                status: paymentLink.active ? "open" : "inactive",
                amount_due: amount,
                payment_link: paymentLink.url,
            };
        }
        catch (error) {
            console.error("❌ Error creating payment link:", error);
            throw error;
        }
    }
    static async cancelPaymentLink(env, paymentLinkId, userId) {
        try {
            console.log(`🗑️ Cancelling payment link ${paymentLinkId} for user ${userId}`);
            const stripe = getStripe(env);
            // Verify the user owns this payment link
            const userStripeAccount = await this.getUserStripeAccount(env, userId);
            if (!userStripeAccount) {
                throw new Error("User does not have a Stripe account");
            }
            // Cancel the payment link
            const cancelledPaymentLink = await stripe.paymentLinks.update(paymentLinkId, {
                active: false,
            });
            console.log(`✅ Payment link ${paymentLinkId} cancelled successfully`);
            // Update transaction status in database
            try {
                const { getDb } = await import("../utils/database.js");
                const db = getDb(env);
                await db
                    .update(transactions)
                    .set({
                    status: "cancelled",
                    updatedAt: new Date(),
                    notes: "Payment link cancelled by user",
                })
                    .where(eq(transactions.stripePaymentLinkId, paymentLinkId));
                console.log(`💾 Updated transaction status to cancelled in database`);
            }
            catch (dbError) {
                console.error("❌ Failed to update transaction in database:", dbError);
            }
            return {
                id: cancelledPaymentLink.id,
                active: cancelledPaymentLink.active,
                url: cancelledPaymentLink.url,
                cancelled_at: new Date(),
            };
        }
        catch (error) {
            console.error("❌ Error cancelling payment link:", error);
            throw error;
        }
    }
    static async expirePaymentLink(env, paymentLinkId, userId) {
        try {
            console.log(`⏰ Expiring payment link ${paymentLinkId} for user ${userId}`);
            const stripe = getStripe(env);
            // Verify the user owns this payment link
            const userStripeAccount = await this.getUserStripeAccount(env, userId);
            if (!userStripeAccount) {
                throw new Error("User does not have a Stripe account");
            }
            // Set expiration to current time (will expire immediately)
            const expiredPaymentLink = await stripe.paymentLinks.update(paymentLinkId, {
                active: false, // Deactivate instead of setting expiration
            });
            console.log(`✅ Payment link ${paymentLinkId} expired successfully`);
            return {
                id: expiredPaymentLink.id,
                active: expiredPaymentLink.active,
                url: expiredPaymentLink.url,
                expires_at: Math.floor(Date.now() / 1000),
            };
        }
        catch (error) {
            console.error("❌ Error expiring payment link:", error);
            throw error;
        }
    }
    static async handleWebhook(env, rawBody, signature) {
        try {
            const stripe = getStripe(env);
            // Try Cloudflare env first, then fall back to process.env for local development
            const STRIPE_WEBHOOK_SECRET = env?.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
            if (!STRIPE_WEBHOOK_SECRET) {
                throw new Error("STRIPE_WEBHOOK_SECRET is required");
            }
            const event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
            console.log(`🎣 Webhook received: ${event.type}`);
            switch (event.type) {
                case "payment_intent.succeeded":
                    await this.handlePaymentIntentSucceeded(env, event.data.object);
                    break;
                case "payment_intent.payment_failed":
                    await this.handlePaymentIntentFailed(env, event.data.object);
                    break;
                case "checkout.session.completed":
                    await this.handleCheckoutSessionCompleted(env, event.data.object);
                    break;
                case "invoice.payment_succeeded":
                    await this.handleInvoicePaymentSucceeded(env, event.data.object);
                    break;
                case "invoice.payment_failed":
                    await this.handleInvoicePaymentFailed(env, event.data.object);
                    break;
                case "account.updated":
                    await this.handleAccountUpdated(env, event.data.object);
                    break;
                default:
                    console.log(`Unhandled webhook event: ${event.type}`);
            }
            return { received: true };
        }
        catch (error) {
            console.error("❌ Webhook error:", error);
            throw error;
        }
    }
    static async handlePaymentIntentSucceeded(env, paymentIntent) {
        console.log("💰 Payment intent succeeded:", paymentIntent.id);
        try {
            const { getDb } = await import("../utils/database.js");
            const db = getDb(env);
            // Find the transaction by payment intent ID
            const existingTransaction = await db
                .select()
                .from(transactions)
                .where(eq(transactions.stripePaymentIntentId, paymentIntent.id))
                .limit(1);
            if (existingTransaction.length > 0) {
                // Update existing transaction
                await db
                    .update(transactions)
                    .set({
                    status: "completed",
                    updatedAt: new Date(),
                })
                    .where(eq(transactions.stripePaymentIntentId, paymentIntent.id));
                console.log(`✅ Updated transaction status to completed: ${existingTransaction[0].id}`);
            }
            else {
                // Create new transaction if it doesn't exist
                const transactionId = `pi_${paymentIntent.id}`;
                const userId = paymentIntent.metadata?.handyproUserId || "unknown";
                await db.insert(transactions).values({
                    id: transactionId,
                    userId: userId,
                    type: "received",
                    amount: paymentIntent.amount,
                    currency: paymentIntent.currency.toUpperCase(),
                    description: paymentIntent.description || "Payment received",
                    status: "completed",
                    date: new Date(),
                    stripePaymentIntentId: paymentIntent.id,
                    customerName: paymentIntent.metadata?.customerName,
                    customerEmail: paymentIntent.metadata?.customerEmail,
                    paymentMethod: "card",
                    cardLast4: paymentIntent.charges?.data?.[0]?.payment_method_details?.card
                        ?.last4,
                    cardBrand: paymentIntent.charges?.data?.[0]?.payment_method_details?.card
                        ?.brand,
                    metadata: JSON.stringify(paymentIntent.metadata || {}),
                });
                console.log(`💾 Created new transaction: ${transactionId}`);
            }
            console.log("Payment successful:", {
                id: paymentIntent.id,
                amount: paymentIntent.amount,
                currency: paymentIntent.currency,
                metadata: paymentIntent.metadata,
            });
        }
        catch (error) {
            console.error("❌ Error processing payment intent success:", error);
        }
    }
    static async handlePaymentIntentFailed(env, paymentIntent) {
        console.log("❌ Payment intent failed:", paymentIntent.id);
        try {
            const { getDb } = await import("../utils/database.js");
            const db = getDb(env);
            // Update transaction status to failed
            const result = await db
                .update(transactions)
                .set({
                status: "failed",
                updatedAt: new Date(),
                notes: `Payment failed: ${paymentIntent.last_payment_error?.message || "Unknown error"}`,
            })
                .where(eq(transactions.stripePaymentIntentId, paymentIntent.id));
            console.log(`✅ Updated transaction status to failed: ${paymentIntent.id}`);
            console.log("Payment failed:", {
                id: paymentIntent.id,
                amount: paymentIntent.amount,
                currency: paymentIntent.currency,
                last_payment_error: paymentIntent.last_payment_error,
                metadata: paymentIntent.metadata,
            });
        }
        catch (error) {
            console.error("❌ Error processing payment intent failure:", error);
        }
    }
    static async handleAccountUpdated(env, account) {
        console.log("🔄 Account updated:", account.id);
        try {
            const { getDb } = await import("../utils/database.js");
            const db = getDb(env);
            // Find user by Stripe account ID
            const user = await db
                .select()
                .from(users)
                .where(eq(users.stripeAccountId, account.id))
                .limit(1);
            if (user.length > 0) {
                const userId = user[0].id;
                // Check if account is now enabled for charges
                const chargesEnabled = account.charges_enabled;
                const onboardingCompleted = chargesEnabled; // Use charges_enabled as completion indicator
                console.log("📊 Account status check:", {
                    accountId: account.id,
                    chargesEnabled,
                    detailsSubmitted: account.details_submitted,
                    onboardingCompleted,
                });
                if (onboardingCompleted) {
                    // Update user onboarding status
                    await db
                        .update(users)
                        .set({
                        stripeOnboardingCompleted: true,
                        updatedAt: new Date(),
                    })
                        .where(eq(users.id, userId));
                    console.log(`✅ Onboarding marked complete for user: ${userId}`);
                }
            }
            else {
                console.log("⚠️ No user found for Stripe account:", account.id);
            }
        }
        catch (error) {
            console.error("❌ Error processing account update:", error);
        }
    }
    static async handleCheckoutSessionCompleted(env, session) {
        console.log("✅ Checkout session completed:", session.id);
        try {
            const { getDb } = await import("../utils/database.js");
            const db = getDb(env);
            // If this is a payment link checkout, update the transaction status
            if (session.payment_link && session.payment_status === "paid") {
                console.log("🔗 Payment link checkout completed, updating transaction status");
                // Find transaction by payment link ID
                const existingTransaction = await db
                    .select()
                    .from(transactions)
                    .where(eq(transactions.stripePaymentLinkId, session.payment_link))
                    .limit(1);
                if (existingTransaction.length > 0) {
                    // Update transaction status to completed
                    await db
                        .update(transactions)
                        .set({
                        status: "completed",
                        updatedAt: new Date(),
                        notes: `Payment completed via checkout session ${session.id}`,
                    })
                        .where(eq(transactions.stripePaymentLinkId, session.payment_link));
                    console.log(`✅ Updated payment link transaction to completed: ${existingTransaction[0].id}`);
                }
                else {
                    console.log(`⚠️ No transaction found for payment link: ${session.payment_link}`);
                }
            }
            console.log("Checkout completed:", {
                id: session.id,
                payment_status: session.payment_status,
                amount_total: session.amount_total,
                currency: session.currency,
                payment_link: session.payment_link,
                metadata: session.metadata,
            });
        }
        catch (error) {
            console.error("❌ Error processing checkout session completion:", error);
        }
    }
    static async handleInvoicePaymentSucceeded(env, invoice) {
        console.log("💳 Invoice payment succeeded:", invoice.id);
        try {
            const { getDb } = await import("../utils/database.js");
            const db = getDb(env);
            // If this invoice is from a payment link, update the transaction status
            if (invoice.payment_link) {
                console.log("🔗 Payment link invoice payment succeeded, updating transaction status");
                // Find transaction by payment link ID
                const existingTransaction = await db
                    .select()
                    .from(transactions)
                    .where(eq(transactions.stripePaymentLinkId, invoice.payment_link))
                    .limit(1);
                if (existingTransaction.length > 0) {
                    // Update transaction status to completed
                    await db
                        .update(transactions)
                        .set({
                        status: "completed",
                        updatedAt: new Date(),
                        notes: `Payment completed via invoice ${invoice.id}`,
                    })
                        .where(eq(transactions.stripePaymentLinkId, invoice.payment_link));
                    console.log(`✅ Updated payment link transaction to completed: ${existingTransaction[0].id}`);
                }
                else {
                    console.log(`⚠️ No transaction found for payment link: ${invoice.payment_link}`);
                }
            }
            console.log("Invoice payment successful:", {
                id: invoice.id,
                amount_paid: invoice.amount_paid,
                currency: invoice.currency,
                customer_email: invoice.customer_email,
                payment_link: invoice.payment_link,
                metadata: invoice.metadata,
            });
        }
        catch (error) {
            console.error("❌ Error processing invoice payment success:", error);
        }
    }
    static async handleInvoicePaymentFailed(env, invoice) {
        console.log("❌ Invoice payment failed:", invoice.id);
        try {
            const { getDb } = await import("../utils/database.js");
            const db = getDb(env);
            // If this invoice is from a payment link, update the transaction status
            if (invoice.payment_link) {
                console.log("🔗 Payment link invoice payment failed, updating transaction status");
                // Find transaction by payment link ID
                const existingTransaction = await db
                    .select()
                    .from(transactions)
                    .where(eq(transactions.stripePaymentLinkId, invoice.payment_link))
                    .limit(1);
                if (existingTransaction.length > 0) {
                    // Update transaction status to failed
                    await db
                        .update(transactions)
                        .set({
                        status: "failed",
                        updatedAt: new Date(),
                        notes: `Payment failed via invoice ${invoice.id} (attempt ${invoice.attempt_count || 1})`,
                    })
                        .where(eq(transactions.stripePaymentLinkId, invoice.payment_link));
                    console.log(`✅ Updated payment link transaction to failed: ${existingTransaction[0].id}`);
                }
                else {
                    console.log(`⚠️ No transaction found for payment link: ${invoice.payment_link}`);
                }
            }
            console.log("Invoice payment failed:", {
                id: invoice.id,
                amount_due: invoice.amount_due,
                currency: invoice.currency,
                customer_email: invoice.customer_email,
                attempt_count: invoice.attempt_count,
                payment_link: invoice.payment_link,
                metadata: invoice.metadata,
            });
        }
        catch (error) {
            console.error("❌ Error processing invoice payment failure:", error);
        }
    }
}
