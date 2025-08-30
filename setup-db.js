import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// PostgreSQL connection
const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function setupDatabase() {
  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL database');

    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT,
        full_name TEXT,
        first_name TEXT,
        last_name TEXT,
        auth_provider TEXT NOT NULL,
        apple_user_id TEXT,
        google_user_id TEXT,
        stripe_account_id TEXT,
        stripe_onboarding_completed BOOLEAN DEFAULT FALSE,
        face_id_enabled BOOLEAN DEFAULT FALSE,
        safety_pin_enabled BOOLEAN DEFAULT FALSE,
        safety_pin_hash TEXT,
        member_since TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Create transactions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT DEFAULT 'JMD',
        description TEXT NOT NULL,
        merchant TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        date TIMESTAMP WITH TIME ZONE NOT NULL,
        stripe_payment_intent_id TEXT,
        stripe_invoice_id TEXT,
        stripe_payment_link_id TEXT,
        stripe_checkout_session_id TEXT,
        customer_name TEXT,
        customer_email TEXT,
        customer_phone TEXT,
        payment_method TEXT,
        card_last_4 TEXT,
        card_brand TEXT,
        metadata TEXT,
        notes TEXT,
        qr_code TEXT,
        expires_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Create payout rules table
    await client.query(`
      CREATE TABLE IF NOT EXISTS payout_rules (
        id TEXT PRIMARY KEY DEFAULT 'default_rule',
        rule_name TEXT NOT NULL DEFAULT 'Standard Payout Rule',
        first_transaction_delay_days INTEGER DEFAULT 7,
        subsequent_delay_days_min INTEGER DEFAULT 2,
        subsequent_delay_days_max INTEGER DEFAULT 5,
        minimum_payout_amount DECIMAL(10,2) DEFAULT 0.00,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Create payouts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS payouts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        amount DECIMAL(10,2) NOT NULL,
        currency TEXT DEFAULT 'JMD',
        status TEXT NOT NULL DEFAULT 'pending',
        payout_date TIMESTAMP WITH TIME ZONE NOT NULL,
        processed_at TIMESTAMP WITH TIME ZONE,
        bank_account TEXT,
        stripe_payout_id TEXT,
        fee_amount DECIMAL(10,2) DEFAULT 0.00,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Insert default payout rule if it doesn't exist
    await client.query(`
      INSERT INTO payout_rules (id, rule_name, first_transaction_delay_days, subsequent_delay_days_min, subsequent_delay_days_max, minimum_payout_amount, is_active)
      VALUES ('default_rule', 'Standard Payout Rule', 7, 2, 5, 0.00, TRUE)
      ON CONFLICT (id) DO NOTHING
    `);

    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_apple_user_id ON users(apple_user_id);
      CREATE INDEX IF NOT EXISTS idx_users_google_user_id ON users(google_user_id);
      CREATE INDEX IF NOT EXISTS idx_users_stripe_account_id ON users(stripe_account_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
      CREATE INDEX IF NOT EXISTS idx_payouts_user_id ON payouts(user_id);
      CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
    `);

    console.log('✅ Database setup completed successfully');
  } catch (error) {
    console.error('❌ Database setup error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

setupDatabase();

