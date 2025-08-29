const Database = require('better-sqlite3');
const db = new Database('./dev.db');

// Create users table
db.exec(`
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
    member_since TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

// Create indexes for better performance
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_users_apple_user_id ON users(apple_user_id);
  CREATE INDEX IF NOT EXISTS idx_users_google_user_id ON users(google_user_id);
  CREATE INDEX IF NOT EXISTS idx_users_stripe_account_id ON users(stripe_account_id);
`);

console.log('✅ Database setup completed successfully');
db.close();

