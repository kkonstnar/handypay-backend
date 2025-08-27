import { betterAuth } from "better-auth";

export const auth = betterAuth({
  database: process.env.DATABASE_URL!,
  emailAndPassword: {
    enabled: true
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }
  },
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  trustedOrigins: [
    "handypay://",
    "https://handypay-backend.onrender.com"
  ]
});