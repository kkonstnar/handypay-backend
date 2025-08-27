import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { auth } from './auth.js';

const app = new Hono();

// Health check endpoint
app.get('/', (c) => {
  return c.json({ message: 'HandyPay Auth Server is running!' });
});

// Better Auth routes
app.on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw));

// CORS for mobile app
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (c.req.method === 'OPTIONS') {
    return c.text('', 200);
  }
  
  await next();
});

const port = parseInt(process.env.PORT || '3000');

console.log(`🚀 Server starting on port ${port}`);

serve({
  fetch: app.fetch,
  port
});