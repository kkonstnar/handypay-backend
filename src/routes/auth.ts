import { Hono } from "hono";
import { db } from "../db.js";
import { users, transactions, payouts } from "../schema.js";
import { eq } from "drizzle-orm";

const authRoutes = new Hono();

// Google OAuth initiation endpoint (redirects to Google)
authRoutes.get("/google", async (c) => {
  try {
    const state = c.req.query("state");
    const redirectUri = c.req.query("redirect_uri");

    if (!redirectUri) {
      return c.json({ error: "Missing redirect_uri parameter" }, 400);
    }

    console.log("🔄 Initiating Google OAuth flow:", { state, redirectUri });

    // Google OAuth parameters
    const googleAuthUrl = new URL(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    googleAuthUrl.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
    googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
    googleAuthUrl.searchParams.set("response_type", "code");
    googleAuthUrl.searchParams.set("scope", "openid profile email");
    googleAuthUrl.searchParams.set("access_type", "offline");
    googleAuthUrl.searchParams.set("prompt", "select_account");

    if (state) {
      googleAuthUrl.searchParams.set("state", state);
    }

    console.log("🔗 Redirecting to Google OAuth:", googleAuthUrl.toString());

    // Redirect to Google OAuth
    return c.redirect(googleAuthUrl.toString());
  } catch (error) {
    console.error("❌ Google OAuth initiation error:", error);
    return c.json({ error: "Failed to initiate Google OAuth" }, 500);
  }
});

// Google OAuth callback endpoint (handles redirect from Google)
authRoutes.get("/google/callback", async (c) => {
  try {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    console.log("🔄 Google OAuth callback received:", {
      code: !!code,
      state,
      error,
    });

    if (error) {
      console.error("❌ Google OAuth error:", error);
      // Redirect back to app with error
      return c.redirect(`handypay://oauth?error=${encodeURIComponent(error)}`);
    }

    if (code) {
      console.log("✅ Google OAuth code received, redirecting to app...");

      // Redirect back to app with the authorization code
      return c.redirect(
        `handypay://oauth?code=${encodeURIComponent(
          code
        )}&state=${encodeURIComponent(state || "")}`
      );
    }

    console.error("❌ No authorization code or error received");
    return c.redirect(`handypay://oauth?error=no_code`);
  } catch (error) {
    console.error("❌ Google OAuth callback error:", error);
    return c.redirect(`handypay://oauth?error=callback_error`);
  }
});

// Test authentication endpoint for TestFlight reviewers
authRoutes.post("/test-login", async (c) => {
  try {
    console.log("🧪 Test authentication requested");

    // Use predefined test account credentials
    const testUser = {
      id: "testflight_user_001",
      email: "testflight@handypay.com",
      fullName: "TestFlight User",
      firstName: "TestFlight",
      lastName: "User",
      authProvider: "test",
      memberSince: new Date().toISOString(),
      stripeAccountId: null, // No Stripe account ID for test account
      stripeOnboardingCompleted: true, // Mark as completed for demo
      faceIdEnabled: false,
      safetyPinEnabled: false,
    };

    console.log("🧪 Using test account:", testUser.id);

    // Check if test user exists, create if not
    const existingUser = await db
      .select({
        id: users.id,
        stripeAccountId: users.stripeAccountId,
        stripeOnboardingCompleted: users.stripeOnboardingCompleted,
      })
      .from(users)
      .where(eq(users.id, testUser.id))
      .limit(1);

    if (existingUser.length === 0) {
      // Create test user in database
      await db.insert(users).values({
        id: testUser.id,
        email: testUser.email,
        fullName: testUser.fullName,
        firstName: testUser.firstName,
        lastName: testUser.lastName,
        authProvider: testUser.authProvider,
        memberSince: new Date(testUser.memberSince),
        stripeAccountId: testUser.stripeAccountId || null,
        stripeOnboardingCompleted: testUser.stripeOnboardingCompleted,
        faceIdEnabled: testUser.faceIdEnabled,
        safetyPinEnabled: testUser.safetyPinEnabled,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log("✅ Test user created in database");
    } else {
      console.log("✅ Test user already exists in database");
    }

    // Initialize test data for demo purposes
    await initializeTestData(testUser.id);

    return c.json({
      success: true,
      user: testUser,
      message: "Test authentication successful",
    });
  } catch (error) {
    console.error("❌ Test authentication error:", error);
    return c.json(
      {
        success: false,
        error: "Test authentication failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// Google OAuth token exchange endpoint (for mobile app)
authRoutes.post("/google/token", async (c) => {
  try {
    const { code, redirectUri, codeVerifier } = await c.req.json();

    console.log("🔄 Processing Google OAuth token exchange");

    if (!code) {
      return c.json({ error: "Authorization code is required" }, 400);
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri || "handypay://",
        ...(codeVerifier && { code_verifier: codeVerifier }), // Add code verifier for PKCE
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error(
        "Google token exchange failed - Status:",
        tokenResponse.status
      );
      console.error("Google token exchange failed - Response:", errorText);
      return c.json({ error: "Failed to exchange authorization code" }, 400);
    }

    const tokenData = await tokenResponse.json();
    console.log("Google tokens received:", {
      access_token: !!tokenData.access_token,
      refresh_token: !!tokenData.refresh_token,
      expires_in: tokenData.expires_in,
    });

    // Get user info from Google
    const userInfoResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      }
    );

    if (!userInfoResponse.ok) {
      console.error("Failed to get user info from Google");
      return c.json({ error: "Failed to get user information" }, 400);
    }

    const userInfo = await userInfoResponse.json();
    console.log("Google user info:", {
      id: userInfo.id,
      email: userInfo.email,
      name: userInfo.name,
      verified: userInfo.verified_email,
    });

    return c.json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type,
      user: userInfo,
    });
  } catch (error) {
    console.error("❌ Google token exchange error:", error);
    return c.json(
      {
        error: "Google authentication failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// Helper function to initialize test data for demo purposes
async function initializeTestData(userId: string): Promise<void> {
  try {
    console.log(`🧪 Initializing test data for user: ${userId}`);

    // Check if test transactions already exist
    const existingTransactions = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .limit(1);

    if (existingTransactions.length > 0) {
      console.log("✅ Test data already exists for user");
      return;
    }

    // Create sample transactions for demo
    const sampleTransactions = [
      {
        id: `tx_test_001_${userId}`,
        userId,
        type: "received",
        amount: 2500, // $25.00
        currency: "JMD",
        description: "Payment for lawn mowing service",
        merchant: null,
        status: "completed",
        date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        stripePaymentIntentId: "pi_test_demo_001",
        customerName: "John Smith",
        customerEmail: "john@example.com",
        paymentMethod: "qr_code",
        cardLast4: null,
        qrCode: "demo_qr_001",
        expiresAt: null,
      },
      {
        id: `tx_test_002_${userId}`,
        userId,
        type: "received",
        amount: 1500, // $15.00
        currency: "JMD",
        description: "Tutoring session payment",
        merchant: null,
        status: "completed",
        date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        stripePaymentIntentId: "pi_test_demo_002",
        customerName: "Sarah Johnson",
        customerEmail: "sarah@example.com",
        paymentMethod: "payment_link",
        cardLast4: null,
        qrCode: null,
        expiresAt: null,
      },
      {
        id: `tx_test_003_${userId}`,
        userId,
        type: "received",
        amount: 5000, // $50.00
        currency: "JMD",
        description: "House cleaning service",
        merchant: null,
        status: "completed",
        date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 1 week ago
        stripePaymentIntentId: "pi_test_demo_003",
        customerName: "Mike Wilson",
        customerEmail: "mike@example.com",
        paymentMethod: "qr_code",
        cardLast4: null,
        qrCode: "demo_qr_002",
        expiresAt: null,
      },
      {
        id: `tx_test_004_${userId}`,
        userId,
        type: "payment_link",
        amount: 3000, // $30.00
        currency: "JMD",
        description: "Photography session",
        merchant: null,
        status: "pending",
        date: new Date(),
        stripePaymentIntentId: null,
        stripePaymentLinkId: "plink_test_demo_001",
        customerName: null,
        customerEmail: "client@demo.com",
        paymentMethod: "payment_link",
        cardLast4: null,
        qrCode: null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Expires in 24 hours
      },
    ];

    // Insert sample transactions
    for (const tx of sampleTransactions) {
      await db.insert(transactions).values({
        ...tx,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    console.log(
      `✅ Created ${sampleTransactions.length} sample transactions for test user`
    );

    // Create a sample payout for demo
    const samplePayout = {
      id: `payout_test_001_${userId}`,
      userId,
      amount: "25.00",
      currency: "JMD",
      status: "completed",
      payoutDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
      processedAt: new Date(
        Date.now() - 3 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000
      ), // Processed 2 hours later
      bankAccount: "****8689",
      stripePayoutId: "po_test_demo_001",
      description: "Weekly payout",
      feeAmount: "1.25",
    };

    await db.insert(payouts).values({
      ...samplePayout,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log("✅ Created sample payout for test user");
  } catch (error) {
    console.error("❌ Error initializing test data:", error);
    // Don't throw error - test data initialization failure shouldn't break authentication
  }
}

export { authRoutes };
