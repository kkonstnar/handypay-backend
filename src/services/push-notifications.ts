import { eq, and } from "drizzle-orm";
import { pushTokens, users } from "../schema.js";
import { db, initializeDatabase } from "../db.js";

/**
 * Send push notification to a specific user
 */
export async function sendPushNotificationToUser(
  userId: string,
  title: string,
  body: string,
  data?: any,
  env?: any
): Promise<{ success: boolean; sentTo?: number; error?: string }> {
  try {
    console.log(`📤 Sending push notification to user ${userId}: ${title}`);

    if (env) {
      initializeDatabase(env);
    }

    // Get active push tokens for the user
    const userTokens = await db
      .select()
      .from(pushTokens)
      .where(and(eq(pushTokens.userId, userId), eq(pushTokens.isActive, true)));

    if (userTokens.length === 0) {
      console.log(`⚠️ No active push tokens found for user ${userId}`);
      return { success: false, error: "No active push tokens found" };
    }

    const expoPushTokens = userTokens.map((t) => t.token);

    const message = {
      to: expoPushTokens,
      title,
      body,
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
      return { success: false, error: `Expo API error: ${errorText}` };
    }

    const expoResult = await expoResponse.json();

    // Update lastUsed timestamp for sent tokens
    await db
      .update(pushTokens)
      .set({
        lastUsed: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(pushTokens.userId, userId), eq(pushTokens.isActive, true)));

    console.log(
      `✅ Push notification sent to ${expoPushTokens.length} devices for user ${userId}`
    );
    return { success: true, sentTo: expoPushTokens.length };
  } catch (error) {
    console.error(
      `❌ Error sending push notification to user ${userId}:`,
      error
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Send payment received notification
 */
export async function sendPaymentReceivedNotification(
  userId: string,
  amount: number,
  currency: string = "JMD",
  senderName?: string,
  env?: any
): Promise<{ success: boolean; sentTo?: number; error?: string }> {
  const title = "Payment Received";
  const formattedAmount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency === "JMD" ? "JMD" : "USD",
  }).format(amount / 100); // Convert cents to dollars

  // Get user's name to avoid showing "from yourself"
  let showSenderName = false;
  if (senderName) {
    try {
      await initializeDatabase(env);
      const userRecord = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (userRecord.length > 0) {
        const user = userRecord[0];
        const userName =
          user.fullName ||
          `${user.firstName || ""} ${user.lastName || ""}`.trim();

        // Only show sender name if it's different from the account owner
        showSenderName = senderName.toLowerCase() !== userName.toLowerCase();
      } else {
        // If we can't find the user, show sender name to be safe
        showSenderName = true;
      }
    } catch (error) {
      console.warn(
        "Warning: Could not fetch user for notification comparison:",
        error
      );
      // If there's an error, show sender name to be safe
      showSenderName = true;
    }
  }

  const body = showSenderName
    ? `You received ${formattedAmount} from ${senderName}`
    : `You received ${formattedAmount}`;

  return sendPushNotificationToUser(
    userId,
    title,
    body,
    {
      type: "payment_received",
      amount,
      currency,
      senderName,
      timestamp: new Date().toISOString(),
    },
    env
  );
}

/**
 * Send payout processed notification
 */
export async function sendPayoutProcessedNotification(
  userId: string,
  amount: number,
  currency: string = "JMD",
  env?: any
): Promise<{ success: boolean; sentTo?: number; error?: string }> {
  const title = "Payout Processed";
  const formattedAmount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency === "JMD" ? "JMD" : "USD",
  }).format(amount / 100);

  const body = `Your payout of ${formattedAmount} has been processed and sent to your bank account.`;

  return sendPushNotificationToUser(
    userId,
    title,
    body,
    {
      type: "payout_processed",
      amount,
      currency,
      timestamp: new Date().toISOString(),
    },
    env
  );
}

/**
 * Send transaction failed notification
 */
export async function sendTransactionFailedNotification(
  userId: string,
  reason: string = "Transaction failed",
  env?: any
): Promise<{ success: boolean; sentTo?: number; error?: string }> {
  const title = "Transaction Failed";
  const body = reason;

  return sendPushNotificationToUser(
    userId,
    title,
    body,
    {
      type: "transaction_failed",
      reason,
      timestamp: new Date().toISOString(),
    },
    env
  );
}

/**
 * Send welcome notification when user completes onboarding
 */
export async function sendWelcomeNotification(
  userId: string,
  userName?: string,
  env?: any
): Promise<{ success: boolean; sentTo?: number; error?: string }> {
  const title = "Welcome to HandyPay";
  const body = userName
    ? `Hi ${userName}! You're all set up and ready to start accepting payments.`
    : "You're all set up and ready to start accepting payments!";

  return sendPushNotificationToUser(
    userId,
    title,
    body,
    {
      type: "welcome",
      timestamp: new Date().toISOString(),
    },
    env
  );
}
