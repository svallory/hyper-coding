# Webhook Handler Generator

Generate secure webhook handlers with signature verification for external services like Stripe, GitHub, Shopify, and more.

## Features

- **Pre-configured Providers**: Stripe, GitHub, Shopify, Clerk, Resend
- **Signature Verification**: Automatic HMAC signature validation
- **Security**: Timing-safe comparison to prevent timing attacks
- **Type Safety**: Full TypeScript support
- **Event Handling**: Template for handling different event types
- **Error Handling**: Proper error responses and logging

## Usage

### Stripe Webhook

```bash
hypergen api webhook stripe --provider stripe --verification
```

Generates a webhook handler with Stripe signature verification using the Stripe SDK.

### GitHub Webhook

```bash
hypergen api webhook github --provider github --verification
```

Generates a webhook handler with GitHub SHA-256 HMAC verification.

### Shopify Webhook

```bash
hypergen api webhook shopify --provider shopify --verification
```

Generates a webhook handler with Shopify HMAC-SHA256 verification.

### Clerk Webhook

```bash
hypergen api webhook clerk --provider clerk --verification
```

Generates a webhook handler with Clerk/Svix signature verification.

### Custom Webhook

```bash
hypergen api webhook custom-service --verification
```

Generates a generic webhook handler with HMAC-SHA256 verification.

## Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | string | required | Webhook name in kebab-case |
| `provider` | string | `"custom"` | Pre-configured provider (stripe, github, shopify, clerk, resend) |
| `verification` | boolean | `true` | Add signature verification |
| `dir` | string | `"app/api/webhooks"` | Output directory |

## Supported Providers

### Stripe

**Environment Variables:**
- `STRIPE_SECRET_KEY` - Your Stripe secret key
- `STRIPE_WEBHOOK_SECRET` - Webhook signing secret from Stripe dashboard

**Event Types:**
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

**Testing:**
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Trigger test events
stripe trigger checkout.session.completed
```

### GitHub

**Environment Variables:**
- `GITHUB_WEBHOOK_SECRET` - Secret configured in GitHub webhook settings

**Event Types:**
- `push` - Code push events
- `pull_request` - PR opened, closed, merged, etc.
- `issues` - Issue created, updated, closed, etc.

**Headers:**
- `x-hub-signature-256` - HMAC-SHA256 signature
- `x-github-event` - Event type

### Shopify

**Environment Variables:**
- `SHOPIFY_WEBHOOK_SECRET` - API secret key from Shopify admin

**Event Topics:**
- `orders/create` - New order
- `orders/updated` - Order updated
- `orders/cancelled` - Order cancelled
- `products/create` - New product

**Headers:**
- `x-shopify-hmac-sha256` - Base64-encoded HMAC-SHA256
- `x-shopify-topic` - Webhook topic

### Clerk

**Environment Variables:**
- `CLERK_WEBHOOK_SECRET` - Webhook signing secret from Clerk dashboard

**Event Types:**
- `user.created` - New user registered
- `user.updated` - User profile updated
- `user.deleted` - User deleted

**Dependencies:**
```bash
npm install svix
```

### Resend

**Environment Variables:**
- `RESEND_WEBHOOK_SECRET` - Webhook signing secret from Resend

**Event Types:**
- `email.sent` - Email sent successfully
- `email.delivered` - Email delivered
- `email.bounced` - Email bounced
- `email.complained` - Spam complaint

**Dependencies:**
```bash
npm install svix
```

## Generated Code Example

### Stripe Webhook Handler

```typescript
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia',
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const signature = request.headers.get('stripe-signature')

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing signature header' },
        { status: 400 }
      )
    }

    // Verify webhook signature
    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET!
      )
    } catch (err) {
      console.error('Webhook signature verification failed:', err)
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 400 }
      )
    }

    // Handle event
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        // Handle successful checkout
        break
      }
      // ... other events
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
```

### Custom HMAC Verification

```typescript
import { createHmac, timingSafeEqual } from 'crypto'

export async function verifyCustomSignature(
  payload: string,
  signature: string
): Promise<boolean> {
  const secret = process.env.CUSTOM_WEBHOOK_SECRET

  if (!secret) {
    throw new Error('CUSTOM_WEBHOOK_SECRET is not configured')
  }

  const hmac = createHmac('sha256', secret)
  hmac.update(payload, 'utf8')
  const expectedSignature = hmac.digest('hex')

  try {
    return timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    )
  } catch {
    return false
  }
}
```

## Security Best Practices

### Always Verify Signatures

Never skip signature verification in production. This prevents attackers from sending fake webhook events.

### Use Environment Variables

Store webhook secrets in environment variables, never in code:

```env
# .env.local
STRIPE_WEBHOOK_SECRET=whsec_...
GITHUB_WEBHOOK_SECRET=your_secret_here
```

### Timing-Safe Comparison

The generated verifiers use `timingSafeEqual()` to prevent timing attacks when comparing signatures.

### Raw Body Requirement

Webhook signature verification requires the raw request body. Next.js API routes provide this via `request.text()`.

### HTTPS Only

In production, always use HTTPS for webhook endpoints. Most providers require this.

## Testing Webhooks

### Local Testing with ngrok

```bash
# Install ngrok
npm install -g ngrok

# Start Next.js dev server
npm run dev

# Expose local server
ngrok http 3000

# Use ngrok URL in provider's webhook settings
# https://abc123.ngrok.io/api/webhooks/stripe
```

### Manual Testing with curl

```bash
# Generate signature (for custom webhooks)
node -e "
const crypto = require('crypto');
const secret = 'your_secret';
const payload = JSON.stringify({ test: true });
const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
console.log(signature);
"

# Send webhook request
curl -X POST http://localhost:3000/api/webhooks/custom \
  -H 'Content-Type: application/json' \
  -H 'x-webhook-signature: <generated_signature>' \
  -d '{"test":true}'
```

### Provider Test Modes

- **Stripe**: Use test mode webhooks with test API keys
- **GitHub**: Configure webhooks with "Recent Deliveries" for replay
- **Shopify**: Use development store for testing

## Next Steps

1. **Add environment variables** to `.env.local`
2. **Configure webhook** in provider's dashboard
3. **Implement event handlers** in the route file
4. **Add database operations** to persist webhook data
5. **Add error monitoring** (Sentry, LogRocket, etc.)
6. **Test with provider's CLI** or test mode

## Common Issues

### "Invalid signature" errors

- Verify the webhook secret is correct
- Ensure you're using the raw request body
- Check that the secret matches the provider's configuration

### Missing dependencies

Some providers require additional packages:
```bash
npm install stripe       # For Stripe
npm install svix         # For Clerk/Resend
npm install @octokit/webhooks-methods  # Alternative for GitHub
```

### Request body too large

For large webhook payloads, you may need to increase Next.js body size limit in `next.config.js`:

```javascript
module.exports = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
}
```

## Async Processing

For long-running operations, return `200 OK` immediately and process asynchronously:

```typescript
export async function POST(request: NextRequest) {
  const body = await request.text()

  // Verify signature
  // ...

  // Queue for async processing
  await queue.add('webhook-processing', { body })

  // Return immediately
  return NextResponse.json({ received: true })
}
```

Consider using:
- Background jobs (BullMQ, Inngest)
- Message queues (AWS SQS, RabbitMQ)
- Edge functions with KV storage
