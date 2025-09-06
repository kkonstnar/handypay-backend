import { betterAuth } from "better-auth";
import { expo } from "@better-auth/expo";
import { Pool } from "pg";

export const auth = betterAuth({
  database: new Pool({
    connectionString: process.env.DATABASE_URL!,
  }),
  plugins: [expo()],
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectURI:
        (process.env.BETTER_AUTH_URL || "http://localhost:3000") +
        "/auth/callback/google",
      scopes: ["openid", "profile", "email"],
      prompt: "select_account",
    },
    apple: {
      clientId: process.env.APPLE_CLIENT_ID!,
      clientSecret: process.env.APPLE_CLIENT_SECRET!,
      redirectURI:
        (process.env.BETTER_AUTH_URL || "http://localhost:3000") +
        "/auth/callback/apple",
      scopes: ["name", "email"],
    },
  },
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET!,
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
