-- Add banned account fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP WITH TIME ZONE;

-- Create banned_accounts table for detailed ban tracking
CREATE TABLE IF NOT EXISTS banned_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id), -- Nullable for persistent bans
    stripe_account_id TEXT,
    email TEXT,
    ban_reason TEXT NOT NULL,
    ban_type TEXT NOT NULL, -- 'manual', 'stripe_restricted', 'fraud', 'abuse', 'persistent'
    banned_by TEXT, -- Admin user ID who banned them
    evidence TEXT, -- Details about why they were banned
    stripe_restrictions TEXT, -- JSON string of Stripe restrictions
    stripe_disabled_reason TEXT,
    is_active BOOLEAN DEFAULT true, -- Can unban by setting to false
    appeal_status TEXT DEFAULT 'none', -- 'none', 'pending', 'approved', 'denied'
    banned_at TIMESTAMP WITH TIME ZONE NOT NULL,
    unbanned_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Allow null values for user_id (needed for persistent bans)
ALTER TABLE banned_accounts ALTER COLUMN user_id DROP NOT NULL;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_banned_accounts_user_id ON banned_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_banned_accounts_is_active ON banned_accounts(is_active);
CREATE INDEX IF NOT EXISTS idx_banned_accounts_stripe_account_id ON banned_accounts(stripe_account_id);

-- Add comment for documentation
COMMENT ON TABLE banned_accounts IS 'Tracks banned user accounts with detailed ban information and Stripe restrictions';
