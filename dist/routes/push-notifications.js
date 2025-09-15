import { Hono } from "hono";
import { eq, and, desc, isNull } from "drizzle-orm";
import { pushTokens } from "../schema.js";
import { db, initializeDatabase } from "../db.js";
const pushNotificationRoutes = new Hono();
// Store or update a push token for a user
pushNotificationRoutes.post("/token", async (c) => {
    try {
        console.log("📱 Storing push token...");
        const body = await c.req.json();
        const { userId, token, deviceType, deviceId } = body;
        if (!userId || !token || !deviceType) {
            return c.json({
                success: false,
                error: "Missing required fields: userId, token, deviceType",
            }, 400);
        }
        // Validate device type
        if (!["ios", "android"].includes(deviceType)) {
            return c.json({
                success: false,
                error: "Invalid deviceType. Must be 'ios' or 'android'",
            }, 400);
        }
        initializeDatabase(c.env);
        // Check if token already exists for this user/device
        const existingToken = await db
            .select()
            .from(pushTokens)
            .where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)))
            .limit(1);
        if (existingToken.length > 0) {
            // Update existing token (mark as active and update last used)
            await db
                .update(pushTokens)
                .set({
                isActive: true,
                lastUsed: new Date(),
                updatedAt: new Date(),
                deviceId: deviceId || existingToken[0].deviceId,
            })
                .where(eq(pushTokens.id, existingToken[0].id));
            console.log("✅ Existing push token updated for user:", userId);
            return c.json({
                success: true,
                message: "Push token updated successfully",
                tokenId: existingToken[0].id,
            });
        }
        else {
            // Deactivate any existing tokens for this device (if deviceId provided)
            if (deviceId) {
                await db
                    .update(pushTokens)
                    .set({
                    isActive: false,
                    updatedAt: new Date(),
                })
                    .where(and(eq(pushTokens.userId, userId), eq(pushTokens.deviceId, deviceId), eq(pushTokens.isActive, true)));
            }
            // Create new token record
            const tokenId = `push_${userId}_${Date.now()}_${Math.random()
                .toString(36)
                .substr(2, 9)}`;
            await db.insert(pushTokens).values({
                id: tokenId,
                userId,
                token,
                deviceType,
                deviceId,
                isActive: true,
                lastUsed: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            console.log("✅ New push token stored for user:", userId);
            return c.json({
                success: true,
                message: "Push token stored successfully",
                tokenId,
            });
        }
    }
    catch (error) {
        console.error("❌ Error storing push token:", error);
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : "Failed to store push token",
        }, 500);
    }
});
// Deactivate a push token (when user logs out or uninstalls app)
pushNotificationRoutes.post("/token/deactivate", async (c) => {
    try {
        console.log("🚫 Deactivating push token...");
        const body = await c.req.json();
        const { userId, token } = body;
        if (!userId || !token) {
            return c.json({
                success: false,
                error: "Missing required fields: userId, token",
            }, 400);
        }
        initializeDatabase(c.env);
        const result = await db
            .update(pushTokens)
            .set({
            isActive: false,
            updatedAt: new Date(),
        })
            .where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)));
        console.log("✅ Push token deactivated for user:", userId);
        return c.json({
            success: true,
            message: "Push token deactivated successfully",
        });
    }
    catch (error) {
        console.error("❌ Error deactivating push token:", error);
        return c.json({
            success: false,
            error: error instanceof Error
                ? error.message
                : "Failed to deactivate push token",
        }, 500);
    }
});
// Send push notification to a user
pushNotificationRoutes.post("/send", async (c) => {
    try {
        console.log("📤 Sending push notification...");
        const body = await c.req.json();
        const { userId, title, body: notificationBody, data } = body;
        if (!userId || !title || !notificationBody) {
            return c.json({
                success: false,
                error: "Missing required fields: userId, title, body",
            }, 400);
        }
        initializeDatabase(c.env);
        // Get active push tokens for the user
        const userTokens = await db
            .select()
            .from(pushTokens)
            .where(and(eq(pushTokens.userId, userId), eq(pushTokens.isActive, true)));
        if (userTokens.length === 0) {
            console.log("⚠️ No active push tokens found for user:", userId);
            return c.json({
                success: false,
                error: "No active push tokens found for user",
            }, 404);
        }
        // Prepare Expo push notification payload
        const expoPushTokens = userTokens.map((t) => t.token);
        const message = {
            to: expoPushTokens,
            title,
            body: notificationBody,
            data: data || {},
            sound: "default",
            priority: "default",
        };
        // Send to Expo Push Service
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
            console.error("❌ Expo push service error:", errorText);
            return c.json({
                success: false,
                error: "Failed to send push notification",
                expoError: errorText,
            }, 500);
        }
        const expoResult = await expoResponse.json();
        // Update lastUsed timestamp for sent tokens
        const tokenIds = userTokens.map((t) => t.id);
        await db
            .update(pushTokens)
            .set({
            lastUsed: new Date(),
            updatedAt: new Date(),
        })
            .where(and(eq(pushTokens.userId, userId), eq(pushTokens.isActive, true)));
        console.log("✅ Push notification sent to", expoPushTokens.length, "devices");
        return c.json({
            success: true,
            message: "Push notification sent successfully",
            sentTo: expoPushTokens.length,
            expoResult,
        });
    }
    catch (error) {
        console.error("❌ Error sending push notification:", error);
        return c.json({
            success: false,
            error: error instanceof Error
                ? error.message
                : "Failed to send push notification",
        }, 500);
    }
});
// Send push notification to all users (admin/broadcast)
pushNotificationRoutes.post("/broadcast", async (c) => {
    try {
        console.log("📢 Broadcasting push notification...");
        const body = await c.req.json();
        const { title, body: notificationBody, data, targetUsers } = body;
        if (!title || !notificationBody) {
            return c.json({
                success: false,
                error: "Missing required fields: title, body",
            }, 400);
        }
        initializeDatabase(c.env);
        // Get active push tokens (for all users or specific users)
        let query = db
            .select({
            token: pushTokens.token,
            userId: pushTokens.userId,
        })
            .from(pushTokens)
            .where(eq(pushTokens.isActive, true));
        if (targetUsers && Array.isArray(targetUsers)) {
            // For specific users, we'll need to filter by user IDs
            const userTokens = [];
            for (const userId of targetUsers) {
                const tokens = await db
                    .select({
                    token: pushTokens.token,
                    userId: pushTokens.userId,
                })
                    .from(pushTokens)
                    .where(and(eq(pushTokens.userId, userId), eq(pushTokens.isActive, true)));
                userTokens.push(...tokens);
            }
            if (userTokens.length === 0) {
                return c.json({
                    success: false,
                    error: "No active push tokens found for specified users",
                }, 404);
            }
            const expoPushTokens = userTokens.map((t) => t.token);
            const message = {
                to: expoPushTokens,
                title,
                body: notificationBody,
                data: data || {},
                sound: "default",
                priority: "default",
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
                console.error("❌ Expo broadcast error:", errorText);
                return c.json({
                    success: false,
                    error: "Failed to broadcast push notification",
                    expoError: errorText,
                }, 500);
            }
            const expoResult = await expoResponse.json();
            console.log("✅ Broadcast sent to", expoPushTokens.length, "devices");
            return c.json({
                success: true,
                message: "Broadcast notification sent successfully",
                sentTo: expoPushTokens.length,
                expoResult,
            });
        }
        else {
            // For all users, get all active tokens
            const allTokens = await query;
            const expoPushTokens = allTokens.map((t) => t.token);
            if (expoPushTokens.length === 0) {
                return c.json({
                    success: false,
                    error: "No active push tokens found",
                }, 404);
            }
            const message = {
                to: expoPushTokens,
                title,
                body: notificationBody,
                data: data || {},
                sound: "default",
                priority: "default",
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
                console.error("❌ Expo broadcast error:", errorText);
                return c.json({
                    success: false,
                    error: "Failed to broadcast push notification",
                    expoError: errorText,
                }, 500);
            }
            const expoResult = await expoResponse.json();
            console.log("✅ Broadcast sent to", expoPushTokens.length, "devices");
            return c.json({
                success: true,
                message: "Broadcast notification sent successfully",
                sentTo: expoPushTokens.length,
                expoResult,
            });
        }
    }
    catch (error) {
        console.error("❌ Error broadcasting push notification:", error);
        return c.json({
            success: false,
            error: error instanceof Error
                ? error.message
                : "Failed to broadcast push notification",
        }, 500);
    }
});
// Get user's push token status
pushNotificationRoutes.get("/tokens/:userId", async (c) => {
    try {
        const userId = c.req.param("userId");
        if (!userId) {
            return c.json({
                success: false,
                error: "User ID is required",
            }, 400);
        }
        // Check ownership (users can only see their own tokens)
        const authenticatedUser = c.get("user");
        if (authenticatedUser?.id !== userId) {
            return c.json({
                success: false,
                error: "Unauthorized to view these tokens",
            }, 403);
        }
        initializeDatabase(c.env);
        const userTokens = await db
            .select({
            id: pushTokens.id,
            deviceType: pushTokens.deviceType,
            deviceId: pushTokens.deviceId,
            isActive: pushTokens.isActive,
            lastUsed: pushTokens.lastUsed,
            createdAt: pushTokens.createdAt,
        })
            .from(pushTokens)
            .where(eq(pushTokens.userId, userId))
            .orderBy(desc(pushTokens.createdAt));
        return c.json({
            success: true,
            tokens: userTokens,
        });
    }
    catch (error) {
        console.error("❌ Error fetching push tokens:", error);
        return c.json({
            success: false,
            error: error instanceof Error
                ? error.message
                : "Failed to fetch push tokens",
        }, 500);
    }
});
// Clean up inactive tokens (admin endpoint)
pushNotificationRoutes.post("/cleanup", async (c) => {
    try {
        console.log("🧹 Cleaning up inactive push tokens...");
        initializeDatabase(c.env);
        // Deactivate tokens older than 90 days that haven't been used
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const result = await db
            .update(pushTokens)
            .set({
            isActive: false,
            updatedAt: new Date(),
        })
            .where(and(eq(pushTokens.isActive, true), isNull(pushTokens.lastUsed)));
        console.log("✅ Push token cleanup completed");
        return c.json({
            success: true,
            message: "Inactive push tokens cleaned up successfully",
        });
    }
    catch (error) {
        console.error("❌ Error cleaning up push tokens:", error);
        return c.json({
            success: false,
            error: error instanceof Error
                ? error.message
                : "Failed to clean up push tokens",
        }, 500);
    }
});
// Send notification to specific user for payments/payouts/expired links
pushNotificationRoutes.post("/send", async (c) => {
    try {
        const body = await c.req.json();
        const { userId, type, title, body: notificationBody, data } = body;
        if (!userId || !type || !title || !notificationBody) {
            return c.json({
                success: false,
                error: "Missing required fields: userId, type, title, body",
            }, 400);
        }
        initializeDatabase(c.env);
        // Get user's active push tokens
        const userTokens = await db
            .select({
            token: pushTokens.token,
        })
            .from(pushTokens)
            .where(and(eq(pushTokens.userId, userId), eq(pushTokens.isActive, true)));
        if (userTokens.length === 0) {
            console.log(`⚠️ No active push tokens found for user ${userId}`);
            return c.json({
                success: true,
                message: "No active push tokens found for user",
                sentTo: 0,
            });
        }
        const expoPushTokens = userTokens.map((t) => t.token);
        // Customize notification based on type
        let notificationData = {
            type,
            ...data,
        };
        let priority = "default";
        let sound = "default";
        // Customize based on notification type
        switch (type) {
            case "payment_received":
                priority = "high";
                notificationData = { ...notificationData, action: "view_payment" };
                break;
            case "payout_completed":
                priority = "high";
                notificationData = { ...notificationData, action: "view_payout" };
                break;
            case "payment_link_expired":
                priority = "default";
                notificationData = { ...notificationData, action: "create_new_link" };
                break;
            case "qr_expired":
                priority = "default";
                notificationData = { ...notificationData, action: "generate_new_qr" };
                break;
            default:
                break;
        }
        // Send push notification via Expo
        const message = {
            to: expoPushTokens,
            title,
            body: notificationBody,
            data: notificationData,
            sound,
            priority,
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
            console.error("❌ Failed to send notification:", errorText);
            return c.json({
                success: false,
                error: "Failed to send push notification",
                expoError: errorText,
            }, 500);
        }
        const expoResult = await expoResponse.json();
        console.log(`✅ Notification sent to ${expoPushTokens.length} devices for user ${userId}`, expoResult);
        return c.json({
            success: true,
            message: `Notification sent successfully to ${expoPushTokens.length} devices`,
            sentTo: expoPushTokens.length,
            type,
            expoResult,
        });
    }
    catch (error) {
        console.error("❌ Error sending notification:", error);
        return c.json({
            success: false,
            error: error instanceof Error
                ? error.message
                : "Failed to send notification",
        }, 500);
    }
});
export { pushNotificationRoutes };
