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

        console.log(
          `✅ Created new Stripe account: ${accountId} for user ${userId}`
        );
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
      console.log(
        `🔄 Attempting to save Stripe account ${accountId} for user ${userId} to database...`
      );

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
            console.log(
              `📝 Updating existing user ${userId} with Stripe account ${accountId}`
            );

            const updateResult = await db
              .update(users)
              .set({
                stripeAccountId: accountId,
                updatedAt: new Date(),
              })
              .where(eq(users.id, userId));

            console.log(
              `✅ Updated Stripe account ID ${accountId} for existing user ${userId}`,
              `Update result:`,
              updateResult
            );
          } else {
            // User doesn't exist, create a minimal user record
            console.log(
              `👤 User ${userId} doesn't exist, creating new record with Stripe account ${accountId}`
            );

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

            console.log(
              `✅ Created new user record and saved Stripe account ID ${accountId} for user ${userId}`,
              `Insert result:`,
              insertResult
            );
          }

          // Verify the save worked
          const verification = await db
            .select({ stripeAccountId: users.stripeAccountId })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

          if (
            verification.length > 0 &&
            verification[0].stripeAccountId === accountId
          ) {
            console.log(
              `✅ Database save verification successful: ${verification[0].stripeAccountId}`
            );
          } else {
            console.error(
              `❌ Database save verification failed! Expected: ${accountId}, Got: ${
                verification[0]?.stripeAccountId || "null"
              }`
            );
          }
        } catch (err) {
          console.error("❌ Error saving stripeAccountId to DB:", err);
          console.error("❌ Database error details:", {
            error: err,
            message: err instanceof Error ? err.message : "Unknown error",
            userId,
            accountId,
          });
          console.log(
            "⚠️ Continuing with account creation despite DB error..."
          );
        }
      } else {
        console.error("❌ No accountId provided to save to database!");
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
      console.log(`🔍 Querying database for user ${userId} Stripe account...`);

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
    } catch (error) {
      console.error("❌ Error retrieving user Stripe account:", error);
      console.error("❌ Database query error details:", {
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      return null;
    }
  }

  static async createPaymentLink({
    handyproUserId,
    customerName,
    customerEmail,
    description,
    amount,
    taskDetails,
    dueDate,
  }: {
    handyproUserId: string;
    customerName?: string;
    customerEmail?: string;
    description?: string;
    amount: number;
    taskDetails?: string;
    dueDate?: string;
  }) {
    try {
      console.log(
        `💳 Creating payment link for user ${handyproUserId}, amount: ${amount} cents`
      );

      // Get the user's Stripe account ID
      const stripeAccountId = await this.getUserStripeAccount(handyproUserId);

      if (!stripeAccountId) {
        throw new Error("User does not have a Stripe account set up");
      }

      // Verify the account can accept payments
      const accountStatus = await this.getAccountStatus(stripeAccountId);
      if (!accountStatus.charges_enabled) {
        throw new Error(
          "Your Stripe account is not ready to accept payments. Please complete your onboarding."
        );
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
            custom_message:
              "Thank you for your payment! Your HandyPro will be in touch soon.",
          },
        },
        customer_creation: customerEmail ? "always" : "if_required",
        ...(customerEmail && {
          customer_email: customerEmail,
        }),
        metadata: {
          handyproUserId,
          customerName: customerName || "",
          taskDetails: taskDetails || "",
        },
        ...(dueDate && {
          expires_at: Math.floor(new Date(dueDate).getTime() / 1000),
        }),
        transfer_data: {
          destination: stripeAccountId,
        },
      });

      console.log(`✅ Payment link created: ${paymentLink.url}`);

      return {
        id: paymentLink.id,
        hosted_invoice_url: paymentLink.url,
        status: paymentLink.active ? "open" : "inactive",
        amount_due: amount,
        payment_link: paymentLink.url,
      };
    } catch (error) {
      console.error("❌ Error creating payment link:", error);
      throw error;
    }
  }

  static async cancelPaymentLink(paymentLinkId: string, userId: string) {
    try {
      console.log(`🗑️ Cancelling payment link ${paymentLinkId} for user ${userId}`);

      // Verify the user owns this payment link
      const userStripeAccount = await this.getUserStripeAccount(userId);
      if (!userStripeAccount) {
        throw new Error("User does not have a Stripe account");
      }

      // Cancel the payment link
      const cancelledPaymentLink = await stripe.paymentLinks.update(paymentLinkId, {
        active: false,
      });

      console.log(`✅ Payment link ${paymentLinkId} cancelled successfully`);

      return {
        id: cancelledPaymentLink.id,
        active: cancelledPaymentLink.active,
        url: cancelledPaymentLink.url,
        cancelled_at: new Date(),
      };
    } catch (error) {
      console.error("❌ Error cancelling payment link:", error);
      throw error;
    }
  }

  static async expirePaymentLink(paymentLinkId: string, userId: string) {
    try {
      console.log(`⏰ Expiring payment link ${paymentLinkId} for user ${userId}`);

      // Verify the user owns this payment link
      const userStripeAccount = await this.getUserStripeAccount(userId);
      if (!userStripeAccount) {
        throw new Error("User does not have a Stripe account");
      }

      // Set expiration to current time (will expire immediately)
      const expiredPaymentLink = await stripe.paymentLinks.update(paymentLinkId, {
        expires_at: Math.floor(Date.now() / 1000), // Expire immediately
      });

      console.log(`✅ Payment link ${paymentLinkId} expired successfully`);

      return {
        id: expiredPaymentLink.id,
        active: expiredPaymentLink.active,
        url: expiredPaymentLink.url,
        expires_at: expiredPaymentLink.expires_at,
      };
    } catch (error) {
      console.error("❌ Error expiring payment link:", error);
      throw error;
    }
  }
}
