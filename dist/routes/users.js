import { Hono } from "hono";
import { getDb } from "../utils/database.js";
import { users, bannedAccounts, pushTokens } from "../schema.js";
import { eq, and } from "drizzle-orm";
import { db } from "../db.js";
const userRoutes = new Hono();
// Helper function to send ban notification to user's devices
const sendOnboardingCompleteNotification = async (env, userId) => {
    try {
        console.log(`🎉 Sending onboarding complete notification to user ${userId}`);
        // Get user's active push tokens
        const userTokens = await db
            .select({
            token: pushTokens.token,
        })
            .from(pushTokens)
            .where(and(eq(pushTokens.userId, userId), eq(pushTokens.isActive, true)));
        if (userTokens.length === 0) {
            console.log(`⚠️ No active push tokens found for user ${userId}`);
            return;
        }
        const expoPushTokens = userTokens.map((t) => t.token);
        // Send push notification via Expo
        const message = {
            to: expoPushTokens,
            title: "Onboarding Completed!",
            body: "Your Stripe account is now ready to accept payments.",
            data: {
                type: "onboarding_complete",
            },
            sound: "default",
            priority: "high",
            ttl: 86400, // 24 hours
            expiration: Math.floor(Date.now() / 1000) + 86400,
        };
        const expoResponse = await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify(message),
        });
        if (!expoResponse.ok) {
            const errorText = await expoResponse.text();
            console.error("❌ Failed to send onboarding complete notification:", errorText);
            return;
        }
        const expoResult = await expoResponse.json();
        console.log(`✅ Onboarding complete notification sent to ${expoPushTokens.length} devices for user ${userId}`, expoResult);
    }
    catch (error) {
        console.error("❌ Error sending onboarding complete notification:", error);
    }
};
const sendBanNotification = async (env, userId, banDetails) => {
    try {
        console.log(`🚫 Sending ban notification to user ${userId}`);
        // Get user's active push tokens
        const userTokens = await db
            .select({
            token: pushTokens.token,
        })
            .from(pushTokens)
            .where(and(eq(pushTokens.userId, userId), eq(pushTokens.isActive, true)));
        if (userTokens.length === 0) {
            console.log(`⚠️ No active push tokens found for user ${userId}`);
            return;
        }
        const expoPushTokens = userTokens.map((t) => t.token);
        // Send push notification via Expo
        const message = {
            to: expoPushTokens,
            title: "Account Restricted",
            body: `Your account has been restricted. Reason: ${banDetails.banReason}`,
            data: {
                type: "account_banned",
                banDetails: {
                    reason: banDetails.banReason,
                    type: banDetails.banType,
                    bannedAt: banDetails.bannedAt,
                },
            },
            sound: "default",
            priority: "high",
            ttl: 86400, // 24 hours
            expiration: Math.floor(Date.now() / 1000) + 86400,
        };
        const expoResponse = await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify(message),
        });
        if (!expoResponse.ok) {
            const errorText = await expoResponse.text();
            console.error("❌ Failed to send ban notification:", errorText);
            return;
        }
        const expoResult = await expoResponse.json();
        console.log(`✅ Ban notification sent to ${expoPushTokens.length} devices for user ${userId}`, expoResult);
    }
    catch (error) {
        console.error("❌ Error sending ban notification:", error);
    }
};
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
        const { id, email, fullName, firstName, lastName, authProvider, memberSince, appleUserId, googleUserId, stripeAccountId, stripeOnboardingCompleted, } = userData;
        // Note: No authentication required for initial user sync
        // Users sync their data after successful OAuth authentication
        if (!id || !authProvider || !memberSince) {
            return c.json({
                error: "Missing required fields: id, authProvider, memberSince",
            }, 400);
        }
        // FIRST: Check if this provider ID is already associated with an existing account
        let existingAccountCheck = null;
        if (appleUserId) {
            existingAccountCheck = await db
                .select({ id: users.id, authProvider: users.authProvider })
                .from(users)
                .where(eq(users.appleUserId, appleUserId))
                .limit(1);
        }
        else if (googleUserId) {
            existingAccountCheck = await db
                .select({ id: users.id, authProvider: users.authProvider })
                .from(users)
                .where(eq(users.googleUserId, googleUserId))
                .limit(1);
        }
        // If provider ID already exists on a different account, return that account
        if (existingAccountCheck &&
            existingAccountCheck.length > 0 &&
            existingAccountCheck[0].id !== id) {
            console.log(`🔄 Provider ID already linked to account: ${existingAccountCheck[0].id}`);
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
            const updateData = {
                email: email || null,
                fullName: fullName || null,
                firstName: firstName || null,
                lastName: lastName || null,
                stripeAccountId: stripeAccountId || existingUser[0].stripeAccountId || null,
                stripeOnboardingCompleted: stripeOnboardingCompleted ||
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
            console.log(`✅ Provider IDs: Apple=${!!appleUserId}, Google=${!!googleUserId}`);
        }
        else {
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
            console.log(`✅ Provider IDs: Apple=${!!appleUserId}, Google=${!!googleUserId}`);
        }
        return c.json({
            success: true,
            message: `User ${existingUser.length > 0 ? "updated" : "created"} successfully`,
            userId: id,
        });
    }
    catch (error) {
        console.error("❌ User sync error:", error);
        return c.json({
            success: false,
            error: "User sync failed",
            details: error instanceof Error ? error.message : "Unknown error",
        }, 500);
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
        // Step 3: Handle banned accounts before deleting user
        console.log(`🗑️ Checking for banned account records for ${userId}`);
        // If user was banned, preserve ban information for future reference
        const userBanInfo = await db
            .select({
            email: users.email,
            isBanned: users.isBanned,
            banReason: users.banReason,
            bannedAt: users.bannedAt,
        })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        if (userBanInfo.length > 0 && userBanInfo[0].isBanned) {
            // Preserve ban information in a separate record
            const banHistoryId = `ban_history_${userId}_${Date.now()}`;
            await db.insert(bannedAccounts).values({
                id: banHistoryId,
                userId: null, // User deleted, so set to null
                email: userBanInfo[0].email,
                banReason: userBanInfo[0].banReason || "Account deleted while banned",
                banType: "persistent", // Mark as persistent ban
                bannedBy: "system",
                evidence: `User ${userId} deleted account while banned. Ban preserved for fraud prevention.`,
                bannedAt: userBanInfo[0].bannedAt || new Date(),
                isActive: true, // Keep ban active even after deletion
            });
            console.log(`🚫 Preserved ban information for deleted user ${userId}`);
        }
        // Deactivate any existing ban records for this user
        await db
            .update(bannedAccounts)
            .set({
            isActive: false,
            unbannedAt: new Date(),
            updatedAt: new Date(),
        })
            .where(eq(bannedAccounts.userId, userId));
        // Step 4: Delete the user record
        console.log(`🗑️ Deleting user record for ${userId}`);
        await db.delete(users).where(eq(users.id, userId));
        console.log(`✅ Successfully deleted user ${userId} and all related data`);
        return c.json({
            success: true,
            message: `User ${userId} and all related data deleted successfully`,
        });
    }
    catch (error) {
        console.error("❌ Error deleting user:", error);
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : "Failed to delete user",
        }, 500);
    }
});
// Check if user/account is banned
userRoutes.get("/ban-status/:userId", async (c) => {
    try {
        const db = getDb(c.env);
        const userId = c.req.param("userId");
        if (!userId) {
            return c.json({ error: "Missing userId parameter" }, 400);
        }
        // Check if user is banned
        const user = await db
            .select({
            id: users.id,
            email: users.email,
            isBanned: users.isBanned,
            banReason: users.banReason,
            bannedAt: users.bannedAt,
        })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        if (user.length === 0) {
            return c.json({ error: "User not found" }, 404);
        }
        const userEmail = user[0].email;
        const isBanned = user[0].isBanned;
        let banDetails = null;
        // Check for active bans on this user
        if (isBanned) {
            const bannedAccount = await db
                .select({
                banReason: bannedAccounts.banReason,
                banType: bannedAccounts.banType,
                bannedBy: bannedAccounts.bannedBy,
                evidence: bannedAccounts.evidence,
                stripeRestrictions: bannedAccounts.stripeRestrictions,
                stripeDisabledReason: bannedAccounts.stripeDisabledReason,
                bannedAt: bannedAccounts.bannedAt,
            })
                .from(bannedAccounts)
                .where(and(eq(bannedAccounts.userId, userId), eq(bannedAccounts.isActive, true)))
                .limit(1);
            if (bannedAccount.length > 0) {
                banDetails = bannedAccount[0];
            }
        }
        // Also check for persistent bans by email (for deleted accounts)
        if (userEmail && !banDetails) {
            const emailBan = await db
                .select({
                banReason: bannedAccounts.banReason,
                banType: bannedAccounts.banType,
                bannedBy: bannedAccounts.bannedBy,
                evidence: bannedAccounts.evidence,
                bannedAt: bannedAccounts.bannedAt,
            })
                .from(bannedAccounts)
                .where(and(eq(bannedAccounts.email, userEmail), eq(bannedAccounts.isActive, true), eq(bannedAccounts.banType, "persistent")))
                .limit(1);
            if (emailBan.length > 0) {
                console.log(`🚫 Detected persistent ban for email: ${userEmail}`);
                banDetails = {
                    banReason: `Persistent ban: ${emailBan[0].banReason}`,
                    banType: "persistent",
                    bannedBy: emailBan[0].bannedBy,
                    evidence: emailBan[0].evidence,
                    stripeRestrictions: null,
                    stripeDisabledReason: null,
                    bannedAt: emailBan[0].bannedAt,
                };
            }
        }
        return c.json({
            userId,
            isBanned: isBanned || !!banDetails,
            banDetails: banDetails
                ? {
                    reason: banDetails.banReason,
                    type: banDetails.banType,
                    bannedBy: banDetails.bannedBy,
                    evidence: banDetails.evidence,
                    stripeRestrictions: banDetails.stripeRestrictions,
                    stripeDisabledReason: banDetails.stripeDisabledReason,
                    bannedAt: banDetails.bannedAt,
                }
                : null,
        });
    }
    catch (error) {
        console.error("❌ Error checking ban status:", error);
        return c.json({ error: "Failed to check ban status" }, 500);
    }
});
// Ban a user (admin endpoint)
userRoutes.post("/ban/:userId", async (c) => {
    try {
        const db = getDb(c.env);
        const userId = c.req.param("userId");
        const { banReason, banType, bannedBy, evidence } = await c.req.json();
        if (!userId || !banReason || !banType) {
            return c.json({ error: "Missing required fields: userId, banReason, banType" }, 400);
        }
        // Update user as banned
        await db
            .update(users)
            .set({
            isBanned: true,
            banReason,
            bannedAt: new Date(),
            updatedAt: new Date(),
        })
            .where(eq(users.id, userId));
        // Create banned account record
        const bannedAccountId = `${userId}_${Date.now()}`;
        await db.insert(bannedAccounts).values({
            id: bannedAccountId,
            userId,
            banReason,
            banType,
            bannedBy,
            evidence,
            bannedAt: new Date(),
        });
        console.log(`🚫 User ${userId} banned: ${banReason}`);
        // Send push notification to user's devices (don't await to avoid blocking response)
        sendBanNotification(c.env, userId, {
            banReason,
            banType,
            bannedBy,
            evidence,
            bannedAt: new Date(),
        });
        return c.json({
            success: true,
            message: `User ${userId} has been banned`,
            banDetails: {
                userId,
                banReason,
                banType,
                bannedBy,
                evidence,
                bannedAt: new Date(),
            },
        });
    }
    catch (error) {
        console.error("❌ Error banning user:", error);
        return c.json({ error: "Failed to ban user" }, 500);
    }
});
// Test webhook onboarding complete notification (for development/testing)
userRoutes.post("/test-onboarding-complete/:userId", async (c) => {
    try {
        const db = getDb(c.env);
        const userId = c.req.param("userId");
        if (!userId) {
            return c.json({ error: "Missing userId parameter" }, 400);
        }
        console.log(`🧪 Testing onboarding complete notification for user ${userId}`);
        // Check if user exists
        const existingUser = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        if (existingUser.length === 0) {
            return c.json({ error: "User not found" }, 404);
        }
        // Send onboarding complete notification
        await sendOnboardingCompleteNotification(c.env, userId);
        return c.json({
            success: true,
            message: `Test onboarding complete notification sent to user ${userId}`,
        });
    }
    catch (error) {
        console.error("❌ Error testing onboarding complete notification:", error);
        return c.json({ error: "Failed to test onboarding complete notification" }, 500);
    }
});
// Test webhook ban notification (for development/testing)
userRoutes.post("/test-ban-webhook/:userId", async (c) => {
    try {
        const db = getDb(c.env);
        const userId = c.req.param("userId");
        if (!userId) {
            return c.json({ error: "Missing userId parameter" }, 400);
        }
        console.log(`🧪 Testing webhook ban notification for user ${userId}`);
        // Check if user exists
        const existingUser = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        if (existingUser.length === 0) {
            return c.json({ error: "User not found" }, 404);
        }
        // Simulate ban notification (doesn't actually ban the user)
        const testBanDetails = {
            banReason: "Test webhook notification",
            banType: "temporary",
            bannedBy: "system_test",
            evidence: "Testing webhook ban notification system",
            bannedAt: new Date(),
        };
        // Send test ban notification via webhook
        await sendBanNotification(c.env, userId, testBanDetails);
        return c.json({
            success: true,
            message: `Test webhook ban notification sent to user ${userId}`,
            testBanDetails,
        });
    }
    catch (error) {
        console.error("❌ Error testing webhook ban notification:", error);
        return c.json({ error: "Failed to test webhook ban notification" }, 500);
    }
});
// Export the notification functions for use by other services
export { sendOnboardingCompleteNotification, sendBanNotification };
// Unban a user (admin endpoint)
userRoutes.post("/unban/:userId", async (c) => {
    try {
        const db = getDb(c.env);
        const userId = c.req.param("userId");
        if (!userId) {
            return c.json({ error: "Missing userId parameter" }, 400);
        }
        // Update user as unbanned
        await db
            .update(users)
            .set({
            isBanned: false,
            banReason: null,
            bannedAt: null,
            updatedAt: new Date(),
        })
            .where(eq(users.id, userId));
        // Mark banned account record as inactive
        await db
            .update(bannedAccounts)
            .set({
            isActive: false,
            unbannedAt: new Date(),
            updatedAt: new Date(),
        })
            .where(and(eq(bannedAccounts.userId, userId), eq(bannedAccounts.isActive, true)));
        console.log(`✅ User ${userId} unbanned`);
        return c.json({
            success: true,
            message: `User ${userId} has been unbanned`,
        });
    }
    catch (error) {
        console.error("❌ Error unbanning user:", error);
        return c.json({ error: "Failed to unban user" }, 500);
    }
});
export { userRoutes };
