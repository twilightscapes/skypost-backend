console.log('🔧 Starting SkyPost Backend initialization...');

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
let stripe = null;
try {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
} catch (err) {
  console.warn('⚠️  Stripe initialization failed:', err.message);
}
const sgMail = require('@sendgrid/mail');
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}
const { Pool } = require('pg');

const app = express();
// Use PORT from environment, default to 3000
const PORT = process.env.PORT || 3000;

console.log('🔧 Listening on port:', PORT);

// Serve static files (logos, etc.)
app.use(express.static(path.join(__dirname, '..', 'src')));

// PostgreSQL connection (from DATABASE_URL on Render)
let pool = null;
let useFileStorage = false;

function initializeDatabase() {
  if (!process.env.DATABASE_URL) {
    console.log('⚠️  No DATABASE_URL, using file-based storage');
    useFileStorage = true;
    return;
  }

  console.log('🔧 Initializing PostgreSQL database...');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  pool.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      id SERIAL PRIMARY KEY,
      key VARCHAR(255) UNIQUE NOT NULL,
      email VARCHAR(255),
      status VARCHAR(50) DEFAULT 'pending',
      tier VARCHAR(50) DEFAULT 'free',
      expires_at TIMESTAMP,
      activated_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err);
    } else {
      console.log('✅ Licenses table ready');
    }
  });
}

// Database helper functions
async function readDatabase() {
  if (pool) {
    try {
      const result = await pool.query('SELECT * FROM licenses');
      return {
        users: [],
        licenses: result.rows.map(row => ({
          id: row.id,
          key: row.key,
          email: row.email,
          status: row.status,
          tier: row.tier,
          expires_at: row.expires_at,
          activated_at: row.activated_at,
          created_at: row.created_at
        })),
        payments: []
      };
    } catch (err) {
      console.error('Error reading from PostgreSQL:', err);
      // Fall back to file storage
      useFileStorage = true;
    }
  }
  
  // File-based fallback
  const DB_FILE = path.join('/tmp', 'data.json');
  const data = fs.readFileSync(DB_FILE, 'utf8');
  return JSON.parse(data);
}

