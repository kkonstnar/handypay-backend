# HandyPay Auth Backend

Better Auth server for HandyPay mobile app OAuth authentication.

## Deploy to Render

1. Push this code to GitHub
2. Create new Web Service on Render
3. Connect your GitHub repo
4. Set environment variables:
   - `GOOGLE_CLIENT_ID`: Your Google OAuth client ID
   - `GOOGLE_CLIENT_SECRET`: Your Google OAuth client secret
   - `BETTER_AUTH_SECRET`: Random secret key
   - `BETTER_AUTH_URL`: https://your-app.onrender.com

## Environment Variables

Copy `.env.example` to `.env` and fill in your values.

## Local Development

```bash
npm install
npm run dev
```

Server runs on http://localhost:3000