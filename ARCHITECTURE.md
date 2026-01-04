# SkyPost Architecture & Flow Diagrams

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     USER'S BROWSER                               │
│  ┌─────────────────┬──────────────────┬────────────────────┐   │
│  │ Firefox Ext     │ Safari Ext       │ Chrome Ext         │   │
│  │ (v1.1.3)        │ (v1.1.3)         │ (v1.1.3)           │   │
│  │                 │                  │                    │   │
│  │ - Popup.js      │ - Popup.js       │ - Popup.js         │   │
│  │ - License.js ✓  │ - License.js ✓   │ - License.js ✓     │   │
│  │ - Init.js ✓     │ - Init.js ✓      │ - Init.js ✓        │   │
│  │ - Workspace.js  │ - Workspace.js   │ - Workspace.js     │   │
│  └─────────────────┴──────────────────┴────────────────────┘   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                    (HTTPS requests)
                               │
                ┌──────────────┴──────────────┐
                │                             │
         ┌──────▼────────────┐       ┌───────▼──────────┐
         │  STRIPE CHECKOUT  │       │  SKY POST        │
         │  (stripe.com)     │       │  BACKEND SERVER  │
         │                   │       │ (Railway)        │
         │ - Payment form    │       │                  │
         │ - Card capture    │       │ Node.js + Express│
         │ - Processing      │       │ PostgreSQL/JSON  │
         │                   │       │                  │
         │  WEBHOOK EVENTS   │       │ API Endpoints:   │
         │  (charge.success) │       │ - /api/licenses  │
         │                   │       │ - /api/checkout  │
         └────────┬──────────┘       │ - /webhooks      │
                  │                  │ - /pro/success   │
                  │                  │ - /pro/cancel    │
                  └──────────┬───────┘
                             │
                    ┌────────┴────────┐
                    │                 │
             ┌──────▼────────┐  ┌─────▼──────┐
             │  NODEMAILER   │  │  DATABASE  │
             │  (Email)      │  │ (Licenses) │
             │               │  │            │
             │ - AWS SES     │  │ - PG SQL   │
             │ - Mailgun     │  │ - File.JSON│
             │ - SMTP        │  │ (backup)   │
             └───────────────┘  └────────────┘
```

---

## 🔄 Payment & License Flow

### 1️⃣ User Initiates Purchase

```
User clicks "Get Pro Access"
        ↓
Extension calls: POST /api/subscriptions/create-checkout
        ↓
Backend generates:
  - New license key: SKY-XXXXXXXXXXXX
  - Stripe checkout session
        ↓
Response: { sessionUrl: "https://checkout.stripe.com/..." }
        ↓
Extension opens checkout page in browser
```

### 2️⃣ Payment Processing

```
User enters card details on Stripe
        ↓
Stripe processes payment
        ↓
Status: SUCCESS ✓
        ↓
Stripe sends webhook event:
  - Event: charge.succeeded
  - License key in metadata
        ↓
Backend receives webhook at: POST /webhooks/stripe
  (Verifies signature with STRIPE_WEBHOOK_SECRET)
        ↓
Backend:
  1. Finds matching license
  2. Activates license (tier: pro)
  3. Sets expiration (365 days)
  4. Sends email with license key
        ↓
Database updated ✓
```

### 3️⃣ Success Page

```
Stripe redirects to: GET /pro/success?license_key=SKY-XXXX
        ↓
Backend returns HTML page showing:
  - 🎉 Payment Successful
  - License key (copyable)
  - Instructions
        ↓
User copies license key from success page
```

### 4️⃣ License Activation

```
User pastes license key into extension
        ↓
Extension calls: POST /api/licenses/check
  Body: { licenseKey: "SKY-XXXX..." }
        ↓
Backend:
  1. Finds license by key
  2. Verifies status = active
  3. Verifies tier = pro
  4. Returns { valid: true, isPro: true }
        ↓
Extension:
  1. Stores license in chrome.storage.local
  2. Sets license expiry
  3. Shows "✓ PRO ACTIVE"
        ↓
Pro features unlocked! 🚀
```

---

## 🔐 Environment Variables

### What They Are

```
STRIPE_SECRET_KEY
  ├─ Purpose: Sign API requests to Stripe
  ├─ Format: sk_live_XXXXX or sk_test_XXXXX
  ├─ Sandbox: sk_test_51XXXXX
  └─ Live: sk_live_51XXXXX

STRIPE_PRICE_ID
  ├─ Purpose: Which product to charge ($9.99/month plan)
  ├─ Format: price_XXXXX
  ├─ Sandbox: price_1XXXXXXXXXXXXX_test
  └─ Live: price_1XXXXXXXXXXXXX

