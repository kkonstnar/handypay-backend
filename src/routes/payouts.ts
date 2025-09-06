import { Hono } from "hono";
import { db } from "../db.js";
import { payoutRules, payouts, transactions, users } from "../schema.js";
import { eq, sql } from "drizzle-orm";

const payoutRoutes = new Hono();

// Payout Rules Management
// Initialize default payout rules if they don't exist
payoutRoutes.get("/rules/init", async (c) => {
  try {
    const existingRules = await db
      .select()
      .from(payoutRules)
      .where(eq(payoutRules.id, "default_rule"))
      .limit(1);

    if (existingRules.length === 0) {
      await db.insert(payoutRules).values({
        id: "default_rule",
        ruleName: "Standard Payout Rule",
        firstTransactionDelayDays: 7,
        subsequentDelayDaysMin: 2,
        subsequentDelayDaysMax: 5,
        minimumPayoutAmount: "0.00",
        isActive: true,
      });

      console.log("✅ Default payout rules initialized");
    }

    return c.json({ success: true, message: "Payout rules initialized" });
  } catch (error) {
    console.error("❌ Error initializing payout rules:", error);
    return c.json({ error: "Failed to initialize payout rules" }, 500);
  }
});

// Automatic payout generation endpoint (called by cron job or scheduled task)
payoutRoutes.post("/generate-automatic", async (c) => {
  try {
    console.log("🤖 Starting automatic payout generation...");

    // Get all users with available balance above minimum
    const usersWithBalance = await db.execute(sql`
      SELECT DISTINCT t.user_id,
             SUM(CASE WHEN t.status = 'completed' AND t.type IN ('received', 'payment_link', 'qr_payment') THEN t.amount ELSE 0 END) -
             COALESCE(SUM(CASE WHEN p.status = 'completed' THEN CAST(p.amount AS DECIMAL) * 100 ELSE 0 END), 0) as available_balance
      FROM transactions t
      LEFT JOIN payouts p ON t.user_id = p.user_id
      WHERE t.status = 'completed'
      GROUP BY t.user_id
      HAVING (SUM(CASE WHEN t.status = 'completed' AND t.type IN ('received', 'payment_link', 'qr_payment') THEN t.amount ELSE 0 END) -
              COALESCE(SUM(CASE WHEN p.status = 'completed' THEN CAST(p.amount AS DECIMAL) * 100 ELSE 0 END), 0)) > 0
    `);

    const results = [];

    for (const userBalance of usersWithBalance || []) {
      const userId = String(userBalance.user_id);
      const availableBalance =
        parseFloat(String(userBalance.available_balance)) / 100; // Convert from cents

      // Get payout rules
      const rules = await db
        .select()
        .from(payoutRules)
        .where(eq(payoutRules.isActive, true))
        .limit(1);

      if (
        rules.length === 0 ||
        !rules[0].minimumPayoutAmount ||
        availableBalance < parseFloat(rules[0].minimumPayoutAmount)
      ) {
        continue;
      }

      // Check if user should get a payout today based on rules
      const shouldProcessPayout = await shouldProcessPayoutForUser(
        String(userId)
      );

      if (shouldProcessPayout) {
        const payout = await createAutomaticPayout(
          String(userId),
          availableBalance
        );
        results.push(payout);
      }
    }

    return c.json({
      success: true,
      message: `Processed ${results.length} automatic payouts`,
      payoutsGenerated: results.length,
      results,
    });
  } catch (error) {
    console.error("❌ Automatic payout generation error:", error);
    return c.json({ error: "Failed to generate automatic payouts" }, 500);
  }
});

