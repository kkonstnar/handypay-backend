import { betterAuth } from "better-auth";
import { expo } from "@better-auth/expo";
import { Pool } from "pg";

// Factory function to create auth instance with environment variables
export function createAuth(env: any) {
  console.log("Creating auth instance...");
  // Try Cloudflare env first, then fall back to process.env for local development
  const DATABASE_URL = env?.DATABASE_URL || process.env.DATABASE_URL;
  const GOOGLE_CLIENT_ID = env?.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = env?.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const APPLE_CLIENT_ID = env?.APPLE_CLIENT_ID || process.env.APPLE_CLIENT_ID;
  const APPLE_CLIENT_SECRET = env?.APPLE_CLIENT_SECRET || process.env.APPLE_CLIENT_SECRET;
  const BETTER_AUTH_URL = env?.BETTER_AUTH_URL || process.env.BETTER_AUTH_URL;
  const BETTER_AUTH_SECRET = env?.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET;

  console.log("Environment variables loaded:");
  console.log("- DATABASE_URL:", !!DATABASE_URL);
  console.log("- GOOGLE_CLIENT_ID:", !!GOOGLE_CLIENT_ID);
  console.log("- GOOGLE_CLIENT_SECRET:", !!GOOGLE_CLIENT_SECRET);
  console.log("- BETTER_AUTH_URL:", BETTER_AUTH_URL);
  console.log("- BETTER_AUTH_SECRET:", !!BETTER_AUTH_SECRET);

  if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID is required");
  if (!GOOGLE_CLIENT_SECRET) throw new Error("GOOGLE_CLIENT_SECRET is required");
  if (!APPLE_CLIENT_ID) throw new Error("APPLE_CLIENT_ID is required");
  if (!APPLE_CLIENT_SECRET) throw new Error("APPLE_CLIENT_SECRET is required");
  if (!BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL is required");
  if (!BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is required");

  return betterAuth({
    database: new Pool({
      connectionString: DATABASE_URL,
    }),
    plugins: [expo()],
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: {
      google: {
        clientId: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        redirectURI: BETTER_AUTH_URL + "/auth/callback/google",
        scopes: ["openid", "profile", "email"],
        prompt: "select_account",
      },
      apple: {
        clientId: APPLE_CLIENT_ID,
        clientSecret: APPLE_CLIENT_SECRET,
        redirectURI: BETTER_AUTH_URL + "/auth/callback/apple",
        scopes: ["name", "email"],
      },
    },
    baseURL: BETTER_AUTH_URL,
    secret: BETTER_AUTH_SECRET,
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
  },
  trustedOrigins: [
    "handypay://",
    "https://handypay-backend.handypay.workers.dev",
    "exp://*",
  ],
  callbacks: {
    async redirect({ url, baseUrl }: { url: string; baseUrl: string }) {
      console.log("Better Auth redirect callback:", { url, baseUrl });

      // Check if this is a mobile redirect (contains handypay://)
      if (url.includes("handypay://")) {
        console.log("Mobile redirect detected:", url);
        return url; // Use the original mobile redirect URL
      }

      // If coming from OAuth callback and no mobile redirect, default to mobile app
      if (url.includes("/callback/google") || url.includes("/callback/apple")) {
        console.log("OAuth callback without mobile redirect, using default");
        return "handypay://auth/callback";
      }

      return url.startsWith(baseUrl) ? url : baseUrl;
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
      },
    },
  },
});
}
