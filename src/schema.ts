import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  decimal,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  fullName: text("full_name"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  authProvider: text("auth_provider").notNull(), // Primary/last used provider
  appleUserId: text("apple_user_id"), // Apple provider ID (can be linked to account)
  googleUserId: text("google_user_id"), // Google provider ID (can be linked to account)
  stripeAccountId: text("stripe_account_id"),
  stripeOnboardingCompleted: boolean("stripe_onboarding_completed").default(
    false
  ),
  isBanned: boolean("is_banned").default(false),
  banReason: text("ban_reason"),
  bannedAt: timestamp("banned_at", { withTimezone: true }),
  // Additional fields from your current schema
  faceIdEnabled: boolean("face_id_enabled").default(false),
  safetyPinEnabled: boolean("safety_pin_enabled").default(false),
  safetyPinHash: text("safety_pin_hash"),
  memberSince: timestamp("member_since", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Database indexes for multi-provider authentication performance
export const usersIndexes = {
  appleUserId: "users_apple_user_id_idx",
  googleUserId: "users_google_user_id_idx",
};

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
  stripePaymentMethodType: text("stripe_payment_method_type"), // 'card' | 'paypal' | 'cashapp' | 'us_bank_account' | 'link' | 'apple_pay' | 'google_pay'

  // Timestamps for different states
  completedAt: timestamp("completed_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),

  // Failure details
  failureReason: text("failure_reason"),

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

// Push notification tokens table
export const pushTokens = pgTable("push_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),

  // Token details
  token: text("token").notNull(), // Expo push token
  deviceType: text("device_type").notNull(), // 'ios' | 'android'
  deviceId: text("device_id"), // Unique device identifier

  // Status and management
  isActive: boolean("is_active").default(true),
  lastUsed: timestamp("last_used", { withTimezone: true }),

  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const bannedAccounts = pgTable("banned_accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id),
  stripeAccountId: text("stripe_account_id"),
  email: text("email"),
  banReason: text("ban_reason").notNull(),
  banType: text("ban_type").notNull(), // 'manual', 'stripe_restricted', 'fraud', 'abuse'
  bannedBy: text("banned_by"), // Admin user ID who banned them
  evidence: text("evidence"), // Details about why they were banned

  // Stripe-specific fields
  stripeRestrictions: text("stripe_restrictions"), // JSON string of Stripe restrictions
  stripeDisabledReason: text("stripe_disabled_reason"),

  // Status
  isActive: boolean("is_active").default(true), // Can unban by setting to false
  appealStatus: text("appeal_status").default("none"), // 'none', 'pending', 'approved', 'denied'

  // Timestamps
  bannedAt: timestamp("banned_at", { withTimezone: true }).notNull(),
  unbannedAt: timestamp("unbanned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
