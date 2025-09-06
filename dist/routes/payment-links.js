import { Hono } from "hono";
import { StripeService } from "../services/stripe.js";
const paymentLinkRoutes = new Hono();
// Create payment link endpoint
paymentLinkRoutes.post("/create-payment-link", async (c) => {
    try {
        const { handyproUserId, customerName, customerEmail, description, amount, taskDetails, dueDate, } = await c.req.json();
        if (!handyproUserId || !amount) {
            return c.json({
                error: "Missing required fields: handyproUserId, amount",
            }, 400);
        }
        console.log("💳 Creating payment link for user:", handyproUserId, "amount:", amount);
        const paymentLink = await StripeService.createPaymentLink(c.env, {
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
    }
    catch (error) {
        console.error("❌ Payment link creation error:", error);
        return c.json({
            success: false,
            error: error instanceof Error
                ? error.message
                : "Failed to create payment link",
        }, 500);
    }
});
// Cancel payment link endpoint
paymentLinkRoutes.post("/cancel-payment-link", async (c) => {
    try {
        const { paymentLinkId, userId } = await c.req.json();
        if (!paymentLinkId || !userId) {
            return c.json({
                error: "Missing required fields: paymentLinkId, userId",
            }, 400);
        }
        console.log("🗑️ Cancelling payment link:", paymentLinkId, "for user:", userId);
        const result = await StripeService.cancelPaymentLink(c.env, paymentLinkId, userId);
        return c.json({
            success: true,
            paymentLink: result,
        });
    }
    catch (error) {
        console.error("❌ Payment link cancellation error:", error);
        return c.json({
            success: false,
            error: error instanceof Error
                ? error.message
                : "Failed to cancel payment link",
        }, 500);
    }
});
// Expire payment link endpoint
paymentLinkRoutes.post("/expire-payment-link", async (c) => {
    try {
        const { paymentLinkId, userId } = await c.req.json();
        if (!paymentLinkId || !userId) {
            return c.json({
                error: "Missing required fields: paymentLinkId, userId",
            }, 400);
        }
        console.log("⏰ Expiring payment link:", paymentLinkId, "for user:", userId);
        const result = await StripeService.expirePaymentLink(c.env, paymentLinkId, userId);
        return c.json({
            success: true,
            paymentLink: result,
        });
    }
    catch (error) {
        console.error("❌ Payment link expiration error:", error);
        return c.json({
            success: false,
            error: error instanceof Error
                ? error.message
                : "Failed to expire payment link",
        }, 500);
    }
});
export { paymentLinkRoutes };