async function writeDatabase(data) {
  if (pool) {
    try {
      // Clear and rewrite licenses
      await pool.query('DELETE FROM licenses');
      
      for (const license of data.licenses) {
        await pool.query(
          `INSERT INTO licenses (key, email, status, tier, expires_at, activated_at) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [license.key, license.email, license.status, license.tier, license.expires_at, license.activated_at]
        );
      }
      return;
    } catch (err) {
      console.error('Error writing to PostgreSQL:', err);
      useFileStorage = true;
    }
  }
  
  // File-based fallback
  const DB_FILE = path.join('/tmp', 'data.json');
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// CORS configuration
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Stripe webhook needs raw body for signature verification - MUST come BEFORE json parsing
app.post('/webhooks/stripe', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    // Handle successful charge (payment completed)
    if (event.type === 'charge.succeeded') {
      const charge = event.data.object;
      console.log(`📨 Webhook received charge.succeeded:`, {
        chargeId: charge.id,
        email: charge.billing_details?.email,
        metadata: charge.metadata
      });
      
      // Find the license by looking for pending licenses
      const db = await readDatabase();
      let license = null;
      
      // Try to find by charge metadata first (most reliable)
      if (charge.metadata?.license_key) {
        console.log(`🔍 Looking for license by key: ${charge.metadata.license_key}`);
        license = db.licenses.find(l => l.key === charge.metadata.license_key && l.status === 'pending');
      }
      
      // If not found by key, try by email
      const stripeEmail = charge.billing_details?.email;
      if (!license && stripeEmail) {
        console.log(`🔍 Looking for license by email: ${stripeEmail}`);
        license = db.licenses.find(l => l.email === stripeEmail && l.status === 'pending');
      }
      
      // If still not found, find the most recent pending license (fallback)
      if (!license) {
        console.log(`🔍 Fallback: looking for most recent pending license`);
        const pendingLicenses = db.licenses.filter(l => l.status === 'pending');
        if (pendingLicenses.length > 0) {
          license = pendingLicenses[pendingLicenses.length - 1];
        }
      }
      
      if (license) {
        // Use the real Stripe email if available, otherwise keep the license email
        const email = stripeEmail || license.email;
        if (stripeEmail && license.email !== stripeEmail) {
          console.log(`📧 Updating license email from ${license.email} to ${stripeEmail}`);
          license.email = stripeEmail;
        }
        console.log(`✅ Found license to activate: ${license.key}`);
        
        // Always activate, even if no email
        license.status = 'active';
        license.tier = 'pro';
        // Store Stripe customer ID for real-time subscription verification
        license.stripe_customer_id = charge.customer;
        license.activated_at = new Date().toISOString();
        // No expires_at - validity is tied to active Stripe subscription
        
        try {
          await writeDatabase(db);
          console.log(`💾 License saved to database: ${license.key}`);
        } catch (saveErr) {
          console.error(`❌ Failed to save license:`, saveErr.message);
        }
        
        // Try to send email if we have it
        if (email) {
          try {
            await sendLicenseEmail(email, license.key);
            console.log(`📧 Email sent: ${license.key} for ${email}`);
          } catch (emailErr) {
            console.error(`⚠️  Failed to send email, but license is active:`, emailErr.message);
          }
        }
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error(`❌ Webhook error:`, err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// Enable JSON parsing for all other routes
app.use(express.json());

// Health check endpoint for Railway
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ message: 'Backend is working!' });
});

// Send license email via SendGrid
async function sendLicenseEmail(email, licenseKey) {
  try {
    if (!process.env.SENDGRID_API_KEY) {
      console.warn(`⚠️  SENDGRID_API_KEY not set, skipping email send`);
      return false;
    }

    const textContent = `
Welcome to SkyPost Pro!

Your License Key:
${licenseKey}

How to Activate:
1. Open the SkyPost extension in your browser
2. Click the "Upgrade" button
3. Click "Already have a license?"
4. Paste your license key in the input field
5. Click "Activate"
6. Enjoy Pro features!

Your Pro Benefits:
- Unlimited scheduled posts
- Post analytics & engagement tracking
- Custom link & video cards
- Priority support
- 1 year of updates

License expires: 1 year from activation date

Questions? Visit skypost.io or reply to this email.
    `;
    
    await sgMail.send({
      to: email,
      from: process.env.SENDGRID_FROM_EMAIL || 'noreply@skypost.io',
      subject: 'Your SkyPost Pro License Key',
      text: textContent,
      replyTo: 'support@skypost.io'
    });
    
    console.log(`✅ License email sent via SendGrid to ${email}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send license email to ${email}:`, error.message);
    return false;
  }
}


// Health check
app.get('/', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SkyPost - Email Scheduling Extension</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f8f9fa;
    }
    
    header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 60px 20px;
      text-align: center;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 20px;
    }
    
    .logo {
      max-width: 300px;
      height: auto;
      margin-bottom: 30px;
    }
    
    h1 {
      font-size: 48px;
      margin-bottom: 20px;
      font-weight: 600;
    }
    
    .tagline {
      font-size: 20px;
      opacity: 0.95;
      max-width: 600px;
      margin: 0 auto 40px;
    }
    
    .cta-section {
      display: flex;
      gap: 20px;
      justify-content: center;
      flex-wrap: wrap;
      margin-bottom: 40px;
    }
    
    .btn {
      padding: 14px 32px;
      font-size: 16px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.3s ease;
      text-decoration: none;
      display: inline-block;
    }
    
    .btn-primary {
      background: white;
      color: #667eea;
      box-shadow: 0 4px 15px rgba(0,0,0,0.2);
    }
    
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0,0,0,0.3);
    }
    
    .btn-secondary {
      background: rgba(255,255,255,0.2);
      color: white;
      border: 2px solid white;
    }
    
    .btn-secondary:hover {
      background: rgba(255,255,255,0.3);
      transform: translateY(-2px);
    }
    
    .features-section {
      padding: 80px 20px;
      background: white;
    }
    
    .features-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 40px;
      margin-bottom: 60px;
    }
    
    .feature-card {
      text-align: center;
    }
    
    .feature-icon {
      font-size: 48px;
      margin-bottom: 20px;
    }
    
    .feature-card h3 {
      font-size: 20px;
      margin-bottom: 12px;
      color: #667eea;
    }
    
    .feature-card p {
      color: #666;
      font-size: 15px;
    }
    
    .stores-section {
      padding: 80px 20px;
      background: #f8f9fa;
    }
    
    .stores-section h2 {
      text-align: center;
      font-size: 36px;
      margin-bottom: 50px;
      color: #333;
    }
    
    .store-links {
      display: flex;
      gap: 30px;
      justify-content: center;
      flex-wrap: wrap;
      margin-bottom: 40px;
    }
    
    .store-badge {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 15px;
      padding: 30px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      text-decoration: none;
      color: inherit;
      transition: all 0.3s ease;
      min-width: 200px;
    }
    
    .store-badge:hover {
      transform: translateY(-5px);
      box-shadow: 0 8px 20px rgba(0,0,0,0.15);
    }
    
    .store-icon {
      font-size: 64px;
    }
    
    .store-name {
      font-weight: 600;
      font-size: 16px;
      text-align: center;
    }
    
    .pro-section {
      padding: 80px 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-align: center;
    }
    
    .pro-section h2 {
      font-size: 36px;
      margin-bottom: 20px;
    }
    
    .pro-features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 30px;
      margin-bottom: 40px;
      text-align: left;
    }
    
    .pro-feature {
      padding: 20px;
      background: rgba(255,255,255,0.1);
      border-radius: 8px;
    }
    
    .pro-feature strong {
      display: block;
      margin-bottom: 5px;
      font-size: 16px;
    }
    
    .pro-feature p {
      font-size: 14px;
      opacity: 0.9;
    }
    
    footer {
      background: #333;
      color: white;
      text-align: center;
      padding: 30px 20px;
      font-size: 14px;
    }
    
    @media (max-width: 768px) {
      h1 {
        font-size: 36px;
      }
      
      .tagline {
        font-size: 16px;
      }
      
      .pro-section h2 {
        font-size: 28px;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <img src="/SkyPost-Logo.svg" alt="SkyPost Logo" class="logo">
      
  
      <p class="tagline">Schedule your Bluesky Posts with ease.</p>
      <p>Compose now, send later.</p> 
      <p>Available as a browser extension for Chrome, Firefox, and Safari.</p>
      
      <div class="cta-section">
        <button onclick="goToCheckout()" class="btn btn-primary">Upgrade to Pro</button>
        <a href="#stores" class="btn btn-secondary">Download for Free</a>
      </div>
    </div>
  </header>
  
  <script>
    async function goToCheckout() {
      try {
        const response = await fetch('/api/subscriptions/create-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        
        const data = await response.json();
        if (data.sessionUrl) {
          window.location.href = data.sessionUrl;
        } else {
          alert('Failed to create checkout session');
        }
      } catch (err) {
        alert('Checkout error: ' + err.message);
      }
    }
  </script>
    </div>
  </header>
  
  <section class="features-section">
    <div class="container">
      <div class="features-grid">
        <div class="feature-card">
          <div class="feature-icon">⏰</div>
          <h3>Schedule Emails</h3>
          <p>Compose your message and schedule it to send at the perfect time.</p>
        </div>
        
        <div class="feature-card">
          <div class="feature-icon">📧</div>
          <h3>Works Anywhere</h3>
          <p>Seamlessly integrates with Gmail, Outlook, and other web email services.</p>
        </div>
        
        <div class="feature-card">
          <div class="feature-icon">🚀</div>
          <h3>Lightning Fast</h3>
          <p>One-click scheduling with a beautiful, intuitive interface.</p>
        </div>
        
        <div class="feature-card">
          <div class="feature-icon">💎</div>
          <h3>Pro Features</h3>
          <p>Advanced scheduling, templates, and email analytics with SkyPost Pro.</p>
        </div>
        
        <div class="feature-card">
          <div class="feature-icon">🔒</div>
          <h3>Privacy First</h3>
          <p>Your emails stay secure. We never store your message content.</p>
        </div>
        
        <div class="feature-card">
          <div class="feature-icon">🌐</div>
          <h3>Cross-Platform</h3>
          <p>Available on Chrome, Firefox, and Safari for maximum compatibility.</p>
        </div>
      </div>
    </div>
  </section>
  
  <section class="stores-section" id="stores">
    <div class="container">
      <h2>📥 Download SkyPost</h2>
      <div class="store-links">
        <a href="https://chrome.google.com/webstore/detail/skypost" class="store-badge">
          <div class="store-icon">🔷</div>
          <div class="store-name">Chrome Web Store</div>
        </a>
        
        <a href="https://addons.mozilla.org/firefox/addon/skypost/" class="store-badge">
          <div class="store-icon">🦊</div>
          <div class="store-name">Firefox Add-ons</div>
        </a>
        
        <a href="https://apps.apple.com/app/skypost" class="store-badge">
          <div class="store-icon">🧩</div>
          <div class="store-name">Safari App Store</div>
        </a>
      </div>
    </div>
  </section>
  
  <section class="pro-section">
    <div class="container">
      <h2>🌟 Upgrade to Pro</h2>
      <p style="margin-bottom: 40px; font-size: 18px;">Unlock advanced features and take control of your email scheduling</p>
      
    
      
      <button onclick="goToCheckout()" class="btn btn-primary">Upgrade To Pro!</button>
    </div>
  </section>
  
  <footer>
    <div class="container">
      <p>&copy; 2026 SkyPost. All rights reserved. | <a href="https://skypost.app" style="color: #667eea; text-decoration: none;">skypost.app</a></p>
    </div>
  </footer>
</body>
</html>
  `;
  res.send(html);
});

// Checkout page - allows user to start Stripe checkout
app.get('/pro/checkout', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Upgrade to SkyPost Pro</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    
    .checkout-container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      max-width: 500px;
      width: 100%;
      padding: 40px;
    }
    
    h1 {
      font-size: 32px;
      margin-bottom: 10px;
      color: #667eea;
    }
    
    .subtitle {
      color: #666;
      margin-bottom: 30px;
      font-size: 16px;
    }
    
    .form-group {
      margin-bottom: 20px;
    }
    
    label {
      display: block;
      margin-bottom: 8px;
      font-weight: 600;
      color: #333;
    }
    
    input[type="email"],
    input[type="text"] {
      width: 100%;
      padding: 12px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 16px;
      transition: border-color 0.3s;
    }
    
    input[type="email"]:focus,
    input[type="text"]:focus {
      outline: none;
      border-color: #667eea;
    }
    
    .pricing-box {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      margin: 30px 0;
      text-align: center;
    }
    
    .price {
      font-size: 48px;
      font-weight: bold;
      color: #667eea;
      margin-bottom: 5px;
    }
    
    .billing-period {
      color: #666;
      font-size: 14px;
    }
    
    .features-list {
      list-style: none;
      margin: 20px 0;
    }
    
    .features-list li {
      padding: 10px 0;
      color: #555;
      border-bottom: 1px solid #e0e0e0;
    }
    
    .features-list li:last-child {
      border-bottom: none;
    }
    
    .features-list li:before {
      content: "✓ ";
      color: #667eea;
      font-weight: bold;
      margin-right: 10px;
    }
    
    button {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.3s, box-shadow 0.3s;
    }
    
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
    }
    
    button:active {
      transform: translateY(0);
    }
    
    .loading {
      display: none;
    }
    
    button.loading {
      opacity: 0.7;
      cursor: not-allowed;
    }
    
    .error {
      background: #fee;
      color: #c33;
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: none;
    }
    
    .back-link {
      text-align: center;
      margin-top: 20px;
    }
    
    .back-link a {
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="checkout-container">
    <h1>🌟 SkyPost Pro</h1>
    <p class="subtitle">Unlock advanced email scheduling features</p>
    
    <div class="error" id="error"></div>
    
    <form id="checkoutForm">
      <div class="form-group">
        <label for="email">Email Address</label>
        <input type="email" id="email" name="email" placeholder="your@email.com" required>
      </div>
      
      <div class="pricing-box">
        <div class="price">$9.99</div>
        <div class="billing-period">per month</div>
      </div>
      
      <ul class="features-list">
        <li>Advanced scheduling</li>
        <li>Email analytics</li>
        <li>Save templates</li>
        <li>Email reminders</li>
        <li>Priority support</li>
      </ul>
      
      <button type="submit">
        <span class="button-text">Continue to Payment</span>
        <span class="loading"> Processing...</span>
      </button>
    </form>
    
    <div class="back-link">
      <a href="/">← Back to Home</a>
    </div>
  </div>
  
  <script>
    document.getElementById('checkoutForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const email = document.getElementById('email').value;
      const button = e.target.querySelector('button');
      const buttonText = e.target.querySelector('.button-text');
      const loading = e.target.querySelector('.loading');
      const errorDiv = document.getElementById('error');
      
      // Clear previous errors
      errorDiv.style.display = 'none';
      
      // Disable button and show loading state
      button.disabled = true;
      buttonText.style.display = 'none';
      loading.style.display = 'inline';
      
      try {
        // Call the backend to create a Stripe checkout session
        const response = await fetch('/api/subscriptions/create-checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: email,
            deviceId: 'web-' + Date.now(),
          })
        });
        
        if (!response.ok) {
          throw new Error('Failed to create checkout session');
        }
        
        const data = await response.json();
        
        if (data.sessionUrl) {
          // Redirect to Stripe checkout
          window.location.href = data.sessionUrl;
        } else {
          throw new Error('No checkout URL returned');
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.textContent = 'Error: ' + (error.message || 'Failed to process checkout. Please try again.');
        errorDiv.style.display = 'block';
        
        // Re-enable button
        button.disabled = false;
        buttonText.style.display = 'inline';
        loading.style.display = 'none';
      }
    });
  </script>
