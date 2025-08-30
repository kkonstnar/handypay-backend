import { pgTable, text, timestamp, boolean, integer, decimal, } from "drizzle-orm/pg-core";
export const users = pgTable("users", {
    id: text("id").primaryKey(),
    email: text("email"),
    fullName: text("full_name"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    authProvider: text("auth_provider").notNull(),
    appleUserId: text("apple_user_id"),
    googleUserId: text("google_user_id"),
    stripeAccountId: text("stripe_account_id"),
    stripeOnboardingCompleted: boolean("stripe_onboarding_completed").default(false),
    memberSince: timestamp("member_since", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
// Database indexes for multi-provider authentication performance
export const usersIndexes = {
    appleUserId: "users_apple_user_id_idx",
    googleUserId: "users_google_user_id_idx",
};
;
export const transactions = pgTable("transactions", {
    id: text("id").primaryKey(),
    userId: text("user_id")
        .notNull()
        .references(() => users.id),
    // Transaction details
    type: text("type").notNull(), // 'payment' | 'received' | 'withdrawal' | 'card_payment' | 'refund' | 'qr_payment' | 'payment_link'
    amount: integer("amount").notNull(), // Amount in cents
    currency: text("currency").default("JMD"),
    description: text("description").notNull(),
    merchant: text("merchant"),
    // Status and dates
    status: text("status").notNull().default("pending"), // 'pending' | 'completed' | 'failed' | 'cancelled'
    date: timestamp("date", { withTimezone: true }).notNull(),
    // Stripe related fields
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeInvoiceId: text("stripe_invoice_id"),
    stripePaymentLinkId: text("stripe_payment_link_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    // Customer details (for received payments)
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    customerPhone: text("customer_phone"),
    // Payment method details
    paymentMethod: text("payment_method"), // 'qr_code' | 'payment_link' | 'card'
    cardLast4: text("card_last_4"),
    cardBrand: text("card_brand"),
    // Additional metadata
    metadata: text("metadata"), // JSON string for additional data
    notes: text("notes"),
    // QR Code for payment links
    qrCode: text("qr_code"), // Base64 encoded QR code image
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
export const payoutRules = pgTable("payout_rules", {
    id: text("id").primaryKey().default("default_rule"),
    ruleName: text("rule_name").notNull().default("Standard Payout Rule"),
    firstTransactionDelayDays: integer("first_transaction_delay_days").default(7),
    subsequentDelayDaysMin: integer("subsequent_delay_days_min").default(2),
    subsequentDelayDaysMax: integer("subsequent_delay_days_max").default(5),
    minimumPayoutAmount: decimal("minimum_payout_amount", {
        precision: 10,
        scale: 2,
    }).default("0.00"),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
export const payouts = pgTable("payouts", {
    id: text("id").primaryKey(),
    userId: text("user_id")
        .notNull()
        .references(() => users.id),
    // Payout details
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").default("JMD"),
    status: text("status").notNull().default("pending"), // 'pending' | 'processing' | 'completed' | 'failed'
    // Payout scheduling
    payoutDate: timestamp("payout_date", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    // Bank account details
    bankAccount: text("bank_account"), // Last 4 digits or full account details
    stripePayoutId: text("stripe_payout_id"), // Stripe payout ID
    // Fees and processing
    feeAmount: decimal("fee_amount", { precision: 10, scale: 2 }).default("0.00"),
    // Description and notes
    description: text("description"),
    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
