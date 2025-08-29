import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
export const users = pgTable("users", {
    id: text("id").primaryKey(),
    email: text("email"),
    fullName: text("full_name"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    authProvider: text("auth_provider").notNull(),
    appleUserId: text("apple_user_id"),
    googleUserId: text("google_user_id"),
    stripeAccountId: text("stripe_account_id"), // Added for Stripe Connect
    stripeOnboardingCompleted: boolean("stripe_onboarding_completed").default(false), // Added for tracking completion
    memberSince: timestamp("member_since", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
