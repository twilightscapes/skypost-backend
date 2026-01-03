# License Key Implementation - Option 1 (Email + Key)

## Overview
Changed monetization from **device-ID based** to **license-key based**. This allows users to use their Pro license on multiple devices, browsers, and installations.

## What Changed

### Backend Changes
**File:** `skypost-backend/src/index.js`

1. **Added Email Support**
   - Added `nodemailer` integration for sending license keys via email
   - New function: `sendLicenseEmail(email, licenseKey)`
   - Sends formatted HTML email with license key and activation instructions

2. **Updated Stripe Webhook** (`/webhooks/stripe`)
   - **Before:** Looked up license by `device_id` and `license_key`
   - **After:** Looks up license by `license_key` only
   - Now sends email with license key to user's billing email
   - Stores email address with license for future reference
   - Records payment without device ID

3. **Updated Checkout** (`/api/subscriptions/create-checkout`)
   - **Before:** Required `deviceId` in request
   - **After:** No device ID needed - generates license key on backend
   - Returns `sessionUrl` for Stripe checkout

4. **New License Check Endpoint** (`/api/licenses/check`)
   - **Before:** `/api/licenses/check-device` (device-based)
   - **After:** New endpoint that takes `licenseKey` instead of `deviceId`
   - Returns Pro status based on license key, not device

5. **Deprecated Old Endpoints** (kept for backwards compatibility)
   - `/api/licenses/check-device` - Returns deprecation message
   - `/api/subscriptions/check-license` - Returns deprecation message

### Extension Changes

**Files:**
- `firefox-extension/license.js`
- `safari-extension-pro/license.js`

1. **Removed Device ID**
   - Deleted `DEVICE_ID` storage key
   - Removed `getOrCreateDeviceId()` method
   - Removed `checkAndActivateLicense()` method (device-based auto-check)

2. **Simplified License Manager**
   - Only tracks: `LICENSE_KEY` and `LICENSE_EXPIRY`
   - `activateLicense(licenseKey)` now:
     - Takes license key as parameter
     - Verifies with backend using `/api/licenses/verify`
     - Stores license key and expiry locally
     - Works on ANY device with the key

3. **UI Integration**
   - UI already existed in `pro-settings.html`
   - License key input field and "Activate" button
   - Shows status and remaining days
   - Works across all browsers/devices

### Checkout Flow Updated

**Files:**
- `firefox-extension/init.js`
- `safari-extension-pro/init.js`

Changed checkout message from:
```
"Complete your purchase to activate Pro!"
```

To:
```
"After payment, check your email for your license key.
Then come back and paste it in Settings → License"
```

Removed `deviceId` parameter from checkout API call.

---

## User Flow (New)

### 1. User Purchases Pro
```
User clicks "Upgrade to Pro"
    ↓
Backend creates unique license key (SKY-XXXXXXXXXXXXX)
    ↓
User redirected to Stripe checkout
    ↓
User completes payment
    ↓
Stripe webhook fires
    ↓
Backend sends email with license key
```

### 2. User Activates License (on any device/browser)
```
User receives email with license key
    ↓
User goes to Settings → License
    ↓
User pastes license key in input field
    ↓
User clicks "Activate"
    ↓
Extension calls backend to verify key
    ↓
Backend confirms license is valid and active
    ↓
Extension saves license key locally
    ↓
Pro features immediately unlocked
    ↓
Works on ANY other device with same key
```

---

## Backend Configuration Required

### Environment Variables

You need to set these in your backend environment:

```bash
# Stripe (existing)
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxx
STRIPE_PRICE_ID=price_xxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxx

# Email (NEW)
EMAIL_USER=your-email@gmail.com          # Gmail address
EMAIL_PASSWORD=your-app-password         # Gmail app password (NOT regular password)
```

### Gmail App Password Setup

If using Gmail:
1. Enable 2-factor authentication on Google Account
2. Go to https://myaccount.google.com/apppasswords
3. Select "Mail" and "Windows Computer"
4. Google generates an app-specific password (16 characters)
5. Use that as `EMAIL_PASSWORD`

