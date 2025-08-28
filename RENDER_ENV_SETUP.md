# Render Environment Variables Setup

## Required Environment Variables for Render Deployment

Copy these to your Render service's Environment Variables section:

### Core Configuration

```
BETTER_AUTH_URL=https://handypay-backend.onrender.com
BETTER_AUTH_SECRET=your_random_secret_key_here
DATABASE_URL=your_supabase_database_url
DIRECT_URL=your_supabase_direct_url
PORT=3000
```

### Stripe Configuration (Required for Payments)

```
STRIPE_TEST_SECRET_KEY=sk_test_your_stripe_test_secret_key_here
NEXT_PUBLIC_STRIPE_TEST_PUBLISHABLE_KEY=pk_test_your_stripe_test_publishable_key_here
```

### Google OAuth (Optional)

```
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

### Apple Sign In (Optional)

```
EXPO_PUBLIC_APPLE_CLIENT_ID=com.handypay.signin
APPLE_CLIENT_ID=com.handypay.signin
APPLE_CLIENT_SECRET=your_apple_client_secret
```

### Other Services (Optional)

```
RESEND_API_KEY=your_resend_api_key
FIREBASE_PRIVATE_KEY=your_firebase_private_key
FIREBASE_CLIENT_EMAIL=your_firebase_client_email
```

## Setup Instructions

1. Go to your Render dashboard
2. Select your HandyPay backend service
3. Go to Environment
4. Add each variable from the list above
5. **Important**: Make sure `STRIPE_TEST_SECRET_KEY` is set with your actual Stripe test secret key
6. Redeploy your service

## Testing

After deployment, test the Stripe integration:

```bash
curl -X POST https://handypay-backend.onrender.com/api/stripe/create-account-link \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test_user",
    "firstName": "Test",
    "lastName": "User",
    "email": "test@example.com",
    "refresh_url": "https://handypay-backend.onrender.com/stripe/refresh",
    "return_url": "https://handypay-backend.onrender.com/stripe/return"
  }'
```