STRIPE_WEBHOOK_SECRET
  ├─ Purpose: Verify webhook messages are from Stripe
  ├─ Format: whsec_XXXXX
  ├─ Sandbox: whsec_test_XXXXX
  └─ Live: whsec_XXXXX
```

### Transition: Sandbox → Live

```
BEFORE (Sandbox):
┌─────────────────────────────────────────┐
│ STRIPE_SECRET_KEY=sk_test_51...         │
│ STRIPE_PRICE_ID=price_1...test          │
│ STRIPE_WEBHOOK_SECRET=whsec_test_...    │
└─────────────────────────────────────────┘
        ↓ (UPDATE ON RAILWAY)
        ↓
AFTER (Live):
┌─────────────────────────────────────────┐
│ STRIPE_SECRET_KEY=sk_live_51...         │
│ STRIPE_PRICE_ID=price_1...              │
│ STRIPE_WEBHOOK_SECRET=whsec_...         │
└─────────────────────────────────────────┘
```

---

## 📡 API Endpoints

### POST /api/subscriptions/create-checkout
Creates a Stripe checkout session
```
Request:
  {
    email: "user@example.com",      // Optional
    deviceId: "device-123",         // Optional
    success_url: "...",             // Optional override
    cancel_url: "..."               // Optional override
  }

Response:
  {
    sessionUrl: "https://checkout.stripe.com/pay/cs_test_...",
    licenseKey: "SKY-XXXXXXXXXXXX"
  }

Used by: Extension "Get Pro Access" button
```

### POST /api/licenses/check
Verify a license key
```
Request:
  {
    licenseKey: "SKY-XXXXXXXXXXXX"
  }

Response:
  {
    valid: true,
    isPro: true,
    tier: "pro",
    status: "active",
    email: "user@example.com",
    expiresAt: "2025-01-04T12:00:00Z",
    activatedAt: "2024-01-04T12:00:00Z"
  }

Used by: Extension license activation form
```

### POST /webhooks/stripe
Receive payment events from Stripe
```
Events handled:
  - charge.succeeded (payment captured)
  - checkout.session.completed (session completed)

Action:
  1. Verify webhook signature
  2. Find license by metadata
  3. Activate license (status = active, tier = pro)
  4. Send confirmation email
  5. Return { received: true }

Called by: Stripe (not user)
Authentication: STRIPE_WEBHOOK_SECRET signature verification
```

### GET /pro/success
Display success page after payment
```
Query params:
  license_key=SKY-XXXXXXXXXXXX

Response:
  HTML page with:
  - 🎉 Payment Successful
  - License key (copyable text box)
  - "Copy License Key" button
  - "Close" button
  - Instructions to activate in extension
```

### GET /pro/cancel
Display cancellation page
```
Response:
  HTML page with:
  - "Payment Cancelled"
  - "You can try again anytime"
  - "Close" button
```

---

## 📧 Email Flow

```
User completes payment
        ↓
Stripe webhook: charge.succeeded
        ↓
Backend processes webhook
        ↓
Backend sends email via Nodemailer:
  ├─ To: user@example.com
  ├─ Subject: 🎉 Welcome to SkyPost Pro!
  ├─ Body: Your license key is: SKY-XXXXXXXXXXXX
  └─ Config: SMTP (Mailgun, Gmail, or custom)
        ↓
User receives email ✓
User copies license key
User pastes in extension
User clicks "Activate"
        ↓
Pro features unlocked! 🚀
```

---

## 🗄️ Database Schema

### Licenses Table

```sql
CREATE TABLE licenses (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) UNIQUE NOT NULL,        -- SKY-XXXXXXXXXXXX
  email VARCHAR(255),                      -- user@example.com
  status VARCHAR(50) DEFAULT 'pending',    -- pending|active|expired
  tier VARCHAR(50) DEFAULT 'free',         -- free|pro
  expires_at TIMESTAMP,                    -- 2025-01-04
  activated_at TIMESTAMP,                  -- 2024-01-04
  created_at TIMESTAMP DEFAULT NOW()       -- 2024-01-04
);
```

### Example Record

```json
{
  "id": 1,
  "key": "SKY-A1B2C3D4E5F6G7H8",
  "email": "user@example.com",
  "status": "active",
  "tier": "pro",
  "expires_at": "2025-01-04T00:00:00Z",
  "activated_at": "2024-01-04T12:30:45Z",
  "created_at": "2024-01-04T12:00:00Z"
}
```

---

## 🔄 Webhook Flow (Detailed)

```
Stripe Server                          Your Backend
     │                                     │
     │  charge.succeeded event             │
     ├────────────────────────────────────>│
     │  Headers: stripe-signature: t=...,v1=...
     │  Body: { id: "ch_...", object: "charge", ... }
     │                                     │
     │                              Backend receives
     │                              Verifies signature:
     │                              stripe.webhooks.constructEvent(
     │                                body, sig, WEBHOOK_SECRET)
     │                              ✓ Valid = Process
     │                              ✗ Invalid = 400 error
     │                                     │
     │                              Finds license:
     │                              db.licenses.find(...)
     │                                     │
     │                              Updates license:
     │                              status = "active"
     │                              tier = "pro"
     │                              expires_at = +365 days
     │                                     │
     │                              Sends email:
     │                              nodemailer.sendMail(...)
     │                                     │
     │  <────────────────────────────────200 OK
     │  { received: true }                 │
     │                                     │