### Alternative Email Services

Can switch to other services by modifying transporter config:

**SendGrid:**
```javascript
const transporter = nodemailer.createTransport({
  host: 'smtp.sendgrid.net',
  port: 587,
  auth: {
    user: 'apikey',
    pass: process.env.SENDGRID_API_KEY
  }
});
```

**Mailgun:**
```javascript
const transporter = nodemailer.createTransport({
  host: 'smtp.mailgun.org',
  port: 587,
  auth: {
    user: 'postmaster@your-domain.com',
    pass: process.env.MAILGUN_PASSWORD
  }
});
```

---

## Testing the Implementation

### Test 1: License Verification
```bash
curl -X POST https://skypost-license-backend.onrender.com/api/licenses/verify \
  -H "Content-Type: application/json" \
  -d '{"licenseKey": "SKY-XXXXXXXXXXXXX"}'
```

Expected response:
```json
{
  "valid": true,
  "license_key": "SKY-XXXXXXXXXXXXX",
  "tier": "pro",
  "expires_at": "2026-01-02T00:00:00.000Z"
}
```

### Test 2: License Check by Key
```bash
curl -X POST https://skypost-license-backend.onrender.com/api/licenses/check \
  -H "Content-Type: application/json" \
  -d '{"licenseKey": "SKY-XXXXXXXXXXXXX"}'
```

Expected response:
```json
{
  "isPro": true,
  "tier": "pro",
  "expires_at": "2026-01-02T00:00:00.000Z",
  "expiresIn": 365
}
```

### Test 3: Old Device-Based Check (deprecated)
```bash
curl -X POST https://skypost-license-backend.onrender.com/api/licenses/check-device \
  -H "Content-Type: application/json" \
  -d '{"deviceId": "ext-abc123-123456789"}'
```

Expected response:
```json
{
  "isPro": false,
  "tier": "free",
  "message": "Device-based licensing deprecated. Use license key instead."
}
```

---

## Benefits of This Approach

✅ **Multi-Device Support** - One license works on all devices/browsers
✅ **No Password Management** - Just paste the key from email
✅ **Easy Recovery** - User can retrieve email with key
✅ **Simple for Users** - Copy/paste is intuitive
✅ **Secure** - License keys are unique and tied to Stripe payment
✅ **Scalable** - Works with any email service
✅ **Backwards Compatible** - Old device endpoints still work (deprecated)

## Potential Improvements

Future enhancements:
- Add "Resend License Key" button if user loses email
- Add license transfer/upgrade functionality
- Add admin dashboard to manage licenses
- Add support email integration for lost keys
- Add license usage analytics

---

## Files Modified

### Backend
- `skypost-backend/src/index.js` - Added email, updated webhooks and endpoints

### Extension (Firefox)
- `firefox-extension/license.js` - Removed device ID, simplified for key-based activation
- `firefox-extension/init.js` - Updated checkout message, removed deviceId param
- `firefox-extension/pro-settings.html` - Already had UI for license key input

### Extension (Safari)
- `safari-extension-pro/license.js` - Same as Firefox
- `safari-extension-pro/init.js` - Same as Firefox
- `safari-extension-pro/pro-settings.html` - Same as Firefox

---

## Migration Path

If you have existing users with device-based licenses:

1. **Grandfathering:** Device-based system still works temporarily
2. **Email Notification:** Send email with their new license key
3. **Gradual Migration:** Users update to new system at their own pace
4. **Deprecation:** Eventually remove device-based endpoints (6+ months out)

---

## Troubleshooting

### Email Not Sending
- Check `EMAIL_USER` and `EMAIL_PASSWORD` environment variables
- For Gmail: Make sure app password is set (not regular password)
- Check console logs in backend for error messages

### License Key Not Validating
- Make sure license exists in database
- Check if tier is 'pro' and status is 'active'
- Verify license hasn't expired
- Check if email was sent with correct key (copy from database)

### Old Device-Based Licenses
- Still work via `/api/licenses/verify` if you want to migrate them
- Can add migration script to convert device licenses to key-based
