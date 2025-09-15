import Stripe from "stripe";
import { users, transactions } from "../schema.js";
import { eq } from "drizzle-orm";
import {
  sendPaymentReceivedNotification,
  sendWelcomeNotification,
} from "./push-notifications.js";

// Stripe instance will be created with environment variables
let stripe: Stripe;

export function getStripe(env: any): Stripe {
  if (!stripe) {
    // Try Cloudflare env first, then fall back to process.env for local development
    const STRIPE_TEST_SECRET_KEY =
      env?.STRIPE_TEST_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY;
    if (!STRIPE_TEST_SECRET_KEY) {
      throw new Error("STRIPE_TEST_SECRET_KEY is required");
    }
    stripe = new Stripe(STRIPE_TEST_SECRET_KEY, {
      apiVersion: "2025-08-27.basil",
    });
  }
  return stripe;
}

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
  static async createAccountLink(
    env: any,
    {
      userId,
      account_id,
      firstName,
      lastName,
      email,
      refresh_url,
      return_url,
    }: StripeAccountData
  ) {
    try {
      console.log("Creating Stripe account link for user:", userId);
      console.log("Input parameters:", {
        userId,
        account_id,
        firstName,
        lastName,
        email,
      });

      const stripe = getStripe(env);
      const { getDb } = await import("../utils/database.js");
      const db = getDb(env);

      let accountId: string | undefined = account_id;
      let account;

      console.log("Initial accountId from input:", accountId);

      // Always create new account if no account_id provided
      // This ensures we always have an account to work with
      if (!accountId) {
        console.log("Creating new Stripe account for user:", userId);

        // Create new account for Jamaica (JM) with JMD currency
        const accountData: any = {
          type: "custom",
          country: "JM",
          business_type: "individual",
          metadata: { userId },
          capabilities: {
            transfers: { requested: true },
          },
          tos_acceptance: {
            service_agreement: "recipient",
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
        };

        // Only add email and individual info if we have valid email
        if (email && email.trim() !== "") {
          accountData.email = email;
          accountData.individual = {
            first_name: firstName,
            last_name: lastName,
            email,
          };
        } else {
          console.log(
            "⚠️ Creating account without email - will be added later"
          );
        }

        account = await stripe.accounts.create(accountData);
        accountId = account.id;

        console.log(
          `✅ Created new Stripe account: ${accountId} for user ${userId}`
        );
        console.log("Account creation details:", {
          accountId,
          email: account.email,
          country: account.country,
          type: account.type,
        });
      } else {
        console.log("Using existing Stripe account:", accountId);

        // Update existing account details (only if we have valid data)
        const updateData: any = {
          metadata: { userId },
        };

        // Only update email if it's valid and not empty
        if (email && email.trim() !== "") {
          updateData.email = email;
          updateData.business_profile = {
            name: `${firstName} ${lastName}`.trim() || "HandyPay Merchant",
            support_email: email,
          };
        } else {
          console.log("⚠️ Skipping email update - no valid email provided");
          updateData.business_profile = {
            name: `${firstName} ${lastName}`.trim() || "HandyPay Merchant",
          };
        }

        account = await stripe.accounts.update(accountId, updateData);
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

      // Check account status before creating link
      console.log("Checking account status before creating link...");
      const accountStatus = await stripe.accounts.retrieve(accountId!);
      console.log("Account status before link creation:", {
        id: accountStatus.id,
        charges_enabled: accountStatus.charges_enabled,
        details_submitted: accountStatus.details_submitted,
        requirements: accountStatus.requirements,
      });

      // If account is already complete, don't create a new onboarding link
      if (accountStatus.details_submitted && accountStatus.charges_enabled) {
        console.log(
          "Account is already complete, creating account link for dashboard instead"
        );

        // Validate URLs for account_update as well
        const defaultRefreshUrl =
          "https://handypay-backend.handypay.workers.dev/api/stripe/refresh";
        const defaultReturnUrl =
          "https://handypay-backend.handypay.workers.dev/api/stripe/return";

        let validRefreshUrl = refresh_url;
        let validReturnUrl = return_url;

        try {
          if (!refresh_url || !refresh_url.startsWith("http")) {
            console.log(
              "⚠️ Invalid or missing refresh_url for update, using default"
            );
            validRefreshUrl = defaultRefreshUrl;
          }
          if (!return_url || !return_url.startsWith("http")) {
            console.log(
              "⚠️ Invalid or missing return_url for update, using default"
            );
            validReturnUrl = defaultReturnUrl;
          }

          new URL(validRefreshUrl);
          new URL(validReturnUrl);
        } catch (urlError) {
          console.error("❌ URL validation failed for update:", urlError);
          console.log("🔄 Using default URLs for update as fallback");
          validRefreshUrl = defaultRefreshUrl;
          validReturnUrl = defaultReturnUrl;
        }

        const accountLink = await stripe.accountLinks.create({
          account: accountId!,
          refresh_url: validRefreshUrl,
          return_url: validReturnUrl,
          type: "account_update", // Use account_update instead of onboarding
          collect: "eventually_due",
        });
        console.log(
          "Stripe account update link created successfully:",
          accountLink.url
        );
        return {
          url: accountLink.url,
          accountId: accountId,
        };
      }

      // Validate and set default URLs if not provided or invalid
      const defaultRefreshUrl =
        "https://handypay-backend.handypay.workers.dev/api/stripe/refresh";
      const defaultReturnUrl =
        "https://handypay-backend.handypay.workers.dev/api/stripe/return";

      // Validate URLs - Stripe requires valid HTTPS URLs
      let validRefreshUrl = refresh_url;
      let validReturnUrl = return_url;

      try {
        if (!refresh_url || !refresh_url.startsWith("http")) {
          console.log("⚠️ Invalid or missing refresh_url, using default");
          validRefreshUrl = defaultRefreshUrl;
        }
        if (!return_url || !return_url.startsWith("http")) {
          console.log("⚠️ Invalid or missing return_url, using default");
          validReturnUrl = defaultReturnUrl;
        }

        // Test URL validity
        new URL(validRefreshUrl);
        new URL(validReturnUrl);
      } catch (urlError) {
        console.error("❌ URL validation failed:", urlError);
        console.log("🔄 Using default URLs as fallback");
        validRefreshUrl = defaultRefreshUrl;
        validReturnUrl = defaultReturnUrl;
      }

      // Create account link for onboarding
      console.log("Creating account onboarding link with parameters:", {
        account: accountId,
        refresh_url: validRefreshUrl,
        return_url: validReturnUrl,
        type: "account_onboarding",
        collect: "eventually_due",
      });

      const accountLink = await stripe.accountLinks.create({
        account: accountId!,
        refresh_url: validRefreshUrl,
        return_url: validReturnUrl,
        type: "account_onboarding",
        collect: "eventually_due",
      });

      console.log("Stripe account link created successfully:", accountLink.url);
      console.log("Returning account data:", {
        url: accountLink.url,
        accountId: accountId,
      });

      return {
        url: accountLink.url,
        accountId: accountId,
      };
    } catch (error) {
      console.error("Error creating Stripe account link:", error);
      console.error("Account ID that failed:", account_id || "unknown");
      console.error("Full error details:", JSON.stringify(error, null, 2));

      if (error instanceof Stripe.errors.StripeError) {
        console.error("Stripe error type:", error.type);
        console.error("Stripe error code:", error.code);
        throw new Error(`Stripe Error (${error.code}): ${error.message}`);
      }

      throw new Error("Failed to create Stripe account link");
    }
  }

  static async getAccountStatus(env: any, accountId: string) {
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
    } catch (error) {
      console.error("Error retrieving account status:", error);
      throw new Error("Failed to retrieve account status");
    }
  }

  static async getUserStripeAccount(env: any, userId: string) {
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

  static async transferExistingFundsToConnectedAccount(
    env: any,
    userId: string
  ) {
    try {
      console.log(
        `💸 Transferring existing platform funds to connected account for user: ${userId}`
      );

      const stripe = getStripe(env);

      // Get the user's Stripe account ID
      const stripeAccountId = await this.getUserStripeAccount(env, userId);
      if (!stripeAccountId) {
        throw new Error("User does not have a Stripe account set up");
      }

      // Get platform balance
      const platformBalance = await stripe.balance.retrieve();
      const availableBalance = platformBalance.available.find(
        (balance: any) => balance.currency === "jmd"
      );

      if (!availableBalance || availableBalance.amount <= 0) {
        console.log("No platform funds available to transfer");
        return { success: false, message: "No platform funds available" };
      }

      // Create a transfer from platform to connected account
      const transfer = await stripe.transfers.create({
        amount: availableBalance.amount,
        currency: "jmd",
        destination: stripeAccountId,
        description: "Transfer existing platform funds to connected account",
      });

      console.log(
        `✅ Transfer created: ${transfer.id}, amount: ${availableBalance.amount} cents`
      );

      return {
        success: true,
        transferId: transfer.id,
        amount: availableBalance.amount,
        currency: "jmd",
      };
    } catch (error) {
      console.error("❌ Error transferring existing funds:", error);
      throw error;
    }
  }

  static async createPaymentLink(
    env: any,
    {
      handyproUserId,
      customerName,
      customerEmail,
      description,
      amount,
      taskDetails,
      dueDate,
      currency = "USD",
      paymentSource = "payment_link_modal",
    }: {
      handyproUserId: string;
      customerName?: string;
      customerEmail?: string;
      description?: string;
      amount: number;
      taskDetails?: string;
      dueDate?: string;
      currency?: string;
      paymentSource?: string;
    }
  ) {
    try {
      console.log(
        `💳 Creating payment link for user ${handyproUserId}, amount: ${amount} cents, currency: ${currency}`
      );

      const stripe = getStripe(env);

      // Get the user's Stripe account ID (connected account)
      const stripeAccountId = await this.getUserStripeAccount(
        env,
        handyproUserId
      );

      if (!stripeAccountId) {
        throw new Error("User does not have a Stripe account set up");
      }

      console.log(`🔗 Connected account ID: ${stripeAccountId}`);

      // Verify the connected account can accept payments
      const accountStatus = await this.getAccountStatus(env, stripeAccountId);
      if (!accountStatus.charges_enabled) {
        throw new Error(
          "Your Stripe account is not ready to accept payments. Please complete your onboarding."
        );
      }

      console.log(`✅ Connected account is ready for payments`);

      // Get user's name for custom messaging
      let userName = "the recipient";
      try {
        const { getDb } = await import("../utils/database.js");
        const db = getDb(env);
        const userResult = await db
          .select({
            fullName: users.fullName,
            firstName: users.firstName,
            lastName: users.lastName,
          })
          .from(users)
          .where(eq(users.id, handyproUserId))
          .limit(1);

        if (userResult.length > 0) {
          const user = userResult[0];
          userName =
            user.fullName ||
            `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
            "the recipient";
        }
      } catch (error) {
        console.warn("⚠️ Could not fetch user name for custom message:", error);
      }

      // Set payment method types based on currency
      const currencyLower = currency.toLowerCase();
      let paymentMethodTypes;

      if (currencyLower === "jmd") {
        // For JMD, use more limited payment methods that work internationally
        paymentMethodTypes = ["card" as const];
      } else {
        // For USD and other currencies, use full range of payment methods
        paymentMethodTypes = [
          "card" as const,
          "cashapp" as const,
          "us_bank_account" as const,
          "link" as const,
        ];
      }

      console.log(
        `💳 Using payment methods for ${currency}: ${paymentMethodTypes.join(
          ", "
        )}`
      );

      // Create a payment link with dynamic currency
      const paymentLink = await stripe.paymentLinks.create({
        line_items: [
          {
            price_data: {
              currency: currencyLower, // Use dynamic currency
              product_data: {
                name: description || "Payment",
                description: taskDetails || description,
              },
              unit_amount: amount, // Amount in cents
            },
            quantity: 1,
          },
        ],
        // Set payment method types based on currency
        payment_method_types: paymentMethodTypes,
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
          connectedAccountId: stripeAccountId, // Store the connected account for reference
          paymentType: "destination_charges", // Indicate this uses destination charges
          paymentSource: paymentSource || "payment_link_modal", // Store the payment source
          originalCurrency: currency.toUpperCase(), // Store actual currency
        },
        // Set up automatic transfer to connected account (destination charges)
        transfer_data: {
          destination: stripeAccountId,
        },

        application_fee_percent: 1.9,
        custom_text: {
          terms_of_service_acceptance: {
            message: "By paying, you agree to HandyPay's Terms of Service.",
          },
          submit: {
            message: `Payment will be processed to ${userName}. You'll receive a confirmation shortly.`,
          },
        },
        // Make payment link single-use
        restrictions: {
          completed_sessions: {
            limit: 1, // Allow only 1 successful payment per link
          },
        },
        // For destination charges: funds automatically transfer to connected account
        // No on_behalf_of needed - this avoids the card_payments capability requirement
      });

      console.log(`✅ Payment link created: ${paymentLink.url}`);
      console.log(
        `💸 Using destination charges - funds will automatically transfer to: ${stripeAccountId}`
      );
      console.log(`🔗 Payment link details:`, {
        id: paymentLink.id,
        url: paymentLink.url,
        active: paymentLink.active,
        amount: amount,
        currency: currencyLower,
      });

      // Store transaction in database
      try {
        const { getDb } = await import("../utils/database.js");
        const db = getDb(env);
        const currencyAmount = amount; // Amount is already in proper currency cents
        await db.insert(transactions).values({
          id: paymentLink.id.startsWith("plink_")
            ? paymentLink.id
            : `plink_${paymentLink.id}`,
          userId: handyproUserId,
          type: "payment_link",
          amount: amount, // Store amount in the specified currency
          currency: currency.toUpperCase(),
          description: description || "Payment Link",
          status: "pending",
          date: new Date(),
          createdAt: new Date(),
          stripePaymentLinkId: paymentLink.id,
          customerName: customerName || undefined,
          customerEmail: customerEmail || undefined,
          paymentMethod:
            paymentSource === "qr_generation" ? "qr_code" : "payment_link", // Set payment method based on source
          metadata: JSON.stringify({
            handyproUserId,
            customerName: customerName || "",
            taskDetails: taskDetails || "",
            dueDate: dueDate || null,
            originalAmount: amount, // Store original amount in cents
            originalCurrency: currency.toUpperCase(),
            paymentType: "destination_charges", // Indicate this is a destination charges payment
            connectedAccountId: stripeAccountId, // Store the connected account ID
            paymentSource: paymentSource || "payment_link_modal", // Store the payment source
          }),
          ...(dueDate && { expiresAt: new Date(dueDate) }),
        });

        console.log(
          `💾 Transaction stored in database: plink_${paymentLink.id}`
        );
      } catch (dbError) {
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
    } catch (error) {
      console.error(
        "❌ Error creating Jamaican destination charges payment link:",
        error
      );
      console.error("❌ Full error details:", {
        message: error instanceof Error ? error.message : "Unknown error",
        type: error instanceof Error ? error.constructor.name : "Unknown type",
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Provide more specific error messages for Jamaican accounts
      if (error instanceof Error) {
        if (
          error.message.includes("payment method") ||
          error.message.includes("payment method types")
        ) {
          throw new Error(
            "Payment method configuration issue. Please check your Stripe account settings or contact support."
          );
        } else if (error.message.includes("destination")) {
          throw new Error(
            "Destination charges setup issue. Contact support to configure your Jamaican account properly."
          );
        } else if (error.message.includes("transfer")) {
          throw new Error(
            "Transfer configuration issue. Contact support to enable fund transfers for your account."
          );
        } else if (
          error.message.includes("capability") ||
          error.message.includes("capabilities")
        ) {
          throw new Error(
            "Account capability issue. Your Stripe account may need additional setup for destination charges."
          );
        } else if (
          error.message.includes("platform") ||
          error.message.includes("application")
        ) {
          throw new Error(
            "Platform configuration issue. The platform account needs destination charges enabled."
          );
        }
      }

      throw error;
    }
  }

  static async cancelPaymentLink(
    env: any,
    paymentLinkId: string,
    userId: string
  ) {
    try {
      console.log(
        `🗑️ Cancelling payment link ${paymentLinkId} for user ${userId}`
      );

      const stripe = getStripe(env);

      // Verify the user owns this payment link
      const userStripeAccount = await this.getUserStripeAccount(env, userId);
      if (!userStripeAccount) {
        throw new Error("User does not have a Stripe account");
      }

      // Cancel the payment link
      const cancelledPaymentLink = await stripe.paymentLinks.update(
        paymentLinkId,
        {
          active: false,
        }
      );

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
      } catch (dbError) {
        console.error("❌ Failed to update transaction in database:", dbError);
      }

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

  static async expirePaymentLink(
    env: any,
    paymentLinkId: string,
    userId: string
  ) {
    try {
      console.log(
        `⏰ Expiring payment link ${paymentLinkId} for user ${userId}`
      );

      const stripe = getStripe(env);

      // Verify the user owns this payment link
      const userStripeAccount = await this.getUserStripeAccount(env, userId);
      if (!userStripeAccount) {
        throw new Error("User does not have a Stripe account");
      }

      // Set expiration to current time (will expire immediately)
      const expiredPaymentLink = await stripe.paymentLinks.update(
        paymentLinkId,
        {
          active: false, // Deactivate instead of setting expiration
        }
      );

      console.log(`✅ Payment link ${paymentLinkId} expired successfully`);

      return {
        id: expiredPaymentLink.id,
        active: expiredPaymentLink.active,
        url: expiredPaymentLink.url,
        expires_at: Math.floor(Date.now() / 1000),
      };
    } catch (error) {
      console.error("❌ Error expiring payment link:", error);
      throw error;
    }
  }

  static async handleWebhook(env: any, rawBody: string, signature: string) {
    try {
      const stripe = getStripe(env);
      // Try Cloudflare env first, then fall back to process.env for local development
      const STRIPE_WEBHOOK_SECRET =
        env?.STRIPE_TEST_WEBHOOK_SECRET ||
        process.env.STRIPE_TEST_WEBHOOK_SECRET ||
        env?.STRIPE_WEBHOOK_SECRET ||
        process.env.STRIPE_WEBHOOK_SECRET;

      if (!STRIPE_WEBHOOK_SECRET) {
        throw new Error(
          "STRIPE_WEBHOOK_SECRET (or STRIPE_TEST_WEBHOOK_SECRET) is required"
        );
      }

      const event = await stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        STRIPE_WEBHOOK_SECRET
      );

      console.log(`🎣 Webhook received: ${event.type}`);
      console.log(`🔍 Webhook data preview:`, {
        type: event.type,
        id: (event.data.object as any).id || "no-id",
        object: event.data.object.object,
        payment_link: (event.data.object as any).payment_link || null,
        payment_intent: (event.data.object as any).payment_intent || null,
        status: (event.data.object as any).status || null,
      });

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
          console.log(`⚠️ Unhandled webhook event: ${event.type}`);
          console.log(`📄 Event details:`, {
            id: event.id,
            type: event.type,
            created: event.created,
            object: event.data.object.object,
            dataKeys: Object.keys(event.data.object).slice(0, 10), // Limit to avoid huge logs
          });
      }

      return { received: true };
    } catch (error) {
      console.error("❌ Webhook error:", error);
      throw error;
    }
  }

  private static async handlePaymentIntentSucceeded(
    env: any,
    paymentIntent: any
  ) {
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
        // Get payment method details from the payment intent
        let paymentMethodType = null;
        let cardLast4 = null;
        let cardBrand = null;

        try {
          const stripe = getStripe(env);
          const fullPaymentIntent = await stripe.paymentIntents.retrieve(
            paymentIntent.id,
            {
              expand: ["payment_method"],
            }
          );

          if (
            fullPaymentIntent.payment_method &&
            typeof fullPaymentIntent.payment_method === "object"
          ) {
            paymentMethodType = fullPaymentIntent.payment_method.type;

            // Extract card details if it's a card payment
            if (
              fullPaymentIntent.payment_method.type === "card" &&
              fullPaymentIntent.payment_method.card
            ) {
              cardLast4 = fullPaymentIntent.payment_method.card.last4;
              cardBrand = fullPaymentIntent.payment_method.card.brand;
            }
          }
        } catch (error) {
          console.warn("⚠️ Could not retrieve payment method details:", error);
        }

        // Update existing transaction
        await db
          .update(transactions)
          .set({
            status: "completed",
            completedAt: new Date(),
            stripePaymentMethodType: paymentMethodType,
            cardLast4: cardLast4,
            cardBrand: cardBrand,
            updatedAt: new Date(),
          })
          .where(eq(transactions.stripePaymentIntentId, paymentIntent.id));

        console.log(
          `✅ Updated transaction status to completed: ${existingTransaction[0].id}`
        );
      } else {
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
          cardLast4:
            paymentIntent.charges?.data?.[0]?.payment_method_details?.card
              ?.last4,
          cardBrand:
            paymentIntent.charges?.data?.[0]?.payment_method_details?.card
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

      // Send push notification to user
      try {
        const userId = paymentIntent.metadata?.handyproUserId;
        if (userId) {
          const customerName = paymentIntent.metadata?.customerName;
          const currency = paymentIntent.currency.toUpperCase();

          console.log(
            `🔔 Attempting to send push notification to user ${userId} for payment ${paymentIntent.id}:`,
            {
              amount: paymentIntent.amount,
              currency,
              customerName,
            }
          );

          const notificationResult = await sendPaymentReceivedNotification(
            userId,
            paymentIntent.amount,
            currency,
            customerName,
            env
          );

          console.log(`📋 Push notification result:`, notificationResult);

          if (notificationResult.success) {
            console.log(
              `📱 ✅ Push notification sent to user ${userId} for payment ${paymentIntent.id} (sent to ${notificationResult.sentTo} devices)`
            );
          } else {
            console.warn(
              `⚠️ ❌ Failed to send push notification for payment ${paymentIntent.id}:`,
              notificationResult.error
            );
          }
        } else {
          console.warn(
            `⚠️ No user ID in payment metadata, skipping push notification`
          );
        }
      } catch (notificationError) {
        console.error(
          "❌ Error sending payment notification:",
          notificationError
        );
        // Don't fail the webhook because of notification error
      }
    } catch (error) {
      console.error("❌ Error processing payment intent success:", error);
    }
  }

  private static async handlePaymentIntentFailed(env: any, paymentIntent: any) {
    console.log("❌ Payment intent failed:", paymentIntent.id);

    try {
      const { getDb } = await import("../utils/database.js");
      const db = getDb(env);

      // Get payment method details and failure reason
      let paymentMethodType = null;
      let cardLast4 = null;
      let cardBrand = null;
      let failureReason = "Payment failed";

      try {
        const stripe = getStripe(env);
        const fullPaymentIntent = await stripe.paymentIntents.retrieve(
          paymentIntent.id,
          {
            expand: ["payment_method"],
          }
        );

        if (
          fullPaymentIntent.payment_method &&
          typeof fullPaymentIntent.payment_method === "object"
        ) {
          paymentMethodType = fullPaymentIntent.payment_method.type;

          // Extract card details if it's a card payment
          if (
            fullPaymentIntent.payment_method.type === "card" &&
            fullPaymentIntent.payment_method.card
          ) {
            cardLast4 = fullPaymentIntent.payment_method.card.last4;
            cardBrand = fullPaymentIntent.payment_method.card.brand;
          }
        }

        // Get failure reason
        if (fullPaymentIntent.last_payment_error) {
          failureReason =
            fullPaymentIntent.last_payment_error.message ||
            fullPaymentIntent.last_payment_error.decline_code ||
            "Payment failed";
        }
      } catch (error) {
        console.warn(
          "⚠️ Could not retrieve payment method details for failed payment:",
          error
        );
      }

      // Update transaction status to failed
      const result = await db
        .update(transactions)
        .set({
          status: "failed",
          failedAt: new Date(),
          stripePaymentMethodType: paymentMethodType,
          cardLast4: cardLast4,
          cardBrand: cardBrand,
          failureReason: failureReason,
          updatedAt: new Date(),
          notes: `Payment failed: ${failureReason}`,
        })
        .where(eq(transactions.stripePaymentIntentId, paymentIntent.id));

      console.log(
        `✅ Updated transaction status to failed: ${paymentIntent.id}`
      );

      console.log("Payment failed:", {
        id: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        last_payment_error: paymentIntent.last_payment_error,
        metadata: paymentIntent.metadata,
      });
    } catch (error) {
      console.error("❌ Error processing payment intent failure:", error);
    }
  }

  public static async handleAccountUpdated(env: any, account: any) {
    console.log("🔄 WEBHOOK: Account updated received for:", account.id);
    console.log(
      "🔄 WEBHOOK: Full account data:",
      JSON.stringify(
        {
          id: account.id,
          charges_enabled: account.charges_enabled,
          details_submitted: account.details_submitted,
          requirements: account.requirements,
        },
        null,
        2
      )
    );

    try {
      const { getDb } = await import("../utils/database.js");
      const db = getDb(env);

      // Find user by Stripe account ID
      const user = await db
        .select()
        .from(users)
        .where(eq(users.stripeAccountId, account.id))
        .limit(1);

      console.log(
        `🔍 WEBHOOK: Found ${user.length} users for Stripe account ${account.id}`
      );

      if (user.length > 0) {
        const userId = user[0].id;
        console.log(`👤 WEBHOOK: Processing for user ${userId}`);

        // Check if account is now enabled for charges
        const chargesEnabled = account.charges_enabled;
        const onboardingCompleted = chargesEnabled; // Use charges_enabled as completion indicator

        console.log("📊 WEBHOOK: Account status check:", {
          accountId: account.id,
          chargesEnabled,
          detailsSubmitted: account.details_submitted,
          onboardingCompleted,
        });

        if (onboardingCompleted) {
          console.log(
            `🔄 WEBHOOK: Updating database for user ${userId} - setting stripeOnboardingCompleted: true`
          );

          // Update user onboarding status
          const updateResult = await db
            .update(users)
            .set({
              stripeOnboardingCompleted: true,
              updatedAt: new Date(),
            })
            .where(eq(users.id, userId));

          console.log(`✅ WEBHOOK: Database update result:`, updateResult);
          console.log(
            `✅ WEBHOOK: Onboarding marked complete for user: ${userId}`
          );

          // Verify the update worked
          const verifyUser = await db
            .select({
              stripeOnboardingCompleted: users.stripeOnboardingCompleted,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

          console.log(
            `🔍 WEBHOOK: Verification - user ${userId} onboarding status:`,
            verifyUser[0]?.stripeOnboardingCompleted
          );

          // Send welcome notification to user
          try {
            const notificationResult = await sendWelcomeNotification(
              userId,
              user[0]?.fullName ?? user[0]?.firstName ?? undefined,
              env
            );

            if (notificationResult.success) {
              console.log(`🎉 Welcome notification sent to user ${userId}`);
            } else {
              console.warn(
                `⚠️ Failed to send welcome notification to user ${userId}:`,
                notificationResult.error
              );
            }
          } catch (notificationError) {
            console.error(
              "❌ Error sending welcome notification:",
              notificationError
            );
            // Don't fail the webhook because of notification error
          }

          // Broadcast real-time update to frontend
          console.log(
            `📡 Broadcasting onboarding completion to user ${userId}`
          );

          // For now, we'll log this - in a production environment with WebSockets/SSE
          // you'd broadcast to connected clients here
          const updateData = {
            type: "onboarding_completed",
            userId,
            stripeAccountId: account.id,
            timestamp: new Date().toISOString(),
            message: "Your Stripe onboarding has been completed successfully!",
          };

          console.log("📡 Onboarding completion event:", updateData);

          // Notify frontend immediately about the completion
          try {
            // This would typically be done via WebSocket/SSE in production
            // For now, we'll just log that the event occurred
            console.log(
              `✅ Onboarding completed - frontend can now poll for updated status for user ${userId}`
            );
          } catch (notifyError) {
            console.error("❌ Error notifying frontend:", notifyError);
            // Don't fail the webhook because of notification error
          }
        }
      } else {
        console.log("⚠️ No user found for Stripe account:", account.id);
      }
    } catch (error) {
      console.error("❌ Error processing account update:", error);
    }
  }

  private static async handleCheckoutSessionCompleted(env: any, session: any) {
    console.log("✅ Checkout session completed:", session.id);

    try {
      const { getDb } = await import("../utils/database.js");
      const db = getDb(env);

      // If this is a payment link checkout, update the transaction status
      if (session.payment_link && session.payment_status === "paid") {
        console.log(
          "🔗 Payment link checkout completed, updating transaction status"
        );

        // Find transaction by payment link ID
        const existingTransaction = await db
          .select()
          .from(transactions)
          .where(eq(transactions.stripePaymentLinkId, session.payment_link))
          .limit(1);

        if (existingTransaction.length > 0) {
          const transaction = existingTransaction[0];
          const metadata = JSON.parse(transaction.metadata || "{}");

          // Update transaction status to completed and add payment intent ID
          await db
            .update(transactions)
            .set({
              status: "completed",
              stripePaymentIntentId: session.payment_intent,
              updatedAt: new Date(),
              notes:
                metadata.paymentType === "destination_charges"
                  ? `Payment completed via destination charges - funds automatically transferred to ${metadata.connectedAccountId}`
                  : `Payment completed via checkout session ${session.id}`,
            })
            .where(eq(transactions.stripePaymentLinkId, session.payment_link));

          console.log(
            `✅ Updated ${
              metadata.paymentType || "direct"
            } payment link transaction to completed: ${transaction.id}`
          );

          // For destination charges, log the transfer information
          if (metadata.paymentType === "destination_charges") {
            console.log(
              `💸 Destination charges payment - funds automatically transferred to: ${metadata.connectedAccountId}`
            );
            console.log(
              `💰 Transfer amount: ${
                metadata.originalAmount || transaction.amount
              } ${metadata.originalCurrency || transaction.currency} cents`
            );
          }

          // Send push notification to user
          const userId = transaction.userId;
          // Use the actual currency from the transaction
          const displayAmount = metadata.originalAmount || transaction.amount;
          const displayCurrency =
            metadata.originalCurrency || transaction.currency || "USD";
          const customerName = transaction.customerName || undefined;

          try {
            console.log(
              `🔔 Attempting to send push notification to user ${userId} for payment link ${session.payment_link}:`,
              {
                displayAmount,
                displayCurrency,
                customerName,
                paymentType: metadata.paymentType,
              }
            );

            const notificationResult = await sendPaymentReceivedNotification(
              userId,
              displayAmount,
              displayCurrency,
              customerName,
              env
            );

            console.log(`📋 Push notification result:`, notificationResult);

            if (notificationResult.success) {
              console.log(
                `📱 ✅ Push notification sent to user ${userId} for ${
                  metadata.paymentType || "direct"
                } payment link ${session.payment_link} (sent to ${
                  notificationResult.sentTo
                } devices)`
              );
            } else {
              console.warn(
                `⚠️ ❌ Failed to send push notification for payment link ${session.payment_link}:`,
                notificationResult.error
              );
            }
          } catch (notificationError) {
            console.error(
              "❌ Error sending payment link notification:",
              notificationError
            );
            // Don't fail the webhook because of notification error
          }
        } else {
          console.log(
            `⚠️ No transaction found for payment link: ${session.payment_link}`
          );
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
    } catch (error) {
      console.error("❌ Error processing checkout session completion:", error);
    }
  }

  private static async handleInvoicePaymentSucceeded(env: any, invoice: any) {
    console.log("💳 Invoice payment succeeded:", invoice.id);

    try {
      const { getDb } = await import("../utils/database.js");
      const db = getDb(env);

      // If this invoice is from a payment link, update the transaction status
      if (invoice.payment_link) {
        console.log(
          "🔗 Payment link invoice payment succeeded, updating transaction status"
        );

        // Find transaction by payment link ID
        const existingTransaction = await db
          .select()
          .from(transactions)
          .where(eq(transactions.stripePaymentLinkId, invoice.payment_link))
          .limit(1);

        if (existingTransaction.length > 0) {
          const transaction = existingTransaction[0];
          const metadata = JSON.parse(transaction.metadata || "{}");

          // Get payment method details from the invoice
          let paymentMethodType = null;
          let cardLast4 = null;
          let cardBrand = null;

          try {
            const stripe = getStripe(env);
            if (invoice.payment_intent) {
              const paymentIntent = await stripe.paymentIntents.retrieve(
                invoice.payment_intent,
                {
                  expand: ["payment_method"],
                }
              );

              if (
                paymentIntent.payment_method &&
                typeof paymentIntent.payment_method === "object"
              ) {
                paymentMethodType = paymentIntent.payment_method.type;

                // Extract card details if it's a card payment
                if (
                  paymentIntent.payment_method.type === "card" &&
                  paymentIntent.payment_method.card
                ) {
                  cardLast4 = paymentIntent.payment_method.card.last4;
                  cardBrand = paymentIntent.payment_method.card.brand;
                }
              }
            }
          } catch (error) {
            console.warn(
              "⚠️ Could not retrieve payment method details:",
              error
            );
          }

          // Update transaction status to completed
          await db
            .update(transactions)
            .set({
              status: "completed",
              stripePaymentIntentId: invoice.payment_intent,
              completedAt: new Date(),
              stripePaymentMethodType: paymentMethodType,
              cardLast4: cardLast4,
              cardBrand: cardBrand,
              updatedAt: new Date(),
              notes:
                metadata.paymentType === "destination_charges"
                  ? `Payment completed via destination charges invoice - funds automatically transferred to ${metadata.connectedAccountId}`
                  : `Payment completed via invoice ${invoice.id}`,
            })
            .where(eq(transactions.stripePaymentLinkId, invoice.payment_link));

          console.log(
            `✅ Updated ${
              metadata.paymentType || "direct"
            } payment link transaction to completed: ${transaction.id}`
          );

          // For destination charges, log the transfer information
          if (metadata.paymentType === "destination_charges") {
            console.log(
              `💸 Destination charges invoice payment - funds automatically transferred to: ${metadata.connectedAccountId}`
            );
            console.log(
              `💰 Transfer amount: ${
                metadata.originalAmount || transaction.amount
              } ${metadata.originalCurrency || transaction.currency} cents`
            );
          }

          // Send push notification to user
          const userId = transaction.userId;
          // Use the actual currency from the transaction
          const displayAmount = metadata.originalAmount || transaction.amount;
          const displayCurrency =
            metadata.originalCurrency || transaction.currency || "USD";
          const customerName = transaction.customerName || undefined;

          try {
            const notificationResult = await sendPaymentReceivedNotification(
              userId,
              displayAmount,
              displayCurrency,
              customerName,
              env
            );

            if (notificationResult.success) {
              console.log(
                `📱 Push notification sent to user ${userId} for ${
                  metadata.paymentType || "direct"
                } invoice payment ${invoice.id}`
              );
            } else {
              console.warn(
                `⚠️ Failed to send push notification for invoice payment ${invoice.id}:`,
                notificationResult.error
              );
            }
          } catch (notificationError) {
            console.error(
              "❌ Error sending invoice payment notification:",
              notificationError
            );
            // Don't fail the webhook because of notification error
          }
        } else {
          console.log(
            `⚠️ No transaction found for payment link: ${invoice.payment_link}`
          );
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
    } catch (error) {
      console.error("❌ Error processing invoice payment success:", error);
    }
  }

  private static async handleInvoicePaymentFailed(env: any, invoice: any) {
    console.log("❌ Invoice payment failed:", invoice.id);

    try {
      const { getDb } = await import("../utils/database.js");
      const db = getDb(env);

      // If this invoice is from a payment link, update the transaction status
      if (invoice.payment_link) {
        console.log(
          "🔗 Payment link invoice payment failed, updating transaction status"
        );

        // Find transaction by payment link ID
        const existingTransaction = await db
          .select()
          .from(transactions)
          .where(eq(transactions.stripePaymentLinkId, invoice.payment_link))
          .limit(1);

        if (existingTransaction.length > 0) {
          // Get payment method details and failure reason from the invoice
          let paymentMethodType = null;
          let cardLast4 = null;
          let cardBrand = null;
          let failureReason = "Payment failed";

          try {
            const stripe = getStripe(env);
            if (invoice.payment_intent) {
              const paymentIntent = await stripe.paymentIntents.retrieve(
                invoice.payment_intent,
                {
                  expand: ["payment_method"],
                }
              );

              if (
                paymentIntent.payment_method &&
                typeof paymentIntent.payment_method === "object"
              ) {
                paymentMethodType = paymentIntent.payment_method.type;

                // Extract card details if it's a card payment
                if (
                  paymentIntent.payment_method.type === "card" &&
                  paymentIntent.payment_method.card
                ) {
                  cardLast4 = paymentIntent.payment_method.card.last4;
                  cardBrand = paymentIntent.payment_method.card.brand;
                }
              }

              // Get failure reason from payment intent
              if (paymentIntent.last_payment_error) {
                failureReason =
                  paymentIntent.last_payment_error.message ||
                  paymentIntent.last_payment_error.decline_code ||
                  "Payment failed";
              }
            }
          } catch (error) {
            console.warn(
              "⚠️ Could not retrieve payment method details for failed payment:",
              error
            );
          }

          // Update transaction status to failed
          await db
            .update(transactions)
            .set({
              status: "failed",
              failedAt: new Date(),
              stripePaymentMethodType: paymentMethodType,
              cardLast4: cardLast4,
              cardBrand: cardBrand,
              failureReason: failureReason,
              updatedAt: new Date(),
              notes: `Payment failed via invoice ${invoice.id} (attempt ${
                invoice.attempt_count || 1
              })`,
            })
            .where(eq(transactions.stripePaymentLinkId, invoice.payment_link));

          console.log(
            `✅ Updated payment link transaction to failed: ${existingTransaction[0].id}`
          );
        } else {
          console.log(
            `⚠️ No transaction found for payment link: ${invoice.payment_link}`
          );
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
    } catch (error) {
      console.error("❌ Error processing invoice payment failure:", error);
    }
  }
}
