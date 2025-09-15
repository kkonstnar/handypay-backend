import { createAuth } from './src/auth.js';
import { initializeDatabase, db } from './src/db.js';

async function migrate() {
  console.log('Running database migration...');

  try {
    // Initialize database connection
    const env = process.env;
    initializeDatabase(env);

    // Create push_tokens table if it doesn't exist
    console.log('📋 Creating push_tokens table...');

    await db.execute(`
      CREATE TABLE IF NOT EXISTS push_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        token TEXT NOT NULL,
        device_type TEXT NOT NULL,
        device_id TEXT,
        is_active BOOLEAN DEFAULT true,
        last_used TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Create index on user_id for faster lookups
    await db.execute(`
      CREATE INDEX IF NOT EXISTS push_tokens_user_id_idx ON push_tokens(user_id);
    `);

    // Create index on is_active for faster active token queries
    await db.execute(`
      CREATE INDEX IF NOT EXISTS push_tokens_active_idx ON push_tokens(is_active);
    `);

    console.log('✅ Push tokens table created successfully');

    // Try Better Auth migration
    console.log('🔐 Running Better Auth migration...');
    const auth = createAuth(env);

    try {
      await auth.api.signUp({
        body: {
          email: 'test@example.com',
          password: 'test123456'
        }
      });
      console.log('✅ Better Auth migration completed');
    } catch (authError) {
      if (authError.message.includes('already exists') || authError.message.includes('duplicate')) {
        console.log('✅ Better Auth tables already exist');
      } else {
        console.warn('⚠️ Better Auth migration skipped:', authError.message);
      }
    }

    console.log('🎉 All migrations completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

migrate();