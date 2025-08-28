import Stripe from "stripe";
import { db } from "./db.js";
import { users } from "./schema.js";
import { eq } from "drizzle-orm";
const stripe = new Stripe(process.env.STRIPE_TEST_SECRET_KEY, {
    apiVersion: "2025-08-27.basil",
});
export class StripeService {
    static async createAccountLink({ userId, account_id, firstName, lastName, email, refresh_url, return_url, }) {
        if (!process.env.STRIPE_TEST_SECRET_KEY) {
            throw new Error("STRIPE_TEST_SECRET_KEY is not configured");
        }
        try {
            console.log("Creating Stripe account link for user:", userId);
            // Try to use supplied account_id, else fall back to database value
            let accountId = account_id;
            if (!accountId) {
                try {
                    const existing = await db
                        .select({ stripeAccountId: users.stripeAccountId })
                        .from(users)
                        .where(eq(users.id, userId))
                        .limit(1);
                    if (existing.length && existing[0].stripeAccountId) {
                        accountId = existing[0].stripeAccountId;
                    }
                }
                catch (err) {
                    console.error("DB lookup error for stripeAccountId:", err);
                }
            }
            let account;
            if (accountId) {
                // Update existing account details (or just retrieve if no changes required)
                account = await stripe.accounts.update(accountId, {
                    email,
                    business_profile: {
                        name: `${firstName} ${lastName}`.trim() || "HandyPay Merchant",
                        support_email: email,
                    },
                    metadata: { userId },
                });
            }
            else {
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
                // Save newly created accountId for later use
                accountId = account.id;
            }
            // Persist the Stripe account ID in the database
            if (accountId) {
                try {
                    await db
                        .update(users)
                        .set({ stripeAccountId: accountId, updatedAt: new Date() })
                        .where(eq(users.id, userId));
                }
                catch (err) {
                    console.error("Error saving stripeAccountId to DB:", err);
                }
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
    static async getAccountStatus(accountId) {
        try {
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
    static async getUserStripeAccount(userId) {
        try {
            const result = await db
                .select({ stripeAccountId: users.stripeAccountId })
                .from(users)
                .where(eq(users.id, userId))
                .limit(1);
            return result.length > 0 ? result[0].stripeAccountId : null;
        }
        catch (error) {
            console.error("Error retrieving user Stripe account:", error);
            return null;
        }
    }
}
