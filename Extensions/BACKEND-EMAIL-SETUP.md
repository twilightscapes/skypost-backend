# Backend Setup - Email Configuration

## Quick Start

Your SkyPost backend now sends license keys via email after payment. You need to add email configuration.

## Option 1: Gmail (Recommended for testing)

### Step 1: Enable 2FA on Google Account
1. Go to https://myaccount.google.com/security
2. Find "2-Step Verification" and enable it

### Step 2: Create App Password
1. Go to https://myaccount.google.com/apppasswords
2. Select "Mail" and "Windows Computer" (or your device)
3. Google generates a 16-character password
4. Copy this password

### Step 3: Set Environment Variables
```bash
# In your .env file or platform environment variables:
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=xxxx xxxx xxxx xxxx  # The 16-char password from step 2
```

### Step 4: Test Email
```bash
# Start backend and make a test purchase via Stripe
# Should receive email at billing address with license key
```

---

## Option 2: SendGrid (Recommended for production)

### Step 1: Create SendGrid Account
1. Sign up at https://sendgrid.com
2. Go to Settings → API Keys
3. Create new API Key with "Mail Send" permission
4. Copy the API key

### Step 2: Set Environment Variables
```bash
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxx
EMAIL_USER=noreply@yourdomain.com
```

### Step 3: Update Backend Code
In `skypost-backend/src/index.js`, replace the transporter config:

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

---

## Option 3: Mailgun (Good alternative)

### Step 1: Create Mailgun Account
1. Sign up at https://www.mailgun.com
2. Add your domain
3. Get SMTP credentials from Domains → SMTP

### Step 2: Set Environment Variables
```bash
MAILGUN_DOMAIN=mg.yourdomain.com
MAILGUN_PASSWORD=your-mailgun-password
EMAIL_USER=postmaster@mg.yourdomain.com
```

### Step 3: Update Backend Code
```javascript
const transporter = nodemailer.createTransport({
  host: 'smtp.mailgun.org',
  port: 587,
  auth: {
    user: 'postmaster@mg.yourdomain.com',
    pass: process.env.MAILGUN_PASSWORD
  }
});
```

---

## Onrender.com Deployment

If you're using Render.com (free host):

1. Go to your service dashboard
2. Settings → Environment
3. Add variables:
   ```
   EMAIL_USER = your-email@gmail.com
   EMAIL_PASSWORD = xxxx xxxx xxxx xxxx
   ```
4. Redeploy service

---

## Email Template

Users will receive a professional HTML email with:
- Welcome message
- Their license key (in monospace for easy copying)
- Step-by-step activation instructions
- List of Pro features
- Support note

The template is in `sendLicenseEmail()` function in `index.js`.

---

## Troubleshooting

### "EAUTH: Invalid credentials" Error
- Gmail: Make sure you're using app password, not regular password
- Check EMAIL_USER and EMAIL_PASSWORD are set correctly
- Test credentials in isolation first

### "ESME:553" or "550 Mailbox not found"
- Email address in code doesn't exist
- Update `from` field in sendMail() call
- For Gmail: Can be any Gmail account
- For SendGrid: Must be verified sender domain

### Email Not Arriving
- Check spam folder
- Gmail may be blocking "Less secure apps"
- Try from a different email provider temporarily
- Check console logs for error messages

### Stripe Webhook Issues
- Webhook signature mismatch = wrong `STRIPE_WEBHOOK_SECRET`
- Webhook not firing = Make sure webhook is configured in Stripe dashboard
- Check Stripe logs at https://dashboard.stripe.com/webhooks

---

## Testing Locally

To test email sending locally:

```bash
# Option 1: Use Gmail app password
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=xxxx xxxx xxxx xxxx
npm start

# Then trigger a test payment via Stripe test mode
```

```bash
# Option 2: Use Mailtrap (catches emails, shows in UI)
# Go to https://mailtrap.io
# Get SMTP credentials
# Update transporter config temporarily
npm start
```

---

## Production Checklist

- [ ] Email service configured (Gmail/SendGrid/Mailgun)
- [ ] Environment variables set on hosting platform
- [ ] Test payment made to verify email sends
- [ ] Email template matches your branding (optional)
- [ ] Sender email address is professional
- [ ] Spam filter tested
- [ ] Support email for "lost key" requests
