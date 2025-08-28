import Stripe from "stripe";
import { db } from "./db.js";
import { users } from "./schema.js";
import { eq } from "drizzle-orm";

const stripe = new Stripe(process.env.STRIPE_TEST_SECRET_KEY as string, {
  apiVersion: "2025-08-27.basil",
});

export interface StripeAccountData {
  userId: string;
  account_id?: string;
  firstName: string;
  lastName: string;
  email: string;
  refresh_url: string;
  return_url: string;
}

export class StripeService {
  static async createAccountLink({
    userId,
    account_id,
    firstName,
    lastName,
    email,
    refresh_url,
    return_url,
  }: StripeAccountData) {
    if (!process.env.STRIPE_TEST_SECRET_KEY) {
      throw new Error("STRIPE_TEST_SECRET_KEY is not configured");
    }

    try {
      console.log("Creating Stripe account link for user:", userId);

      let accountId: string | undefined = account_id;
      let account;

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
      } else {
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
      if (accountId) {
        try {
          // First check if user exists
          const existingUser = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

          if (existingUser.length > 0) {
            await db
              .update(users)
              .set({
                stripeAccountId: accountId,
                updatedAt: new Date(),
              })
              .where(eq(users.id, userId));

            console.log(`✅ Saved Stripe account ID ${accountId} for existing user ${userId}`);
          } else {
            console.log(`⚠️ User ${userId} not found in database, skipping DB update`);
          }
        } catch (err) {
          console.error("Error saving stripeAccountId to DB:", err);
          console.log("Continuing with account creation despite DB error...");
        }
      }

      // Create account link for onboarding
      const accountLink = await stripe.accountLinks.create({
        account: accountId!,
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
    } catch (error) {
      console.error("Error creating Stripe account link:", error);
      if (error instanceof Stripe.errors.StripeError) {
        throw new Error(`Stripe Error: ${error.message}`);
      }
      throw new Error("Failed to create Stripe account link");
    }
  }

  static async getAccountStatus(accountId: string) {
    try {
      const account = await stripe.accounts.retrieve(accountId);
      return {
        id: account.id,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        details_submitted: account.details_submitted,
        requirements: account.requirements,
      };
    } catch (error) {
      console.error("Error retrieving account status:", error);
      throw new Error("Failed to retrieve account status");
    }
  }

  static async getUserStripeAccount(userId: string) {
    try {
      const result = await db
        .select({ stripeAccountId: users.stripeAccountId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      return result.length > 0 ? result[0].stripeAccountId : null;
    } catch (error) {
      console.error("Error retrieving user Stripe account:", error);
      return null;
    }
  }
}
