import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { auth } from './auth.js';

const app = new Hono();

// CORS middleware first
app.use('*', cors({
  origin: ['handypay://', 'https://handypay-backend.onrender.com'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

// Health check endpoint
app.get('/', (c) => {
  return c.json({ 
    message: 'HandyPay Auth Server is running!',
    auth: !!auth,
    env: {
      hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
      hasGoogleClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
      hasBetterAuthUrl: !!process.env.BETTER_AUTH_URL,
      hasBetterAuthSecret: !!process.env.BETTER_AUTH_SECRET,
      hasDatabaseUrl: !!process.env.DATABASE_URL
    }
  });
});

// Test route to check Better Auth initialization
app.get('/test-auth', async (c) => {
  try {
    console.log('Testing Better Auth initialization...');
    
    // Try to call a simple Better Auth API method
    const result = await auth.api.listSessions({
      headers: c.req.raw.headers
    });
    
    return c.json({ message: 'Better Auth is working', result });
  } catch (error) {
    console.error('Better Auth test error:', error);
    return c.json({ error: error.message, stack: error.stack }, 500);
  }
});

// Better Auth handler - this should handle ALL /auth/* routes
app.all('/auth/*', async (c) => {
  console.log(`Better Auth route: ${c.req.method} ${c.req.url}`);
  console.log('Request headers:', Object.fromEntries(c.req.raw.headers.entries()));
  
  try {
    const response = await auth.handler(c.req.raw);
    console.log('Better Auth response status:', response.status);
    return response;
  } catch (error) {
    console.error('Better Auth error:', error);
    return c.json({ error: 'Authentication error', details: error.message }, 500);
  }
});

const port = parseInt(process.env.PORT || '3000');

console.log(`🚀 Server starting on port ${port}`);
console.log(`📍 Better Auth URL: ${process.env.BETTER_AUTH_URL}`);
console.log(`🔑 Google Client ID configured: ${!!process.env.GOOGLE_CLIENT_ID}`);

serve({
  fetch: app.fetch,
  port
});