</body>
</html>
  `;
  res.send(html);
});

// Success page after Stripe payment - displays license key
app.get('/pro/success', (req, res) => {
  const licenseKey = req.query.license_key || 'NOT_PROVIDED';
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🎉 Payment Successful - SkyPost Pro</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      padding: 40px;
      max-width: 600px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
    }
    h1 { color: #333; margin-bottom: 10px; font-size: 32px; }
    p { color: #666; margin: 15px 0; font-size: 16px; line-height: 1.6; }
    .license-box {
      background: #f5f5f5;
      border: 2px solid #667eea;
      border-radius: 8px;
      padding: 20px;
      margin: 30px 0;
      font-family: 'Courier New', monospace;
      font-size: 20px;
      font-weight: bold;
      color: #333;
      word-break: break-all;
    }
    .button-group {
      display: flex;
      gap: 10px;
      justify-content: center;
      margin-top: 30px;
      flex-wrap: wrap;
    }
    button {
      padding: 12px 24px;
      border: none;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .btn-primary:hover { opacity: 0.9; }
    .btn-secondary {
      background: #e0e0e0;
      color: #333;
    }
    .btn-secondary:hover { background: #d0d0d0; }
    .instructions {
      background: #fffbea;
      border-left: 4px solid #ffc107;
      padding: 15px;
      border-radius: 4px;
      text-align: left;
      margin-top: 20px;
    }
    .instructions ol {
      margin-left: 20px;
      text-align: left;
    }
    .instructions li { margin: 8px 0; color: #555; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎉 Payment Successful!</h1>
    <p>Welcome to SkyPost Pro! Your license has been activated.</p>
    
    <div class="license-box" id="license-display">${licenseKey}</div>
    
    <p><strong>👆 Your License Key - Save it!</strong></p>
    
    <div class="button-group">
      <button class="btn-primary" onclick="copyLicense()">📋 Copy License Key</button>
      <button class="btn-secondary" onclick="closeWindow()">✖ Close</button>
    </div>
    
    <div class="instructions">
      <p><strong>Next Steps:</strong></p>
      <ol>
        <li>Copy your license key above</li>
        <li>Return to the SkyPost extension</li>
        <li>Open Settings → License</li>
        <li>Paste your key in the input field</li>
        <li>Click "Activate"</li>
        <li>Enjoy Pro features! 🚀</li>
      </ol>
    </div>
  </div>
  
  <script>
    function copyLicense() {
      const text = document.getElementById('license-display').textContent;
      navigator.clipboard.writeText(text).then(() => {
        alert('✅ License key copied to clipboard!');
      });
    }
    
    function closeWindow() {
      window.close();
    }
  </script>
</body>
</html>
  `;
  
  res.send(html);
});

