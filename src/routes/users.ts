import { Hono } from "hono";
import { getDb } from "../utils/database.js";
import { users } from "../schema.js";
import { eq } from "drizzle-orm";
import { requireOwnership } from "../index.js";

const userRoutes = new Hono();

// User synchronization endpoint for syncing authenticated users to backend DB
userRoutes.post("/sync", async (c) => {
  try {
    const db = getDb(c.env);
    const userData = await c.req.json();
    console.log("🔄 User sync request:", userData);
    console.log("🔄 Stripe data:", {
      stripeAccountId: userData.stripeAccountId,
      stripeOnboardingCompleted: userData.stripeOnboardingCompleted,
    });

    const {
      id,
      email,
      fullName,
      firstName,
      lastName,
      authProvider,
      memberSince,
      appleUserId,
      googleUserId,
      stripeAccountId,
      stripeOnboardingCompleted,
    } = userData;

    // Note: No authentication required for initial user sync
    // Users sync their data after successful OAuth authentication

    if (!id || !authProvider || !memberSince) {
      return c.json(
        {
          error: "Missing required fields: id, authProvider, memberSince",
        },
        400
      );
    }

    // FIRST: Check if this provider ID is already associated with an existing account
    let existingAccountCheck = null;

    if (appleUserId) {
      existingAccountCheck = await db
        .select({ id: users.id, authProvider: users.authProvider })
        .from(users)
        .where(eq(users.appleUserId, appleUserId))
        .limit(1);
    } else if (googleUserId) {
      existingAccountCheck = await db
        .select({ id: users.id, authProvider: users.authProvider })
        .from(users)
        .where(eq(users.googleUserId, googleUserId))
        .limit(1);
    }

    // If provider ID already exists on a different account, return that account
    if (
      existingAccountCheck &&
      existingAccountCheck.length > 0 &&
      existingAccountCheck[0].id !== id
    ) {
      console.log(
        `🔄 Provider ID already linked to account: ${existingAccountCheck[0].id}`
      );
      return c.json({
        success: true,
        message: "Provider linked to existing account",
        userId: existingAccountCheck[0].id,
        existingAccount: true,
      });
    }

    // Check if user already exists
    const existingUser = await db
      .select({
        id: users.id,
        stripeAccountId: users.stripeAccountId,
        stripeOnboardingCompleted: users.stripeOnboardingCompleted,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (existingUser.length > 0) {
      // Update existing user - preserve existing provider IDs
      const updateData: any = {
        email: email || null,
        fullName: fullName || null,
        firstName: firstName || null,
        lastName: lastName || null,
        stripeAccountId:
          stripeAccountId || existingUser[0].stripeAccountId || null,
        stripeOnboardingCompleted:
          stripeOnboardingCompleted ||
          existingUser[0].stripeOnboardingCompleted ||
          false,
        updatedAt: new Date(),
      };

      // Only update authProvider if it's different (allows switching primary provider)
      if (authProvider) {
        updateData.authProvider = authProvider;
      }

      // Preserve existing provider IDs and add new ones
      if (appleUserId) {
        updateData.appleUserId = appleUserId;
      }
      if (googleUserId) {
        updateData.googleUserId = googleUserId;
      }

      await db.update(users).set(updateData).where(eq(users.id, id));

      console.log(`✅ Updated existing user in backend: ${id}`);
      console.log(
        `✅ Provider IDs: Apple=${!!appleUserId}, Google=${!!googleUserId}`
      );
    } else {
      // Create new user
      await db.insert(users).values({
        id,
        email: email || null,
        fullName: fullName || null,
        firstName: firstName || null,
        lastName: lastName || null,
        authProvider,
        appleUserId: appleUserId || null,
        googleUserId: googleUserId || null,
        stripeAccountId: stripeAccountId || null,
        stripeOnboardingCompleted: stripeOnboardingCompleted || false,
        memberSince: new Date(memberSince),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      console.log(`✅ Created new user in backend: ${id}`);
      console.log(
        `✅ Provider IDs: Apple=${!!appleUserId}, Google=${!!googleUserId}`
      );
    }

    return c.json({
      success: true,
      message: `User ${
        existingUser.length > 0 ? "updated" : "created"
      } successfully`,
      userId: id,
    });
  } catch (error) {
    console.error("❌ User sync error:", error);
    return c.json(
      {
        success: false,
        error: "User sync failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// Delete user endpoint - removes user and all related data
userRoutes.delete("/:userId", async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.req.param("userId");

    if (!userId) {
      return c.json({ error: "Missing userId parameter" }, 400);
    }

    console.log(`🗑️ Starting user deletion process for: ${userId}`);

    // First, check if user exists
    const existingUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (existingUser.length === 0) {
      return c.json({ error: "User not found" }, 404);
    }

    console.log(`✅ User ${userId} found, proceeding with deletion`);

    // Step 1: Delete all transactions for this user
    console.log(`🗑️ Deleting transactions for user ${userId}`);
    const { transactions } = await import("../schema.js");
    await db.delete(transactions).where(eq(transactions.userId, userId));
    console.log(`✅ Deleted transactions for user ${userId}`);

    // Step 2: Delete all payouts for this user
    console.log(`🗑️ Deleting payouts for user ${userId}`);
    const { payouts } = await import("../schema.js");
    await db.delete(payouts).where(eq(payouts.userId, userId));
    console.log(`✅ Deleted payouts for user ${userId}`);

    // Step 3: Delete the user record
    console.log(`🗑️ Deleting user record for ${userId}`);
    await db.delete(users).where(eq(users.id, userId));

    console.log(`✅ Successfully deleted user ${userId} and all related data`);

    return c.json({
      success: true,
      message: `User ${userId} and all related data deleted successfully`,
    });
  } catch (error) {
    console.error("❌ Error deleting user:", error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete user",
      },
      500
    );
  }
});

export { userRoutes };
