import { Hono } from "hono";
import { StripeService } from "../services/stripe.js";

const paymentLinkRoutes = new Hono();

// Create payment link endpoint
paymentLinkRoutes.post("/create-payment-link", async (c) => {
  try {
    const {
      handyproUserId,
      customerName,
      customerEmail,
      description,
      amount,
      taskDetails,
      dueDate,
      destinationCharges,
      currency,
      paymentSource, // Track payment source
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
      amount,
      "currency:",
      currency || "USD"
    );

    const paymentLink = await StripeService.createPaymentLink(c.env, {
      handyproUserId,
      customerName,
      customerEmail,
      description,
      amount,
      taskDetails,
      dueDate,
      currency,
      paymentSource,
    });

    return c.json({
      success: true,
      invoice: paymentLink,
    });
  } catch (error) {
    console.error("❌ Payment link creation error:", error);

    // Provide specific error messages
    let errorMessage = "Failed to create payment link";
    if (error instanceof Error) {
      if (
        error.message.includes("payment method") ||
        error.message.includes("payment method types")
      ) {
        errorMessage =
          "Payment method configuration issue. Please check your Stripe account settings or contact support.";
      } else if (error.message.includes("account not ready")) {
        errorMessage =
          "Your Stripe account is not ready to accept payments. Please complete your onboarding.";
      } else {
        errorMessage = error.message;
      }
    }

    return c.json(
      {
        success: false,
        error: errorMessage,
      },
      500
    );
  }
});

// Cancel payment link endpoint
paymentLinkRoutes.post("/cancel-payment-link", async (c) => {
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

    const result = await StripeService.cancelPaymentLink(
      c.env,
      paymentLinkId,
      userId
    );

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
paymentLinkRoutes.post("/expire-payment-link", async (c) => {
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

    const result = await StripeService.expirePaymentLink(
      c.env,
      paymentLinkId,
      userId
    );

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

export { paymentLinkRoutes };