// Cancel page - user cancelled payment
app.get('/pro/cancel', (req, res) => {
  res.redirect('/');
});

// Register user and generate license
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const db = await readDatabase();

    // Check if user exists
    if (db.users.find(u => u.email === email)) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Create user
    const userId = uuidv4();
    const user = {
      id: userId,
      email,
      password, // In production, hash this!
      created_at: new Date().toISOString()
    };

    // Generate license key
    const licenseKey = `SKY-${uuidv4().replace(/-/g, '').substr(0, 12).toUpperCase()}`;
    const license = {
      id: uuidv4(),
      user_id: userId,
      key: licenseKey,
      status: 'active',
      tier: 'free',
      created_at: new Date().toISOString(),
      expires_at: null
    };

    db.users.push(user);
    db.licenses.push(license);

    await writeDatabase(db);

    res.json({
      success: true,
      user_id: userId,
      license_key: licenseKey,
      message: 'User registered successfully'
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Verify license
app.post('/api/licenses/verify', async (req, res) => {
  try {
    const { licenseKey } = req.body;

    if (!licenseKey) {
      return res.status(400).json({ error: 'License key required' });
    }

    const db = await readDatabase();
    const license = db.licenses.find(l => l.key === licenseKey);

    if (!license) {
      return res.status(404).json({ valid: false, error: 'License not found' });
    }

    if (license.status !== 'active') {
      return res.status(400).json({ valid: false, error: 'License inactive' });
    }

    const user = db.users.find(u => u.id === license.user_id);

    res.json({
      valid: true,
      license_key: license.key,
      tier: license.tier,
      user_email: user?.email,
      created_at: license.created_at,
      expires_at: license.expires_at
    });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Check if device has Pro license
app.post('/api/licenses/check-device', async (req, res) => {
  try {
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID required' });
    }

    const db = await readDatabase();
    const license = db.licenses.find(l => l.device_id === deviceId);

    if (!license) {
      return res.json({ isPro: false, tier: 'free' });
    }

    const isPro = license.tier === 'pro' && license.status === 'active';
    const isExpired = isPro && new Date(license.expires_at) < new Date();

    res.json({
      isPro: isPro && !isExpired,
      tier: license.tier,
      license_key: license.key,
      expires_at: license.expires_at
    });
  } catch (error) {
    console.error('Device check error:', error);
    res.status(500).json({ error: 'Device check failed' });
  }
});

// Create Stripe checkout session (updated for email-based licensing)
app.post('/api/subscriptions/create-checkout', async (req, res) => {
  try {
    console.log(`\n🛒 [CHECKOUT] Request received`);
    const { deviceId, email, success_url, cancel_url } = req.body;
    console.log(`🛒 [CHECKOUT] Params: deviceId=${deviceId}, email=${email}`);

    console.log(`🛒 [CHECKOUT] Reading database...`);
    const db = await readDatabase();
    console.log(`🛒 [CHECKOUT] Database read successfully`);
    
    // Generate new license key upfront
    const licenseKey = `SKY-${uuidv4().toString().replace(/-/g, '').substr(0, 12).toUpperCase()}`;
    
    // Use provided email or generate a temporary one (will be updated by user later)
    const licenseEmail = email || `temp-${licenseKey.toLowerCase()}@skypost.local`;

    // Create new pending license record
    const newLicense = {
      id: uuidv4(),
      key: licenseKey,
      email: licenseEmail,
      device_id: deviceId || null,
      tier: 'free',
      status: 'pending',
      stripe_customer_id: null,
      created_at: new Date().toISOString(),
      expires_at: null
    };
    
    db.licenses.push(newLicense);
    await writeDatabase(db);

    // Create Stripe checkout session
    console.log(`🛒 [CHECKOUT] Creating Stripe session with PRICE_ID: ${process.env.STRIPE_PRICE_ID}`);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1
        }
      ],
      mode: 'subscription',
      success_url: `https://skypost.app/pro/success?license_key=${licenseKey}`,
      cancel_url: 'https://skypost.app/pro/cancel',
      client_reference_id: licenseKey,
      metadata: {
        license_key: licenseKey,
        device_id: deviceId || 'multi-device',
        email: licenseEmail
      }
    });
    console.log(`🛒 [CHECKOUT] Stripe session created: ${session.id}`);

    // Update license with Stripe customer ID for webhook matching
    newLicense.stripe_session_id = session.id;
    await writeDatabase(db);

    console.log(`📝 Created checkout session for license: ${licenseKey} (${email || deviceId})`);
    console.log(`🛒 [CHECKOUT] Sending response with sessionUrl: ${session.url}`);
    
    res.json({ 
      session_id: session.id, 
      sessionUrl: session.url,
      license_key: licenseKey 
    });
  } catch (error) {
    console.error(`\n❌ [CHECKOUT] ERROR: ${error.message}`);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: 'Checkout creation failed', details: error.message });
  }
});

