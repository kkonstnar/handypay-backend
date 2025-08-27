import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "pg";

export const auth = betterAuth({
  database: {
    provider: "postgres",
    url: process.env.DATABASE_URL!
  },
  emailAndPassword: {
    enabled: true
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    // Apple OAuth is optional for now
    ...(process.env.APPLE_CLIENT_ID && {
      apple: {
        clientId: process.env.APPLE_CLIENT_ID,
        clientSecret: process.env.APPLE_CLIENT_SECRET!,
      }
    })
  },
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  trustedOrigins: [
    "handypay://",
    "https://handypay-backend.onrender.com"
  ]
});