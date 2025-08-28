# HandyPay Auth Backend

Better Auth server for HandyPay mobile app OAuth authentication with Google and Apple sign-in support.

## Setup Instructions

### 1. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API (if not already enabled)
4. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client IDs"
5. Set application type to "Web application"
6. Add authorized redirect URIs:
   - For production: `https://your-app.onrender.com/auth/callback/google`
   - For local development: `http://localhost:3000/auth/callback/google`
7. Copy the Client ID and Client Secret

### 2. Environment Variables

Create a `.env` file in the root directory (see `env-template.txt` for reference):

```bash
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here

# Better Auth Configuration
BETTER_AUTH_URL=https://your-app.onrender.com
BETTER_AUTH_SECRET=your_random_secret_key_here

# Database Configuration (PostgreSQL)
DATABASE_URL=postgresql://username:password@host:port/database

# Server Configuration
PORT=3000
```

### 3. Generate Random Secret

For `BETTER_AUTH_SECRET`, generate a secure random string:

```bash
openssl rand -hex 32
```

### 4. Database Setup

This backend uses PostgreSQL. Make sure you have a PostgreSQL database running and set the `DATABASE_URL` accordingly.

### 5. Install Dependencies

```bash
npm install
```

### 6. Run Database Migrations

```bash
npm run migrate
```

## Development

### Local Development

```bash
npm run dev
```

Server runs on http://localhost:3000

### Testing

Visit `http://localhost:3000` to check if the server is running and environment variables are configured correctly.

## Deployment

### Deploy to Render

1. Push this code to GitHub
2. Create new Web Service on Render
3. Connect your GitHub repo
4. Set environment variables (same as local setup)
5. Deploy

### Mobile App Configuration

The mobile app expects the backend to be available at the URL specified in `src/constants/index.ts`:

```typescript
export const API_CONFIG = {
  BASE_URL: "https://your-app.onrender.com", // Update this URL
  TIMEOUT: 10000,
} as const;
```

Make sure to update this URL to match your deployed backend.

## API Endpoints

- `GET /` - Health check and environment status
- `GET /test-auth` - Test Better Auth initialization
- `ALL /auth/*` - Better Auth OAuth endpoints (Google, Apple, session management)

## Troubleshooting

### Common Issues

1. **"No session found after OAuth redirect"**

   - Check that cookies are being set properly
   - Verify CORS configuration
   - Check backend logs for session creation errors

2. **"Google OAuth fails with redirect_uri_mismatch"**

   - Verify authorized redirect URIs in Google Cloud Console
   - Make sure the callback URL matches exactly

3. **"Environment variables not configured"**
   - Check that all required environment variables are set
   - Restart the server after adding new variables

### Debug Mode

Enable detailed logging by checking the console output when starting the server. The server will log:

- Environment variable status
- Incoming requests
- OAuth flow progress
- Session creation attempts