```

---

## 🧪 Testing Checklist

```
Before Going Live, Verify:

Payment Flow:
  ✓ Extension "Get Pro Access" button opens checkout
  ✓ Stripe checkout page loads
  ✓ Test card: 4242 4242 4242 4242 works
  ✓ Payment processes without errors
  ✓ Redirect to /pro/success page
  ✓ License key shown on success page

Webhook:
  ✓ Stripe webhook endpoint registered
  ✓ Webhook signature verified
  ✓ License created in database
  ✓ License status = active, tier = pro

Email:
  ✓ Email received by user
  ✓ Email contains license key
  ✓ Email isn't in spam folder

License Activation:
  ✓ User can copy license key from success page
  ✓ User can paste key in extension
  ✓ Extension calls /api/licenses/check
  ✓ Backend validates and returns isPro: true
  ✓ Extension shows "✓ PRO ACTIVE"
  ✓ Pro features become available

Pro Features:
  ✓ Unlimited scheduled posts enabled
  ✓ Analytics dashboard visible
  ✓ Custom cards available
  ✓ Backup feature available
  ✓ Restore feature available
```

---

## 📊 Deployment Architecture

```
GitHub Repo
  └─ /skypost-backend (Node.js server)
            ↓
        Railway CI/CD
            ↓
    skypost-backend-production
    (Automatically deployed)
            ↓
    https://skypost-backend-production.up.railway.app
            │
            ├─ API Server (Node.js/Express)
            ├─ Database (PostgreSQL)
            ├─ Stripe Integration
            └─ Email Service

Extensions (Separate)
  ├─ Firefox Extension
  │  └─ Deployed to Mozilla Add-ons Store
  │     └─ Points to: skypost-backend-production.up.railway.app
  │
  ├─ Safari Extension
  │  └─ Deployed to Apple App Store
  │     └─ Points to: skypost-backend-production.up.railway.app
  │
  └─ Chrome Extension
     └─ Deployed to Chrome Web Store
        └─ Points to: skypost-backend-production.up.railway.app
```

---

## 🎯 Key Dependencies

```
Backend:
  - express (web server)
  - stripe (payments)
  - nodemailer (emails)
  - pg (PostgreSQL)
  - dotenv (environment variables)
  - uuid (generate keys)

Extensions:
  - Chrome APIs (storage, tabs, scripting)
  - Fetch API (HTTPS requests)
  - Browser Storage (license persistence)
```

---

## ⚡ Critical Security Notes

1. **NEVER commit secrets to Git**
   - Use Railway environment variables
   - Keep .env files local
   - Use .gitignore to exclude .env

2. **Webhook Signature Verification**
   - ALWAYS verify stripe-signature header
   - Use STRIPE_WEBHOOK_SECRET
   - Don't trust webhook unless verified

3. **HTTPS Only**
   - All API calls must be HTTPS
   - No http:// URLs in production
   - Railway provides SSL automatically

4. **License Keys**
   - Generated with uuid (cryptographically random)
   - Format: SKY-XXXXXXXXXXXX (26 characters)
   - Unique in database
   - Difficult to guess/brute-force

5. **Payment Security**
   - Never handle card numbers directly
   - All payments via Stripe (PCI compliant)
   - No card data stored locally
   - All requests to Stripe use live keys

---

## 📈 Monitoring & Debugging

```
Check Backend Status:
  - Railway Deployments logs
  - Error messages in console
  - HTTP status codes

Check Stripe Webhooks:
  - Stripe Dashboard → Developers → Webhooks
  - Event log shows all webhook calls
  - Retry count for failed webhooks

Check Database:
  - PostgreSQL console (if available)
  - Or inspect data.json file
  - Look for created licenses

Check Extension Errors:
  - Firefox: about:debugging → Inspect
  - Safari: Develop menu → Errors
  - Chrome: Developer tools → Console
```

---

Generated: January 4, 2026
Purpose: Complete SkyPost System Documentation
