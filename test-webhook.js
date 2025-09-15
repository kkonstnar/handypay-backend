#!/usr/bin/env node

/**
 * Test script to debug webhook issues for payment links
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔧 Webhook Debug Test\n');

// Check environment variables
console.log('📋 Environment Check:');
console.log('STRIPE_TEST_SECRET_KEY:', process.env.STRIPE_TEST_SECRET_KEY ? '✅ Set' : '❌ Missing');
console.log('STRIPE_WEBHOOK_SECRET:', process.env.STRIPE_WEBHOOK_SECRET ? '✅ Set' : '❌ Missing');
console.log('STRIPE_TEST_WEBHOOK_SECRET:', process.env.STRIPE_TEST_WEBHOOK_SECRET ? '✅ Set' : '❌ Missing');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '✅ Set' : '❌ Missing');

// Check webhook endpoint format
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_TEST_WEBHOOK_SECRET;
if (webhookSecret) {
  console.log('\n🔐 Webhook Secret Format:');
  console.log('Starts with whsec_:', webhookSecret.startsWith('whsec_') ? '✅ Yes' : '❌ No');
  console.log('Length:', webhookSecret.length);
}

// Check if backend is built
const distPath = path.join(__dirname, 'dist');
console.log('\n🏗️  Build Status:');
console.log('dist directory exists:', fs.existsSync(distPath) ? '✅ Yes' : '❌ No');

if (fs.existsSync(distPath)) {
  const stripeServicePath = path.join(distPath, 'services', 'stripe.js');
  console.log('stripe.js exists:', fs.existsSync(stripeServicePath) ? '✅ Yes' : '❌ No');
}

// Instructions
console.log('\n📝 Next Steps to Debug Webhook Issues:');
console.log('1. Check Stripe Dashboard → Webhooks');
console.log('2. Verify endpoint URL is correct');
console.log('3. Ensure these events are enabled:');
console.log('   - checkout.session.completed');
console.log('   - invoice.payment_succeeded');
console.log('   - invoice.payment_failed');
console.log('4. Test webhook with Stripe CLI:');
console.log('   stripe listen --forward-to https://your-domain.com/api/stripe/webhook');
console.log('5. Check backend logs when payment is made');

console.log('\n💡 Common Issues:');
console.log('- Webhook secret mismatch');
console.log('- Missing webhook events');
console.log('- Database connection issues');
console.log('- Push notification token issues');