// Stripe webhook handler

// Check license status for device
app.post('/api/subscriptions/check-license', async (req, res) => {
  try {
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID required' });
    }

    const db = await readDatabase();
    const license = db.licenses.find(l => l.device_id === deviceId);

    if (!license) {
      return res.json({ active: false });
    }

    const isActive = license.tier === 'pro' && license.status === 'active';
    const isExpired = isActive && license.expires_at && new Date(license.expires_at) < new Date();

    res.json({
      active: isActive && !isExpired,
      licenseKey: license.key,
      expiresAt: license.expires_at,
      tier: license.tier
    });
  } catch (error) {
    console.error('License check error:', error);
    res.status(500).json({ error: 'License check failed' });
  }
});

// NEW: Check license by key (with real-time Stripe subscription verification)
app.post('/api/licenses/check', async (req, res) => {
  try {
    const { licenseKey } = req.body;
    console.log(`\n📱 LICENSE CHECK CALLED - Key: ${licenseKey}`);

    if (!licenseKey) {
      return res.status(400).json({ error: 'License key required' });
    }

    const db = await readDatabase();
    console.log(`📂 Total licenses in database: ${db.licenses.length}`);
    
    const license = db.licenses.find(l => l.key === licenseKey);

    if (!license) {
      console.log(`❌ License NOT found: ${licenseKey}`);
      return res.json({ valid: false, isPro: false, tier: 'free' });
    }

    console.log(`✅ License FOUND: ${licenseKey}`);
    
    // Check if license is active
    if (license.status !== 'active') {
      console.log(`❌ License is not active: ${license.status}`);
      return res.json({ valid: false, isPro: false, tier: license.tier, status: license.status });
    }

    // For pro licenses, must have a Stripe customer ID (from actual payment)
    if (license.tier === 'pro') {
      if (!license.stripe_customer_id) {
        console.log(`❌ Pro license missing Stripe customer ID (test key?): ${licenseKey}`);
        return res.json({ valid: false, isPro: false, tier: 'free', reason: 'no_stripe_subscription' });
      }

      try {
        console.log(`🔍 Verifying Stripe subscription for customer: ${license.stripe_customer_id}`);
        
        // Get customer's active subscriptions
        const subscriptions = await stripe.subscriptions.list({
          customer: license.stripe_customer_id,
          status: 'active',
          limit: 1
        });

        if (subscriptions.data.length === 0) {
          console.log(`❌ No active Stripe subscription found for ${license.stripe_customer_id}`);
          return res.json({ 
            valid: false, 
            isPro: false, 
            tier: 'free',
            reason: 'subscription_canceled'
          });
        }

        const subscription = subscriptions.data[0];
        console.log(`✅ Active Stripe subscription found: ${subscription.id}`);
        
        // Return pro status with subscription info
        return res.json({
          valid: true,
          isPro: true,
          tier: 'pro',
          status: license.status,
          email: license.email,
          stripeSubscriptionId: subscription.id,
          currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
          activatedAt: license.activated_at
        });
      } catch (stripeErr) {
        console.error(`⚠️  Error checking Stripe subscription:`, stripeErr.message);
        // If we can't reach Stripe, assume it's valid (fail open)
        return res.json({
          valid: true,
          isPro: true,
          tier: 'pro',
          status: license.status,
          email: license.email,
          activatedAt: license.activated_at,
          warning: 'Could not verify Stripe subscription'
        });
      }
    }

    // Non-pro license or no Stripe customer ID
    res.json({
      valid: true,
      isPro: license.tier === 'pro',
      tier: license.tier,
      status: license.status,
      email: license.email,
      activatedAt: license.activated_at
    });
  } catch (error) {
    console.error('License key check error:', error);
    res.status(500).json({ error: 'License check failed' });
  }
});

// Start server
console.log('📍 About to call initializeDatabase()...');
initializeDatabase();
console.log('📍 About to call app.listen()...');
const server = app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log(`🚀 SkyPost License Backend running on 0.0.0.0:${process.env.PORT || 3000}`);
  console.log('📊 Configuration Check:');
  console.log('  STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? '✅ Loaded' : '❌ MISSING');
  console.log('  STRIPE_PRICE_ID:', process.env.STRIPE_PRICE_ID ? '✅ Loaded' : '❌ MISSING');
  console.log('  STRIPE_WEBHOOK_SECRET:', process.env.STRIPE_WEBHOOK_SECRET ? '✅ Loaded' : '❌ MISSING');
  console.log('  EMAIL_USER:', process.env.EMAIL_USER ? '✅ Loaded' : '❌ MISSING');
  console.log('  EMAIL_PASSWORD:', process.env.EMAIL_PASSWORD ? '✅ Loaded' : '❌ MISSING');
});

// Log when the server actually starts accepting connections
server.on('listening', () => {
  console.log('📡 Server is now accepting connections!');
});

server.on('error', (err) => {
  console.error('❌ Server error:', err);
});
