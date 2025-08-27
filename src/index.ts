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

// Mobile redirect handler
app.get('/auth/callback/google', async (c) => {
  console.log('Google callback hit, redirecting to mobile app');
  // Return HTML that redirects to mobile app
  return c.html(`
    <html>
      <head>
        <title>Redirecting...</title>
      </head>
      <body>
        <script>
          window.location.href = 'handypay://auth/callback?success=true';
        </script>
        <p>Redirecting to HandyPay app...</p>
      </body>
    </html>
  `);
});

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