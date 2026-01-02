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
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🔧 PORT from environment:', PORT);

// PostgreSQL connection (from DATABASE_URL on Render)
let pool = null;
let useFileStorage = false;

function initializeDatabase() {
  console.log('⚠️  Skipping database init for debugging');
  useFileStorage = true;
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

// Enable JSON parsing
app.use(express.json());

// Health check endpoint for Railway
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ message: 'Backend is working!' });
});

// Email configuration with nodemailer
// Using Mailgun for reliability (free tier available, very reliable on Render)
const emailTransporter = nodemailer.createTransport({
  host: 'smtp.mailgun.org',
  port: 587,
  secure: false,
  auth: {
    user: process.env.MAILGUN_SMTP_USER || process.env.EMAIL_USER || 'postmaster@sandbox.mailgun.org',
    pass: process.env.MAILGUN_SMTP_PASSWORD || process.env.EMAIL_PASSWORD || 'your-mailgun-password'
  }
});

// Send license email
async function sendLicenseEmail(email, licenseKey) {
  try {
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Welcome to SkyPost Pro!</h2>
        <p>Thank you for upgrading to SkyPost Pro. Your license has been activated.</p>
        
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Your License Key:</strong></p>
          <p style="font-size: 18px; font-family: monospace; color: #0066cc; word-break: break-all;">${licenseKey}</p>
        </div>
        
        <h3>How to Activate:</h3>
        <ol>
          <li>Open the SkyPost extension</li>
          <li>Go to Settings → License</li>
          <li>Click "Activate License"</li>
          <li>Paste your license key above</li>
          <li>Click "Verify License"</li>
        </ol>
        
        <h3>Pro Features:</h3>
        <ul>
          <li>Unlimited notes</li>
          <li>Advanced formatting</li>
          <li>Priority support</li>
          <li>Works on all devices with your licenst ae key</li>
        </ul>
        
        <p style="color: #666; font-size: 12px; margin-top: 30px;">
          If you have any questions, please contact support@skypost.io
        </p>
      </div>
    `;
    
    await emailTransporter.sendMail({
      from: process.env.EMAIL_USER || 'noreply@skypost.io',
      to: email,
      subject: '🎉 Your SkyPost Pro License Key',
      html: htmlContent
    });
    
    console.log(`✅ License email sent to ${email}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send license email to ${email}:`, error.message);
    return false;
  }
}

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
        const email = license.email || stripeEmail;
        console.log(`✅ Found license to activate: ${license.key}`);
        
        // Always activate, even if no email
        license.status = 'active';
        license.tier = 'pro';
        license.expires_at = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        license.activated_at = new Date().toISOString();
        
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
            console.error(`⚠️ Email failed (but license is activated):`, emailErr.message);
          }
        } else {
          console.log(`⚠️ No email to send (license still activated)`);
        }
        
        console.log(`✅ License fully processed: ${license.key}`);
      } else {
        console.log(`❌ No pending license found to activate for charge ${charge.id}`);
        console.log(`📊 All licenses in database:`, db.licenses.map(l => ({ key: l.key, email: l.email, status: l.status })));
      }
    }

    // Legacy: Handle checkout.session.completed (old flow)
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const licenseKey = session.metadata?.license_key;
      const deviceId = session.metadata?.device_id;

      if (licenseKey && deviceId) {
        const db = await readDatabase();
        const license = db.licenses.find(l => l.key === licenseKey && l.device_id === deviceId);

        if (license) {
          license.tier = 'pro';
          license.status = 'active';
          license.expires_at = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
          await writeDatabase(db);
          console.log(`✅ License ${licenseKey} upgraded to Pro (from checkout session)`);
        }
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error.message);
    res.status(400).send(`Webhook Error: ${error.message}`);
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok' });
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
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Cancelled - SkyPost Pro</title>
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
      max-width: 500px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
    }
    h1 { color: #333; margin-bottom: 10px; font-size: 28px; }
    p { color: #666; margin: 15px 0; font-size: 16px; }
    button {
      padding: 12px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 20px;
    }
    button:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Payment Cancelled</h1>
    <p>Your payment was not completed. You can try again anytime from the SkyPost extension.</p>
    <button onclick="window.close()">Close</button>
  </div>
</body>
</html>
  `;
  res.send(html);
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
      success_url: `https://skypost-backend-production.up.railway.app/pro/success?license_key=${licenseKey}`,
      cancel_url: 'https://skypost-backend-production.up.railway.app/pro/cancel',
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

// NEW: Check license by key (email-based system)
app.post('/api/licenses/check', async (req, res) => {
  try {
    const { licenseKey } = req.body;
    console.log(`\n📱 LICENSE CHECK CALLED - Key: ${licenseKey}`);

    if (!licenseKey) {
      return res.status(400).json({ error: 'License key required' });
    }

    const db = await readDatabase();
    console.log(`📂 Total licenses in database: ${db.licenses.length}`);
    console.log(`📋 All license keys: ${db.licenses.map(l => l.key).join(', ')}`);
    
    const license = db.licenses.find(l => l.key === licenseKey);

    if (!license) {
      console.log(`❌ License NOT found: ${licenseKey}`);
      return res.json({ valid: false, isPro: false, tier: 'free' });
    }

    console.log(`✅ License FOUND: ${licenseKey}`);
    // Auto-activate any license on first check (whether pending or any status)
    // This ensures licenses created during checkout are activated
    console.log(`🔍 License found: ${licenseKey} - Current status: ${license.status}, tier: ${license.tier}`);
    
    if (license.status !== 'active' || license.tier !== 'pro') {
      license.status = 'active';
      license.tier = 'pro';
      license.expires_at = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      license.activated_at = new Date().toISOString();
      await writeDatabase(db);
      console.log(`✅ License ${licenseKey} activated - New status: ${license.status}, tier: ${license.tier}`);
    }

    const isActive = license.status === 'active' && license.tier === 'pro';
    const isExpired = isActive && license.expires_at && new Date(license.expires_at) < new Date();

    res.json({
      valid: true,
      isPro: isActive && !isExpired,
      tier: license.tier,
      status: license.status,
      email: license.email,
      expiresAt: license.expires_at,
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
const server = app.listen(PORT, '::', () => {
  console.log(`🚀 SkyPost License Backend running on [::]:${PORT}`);
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
