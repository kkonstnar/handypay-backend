import { Hono } from "hono";
import { stripeRoutes } from "./stripe.js";
import { paymentLinkRoutes } from "./payment-links.js";
import { userRoutes } from "./users.js";
import { transactionRoutes } from "./transactions.js";
import { payoutRoutes } from "./payouts.js";
const apiRoutes = new Hono();
// Mount all route groups under /api (auth routes are handled separately)
apiRoutes.route("/stripe", stripeRoutes);
apiRoutes.route("/stripe", paymentLinkRoutes); // Payment links are under /api/stripe
apiRoutes.route("/users", userRoutes);
apiRoutes.route("/transactions", transactionRoutes);
apiRoutes.route("/payouts", payoutRoutes);
export { apiRoutes };