// Test endpoint to manually trigger account update webhook logic
payoutRoutes.post("/test-account-update", async (c) => {
  try {
    const { accountId, userId } = await c.req.json();

    console.log("🧪 Testing account update webhook logic:", {
      accountId,
      userId,
    });

    // Simulate account updated event
    const mockAccount = {
      id: accountId,
      charges_enabled: true,
      details_submitted: true,
      // Add other typical account fields
    };

    // Call our webhook handler
    const { StripeService } = await import("../services/stripe.js");
    await StripeService.handleAccountUpdated(c.env, mockAccount);

    return c.json({
      success: true,
      message: "Account update test completed",
      accountId,
      userId,
    });
  } catch (error) {
    console.error("❌ Error in test account update:", error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// Helper function to determine if user should get payout
async function shouldProcessPayoutForUser(userId: string): Promise<boolean> {
  // Get payout rules
  const rules = await db
    .select()
    .from(payoutRules)
    .where(eq(payoutRules.isActive, true))
    .limit(1);

  if (rules.length === 0) return false;

  const rule = rules[0];

  // Check if rule properties are valid
  if (
    !rule.firstTransactionDelayDays ||
    !rule.subsequentDelayDaysMin ||
    !rule.subsequentDelayDaysMax
  ) {
    return false;
  }

  // Get user's most recent payout
  const recentPayout = await db
    .select({
      payoutDate: payouts.payoutDate,
    })
    .from(payouts)
    .where(eq(payouts.userId, userId))
    .orderBy(sql`${payouts.payoutDate} DESC`)
    .limit(1);

  const now = new Date();

  if (recentPayout.length === 0) {
    // First payout - check if first transaction delay has passed
    const firstTransaction = await db
      .select({
        date: transactions.date,
      })
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(sql`${transactions.date} DESC`)
      .limit(1);

    if (firstTransaction.length === 0) return false;

    const daysSinceFirstTransaction = Math.floor(
      (now.getTime() - firstTransaction[0].date.getTime()) /
        (24 * 60 * 60 * 1000)
    );

    return daysSinceFirstTransaction >= rule.firstTransactionDelayDays;
  } else {
    // Subsequent payout - check if random delay has passed
    const daysSinceLastPayout = Math.floor(
      (now.getTime() - recentPayout[0].payoutDate.getTime()) /
        (24 * 60 * 60 * 1000)
    );

    const randomDelay =
      Math.floor(
        Math.random() *
          (rule.subsequentDelayDaysMax - rule.subsequentDelayDaysMin + 1)
      ) + rule.subsequentDelayDaysMin;

    return daysSinceLastPayout >= randomDelay;
  }
}

// Helper function to create automatic payout
async function createAutomaticPayout(
  userId: string,
  amount: number
): Promise<any> {
  console.log(
    `💸 Creating automatic payout for user ${userId}, amount: $${amount}`
  );

  // Get user's Stripe account
  const userAccount = await db
    .select({
      stripeAccountId: users.stripeAccountId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (userAccount.length === 0 || !userAccount[0].stripeAccountId) {
    throw new Error(`No Stripe account found for user ${userId}`);
  }

  const payoutDate = new Date();
  const payoutId = `payout_${Date.now()}_${userId}`;

  // Create payout record
  await db.insert(payouts).values({
    id: payoutId,
    userId,
    amount: amount.toFixed(2),
    currency: "JMD",
    status: "pending",
    payoutDate,
    bankAccount: "****8689", // In real implementation, get from Stripe
    description: `Automatic payout - ${payoutDate.toLocaleDateString()}`,
  });

  // In a real implementation, you would:
  // 1. Create a Stripe Transfer to the user's account
  // 2. Update the payout status based on the transfer result
  // 3. Handle any errors

  // For now, we'll mark it as completed immediately
  await db
    .update(payouts)
    .set({
      status: "completed",
      processedAt: new Date(),
      stripePayoutId: `stripe_payout_${Date.now()}`,
      updatedAt: new Date(),
    })
    .where(eq(payouts.id, payoutId));

  return {
    payoutId,
    userId,
    amount,
    status: "completed",
  };
}

export { payoutRoutes };
