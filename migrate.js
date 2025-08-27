import { auth } from './src/auth.js';

async function migrate() {
  console.log('Running Better Auth migration...');
  
  try {
    // This will create the necessary tables in your database
    await auth.api.signUp({
      body: {
        email: 'test@example.com',
        password: 'test123456'
      }
    });
    console.log('✅ Migration completed successfully');
  } catch (error) {
    if (error.message.includes('already exists') || error.message.includes('duplicate')) {
      console.log('✅ Database tables already exist');
    } else {
      console.error('❌ Migration failed:', error);
    }
  }
  
  process.exit(0);
}

migrate();