#!/usr/bin/env node

// Migration script to add banned account fields and table
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the SQL migration file
const sqlFile = path.join(__dirname, 'add-ban-fields.sql');
const sqlContent = fs.readFileSync(sqlFile, 'utf8');

console.log('🚫 Banned Account Migration Script');
console.log('=====================================');
console.log('');
console.log('This script will add banned account detection to your database.');
console.log('');
console.log('SQL Migration to run:');
console.log('---------------------');
console.log(sqlContent);
console.log('');
console.log('📋 What this migration does:');
console.log('1. Adds ban fields to users table (is_banned, ban_reason, banned_at)');
console.log('2. Creates banned_accounts table for detailed ban tracking');
console.log('3. Adds indexes for performance');
console.log('');
console.log('⚠️  IMPORTANT: Run this SQL in your Supabase SQL editor or database console');
console.log('');
console.log('🔧 After migration, your app will have:');
console.log('- Automatic banned account detection');
console.log('- Prevention of banned users from creating Stripe accounts');
console.log('- Admin endpoints for banning/unbanning users');
console.log('- Detailed ban history and evidence tracking');
console.log('');
console.log('📞 Ready to migrate? Run the SQL above in your database console!');
