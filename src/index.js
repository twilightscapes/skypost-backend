const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// File-based storage
const DB_FILE = path.join(__dirname, '../data.json');

// Initialize data file
function initializeDatabase() {
  if (!fs.existsSync(DB_FILE)) {
    const initialData = {
      users: [],
      licenses: [],
      payments: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    console.log('✅ Initialized file-based database');
  } else {
    console.log('✅ Connected to file-based database');
  }
}

function readDatabase() {
  const data = fs.readFileSync(DB_FILE, 'utf8');
  return JSON.parse(data);
}

function writeDatabase(data) {
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

// Email configuration with nodemailer
const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'your-email@gmail.com',
    pass: process.env.EMAIL_PASSWORD || 'your-app-password'
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
      from: process.env.EMAIL_USER,
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
      
      // Find the license by looking for pending licenses with email
      const db = readDatabase();
      let license = null;
      
      // Get email from Stripe charge
      const stripeEmail = charge.billing_details?.email;
      
      // Find the first pending license with matching email
      if (stripeEmail) {
        license = db.licenses.find(l => l.email === stripeEmail && l.status === 'pending');
      }
      
      // If not found by email, find the most recent pending license (fallback)
      if (!license) {
        const pendingLicenses = db.licenses.filter(l => l.status === 'pending');
        if (pendingLicenses.length > 0) {
          license = pendingLicenses[pendingLicenses.length - 1];
        }
      }
      
      if (license) {
        const email = license.email || stripeEmail;
        
        if (email) {
          license.status = 'active';
          license.tier = 'pro';
          license.expires_at = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
          license.activated_at = new Date().toISOString();
          writeDatabase(db);
          
          // Send license email
          await sendLicenseEmail(email, license.key);
          console.log(`✅ License activated: ${license.key} for ${email}`);
        } else {
          console.log(`⚠️ License ${license.key} has no email, skipping email send`);
        }
      } else {
        console.log(`⚠️ No pending license found for charge ${charge.id}`);
      }
    }

    // Legacy: Handle checkout.session.completed (old flow)
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const licenseKey = session.metadata?.license_key;
      const deviceId = session.metadata?.device_id;

      if (licenseKey && deviceId) {
        const db = readDatabase();
        const license = db.licenses.find(l => l.key === licenseKey && l.device_id === deviceId);

        if (license) {
          license.tier = 'pro';
          license.status = 'active';
          license.expires_at = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
          writeDatabase(db);
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

// All other routes use JSON parsing
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

// Register user and generate license
app.post('/api/auth/register', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const db = readDatabase();

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

    writeDatabase(db);

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
app.post('/api/licenses/verify', (req, res) => {
  try {
    const { licenseKey } = req.body;

    if (!licenseKey) {
      return res.status(400).json({ error: 'License key required' });
    }

    const db = readDatabase();
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
app.post('/api/licenses/check-device', (req, res) => {
  try {
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID required' });
    }

    const db = readDatabase();
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
    const { deviceId, email, success_url, cancel_url } = req.body;

    if (!deviceId && !email) {
      return res.status(400).json({ error: 'Device ID or email required' });
    }

    const db = readDatabase();
    
    // Generate new license key upfront
    const licenseKey = `SKY-${uuidv4().toString().replace(/-/g, '').substr(0, 12).toUpperCase()}`;
    
    // Create new pending license record
    const newLicense = {
      id: uuidv4(),
      key: licenseKey,
      email: email || null,
      device_id: deviceId || null,
      tier: 'free',
      status: 'pending',
      stripe_customer_id: null,
      created_at: new Date().toISOString(),
      expires_at: null
    };
    
    db.licenses.push(newLicense);
    writeDatabase(db);

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1
        }
      ],
      mode: 'subscription',
      customer_email: email || undefined,
      success_url: success_url || 'https://skypost.app/pro/success',
      cancel_url: cancel_url || 'https://skypost.app/pro/cancel',
      client_reference_id: licenseKey,
      metadata: {
        license_key: licenseKey,
        device_id: deviceId || 'multi-device',
        email: email || 'not-provided'
      }
    });

    // Update license with Stripe customer ID for webhook matching
    newLicense.stripe_session_id = session.id;
    writeDatabase(db);

    console.log(`📝 Created checkout session for license: ${licenseKey} (${email || deviceId})`);
    
    res.json({ 
      session_id: session.id, 
      sessionUrl: session.url,
      license_key: licenseKey 
    });
  } catch (error) {
    console.error('❌ Checkout error:', error.message || error);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: 'Checkout creation failed', details: error.message });
  }
});

// Stripe webhook handler

// Check license status for device
app.post('/api/subscriptions/check-license', (req, res) => {
  try {
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID required' });
    }

    const db = readDatabase();
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
app.post('/api/licenses/check', (req, res) => {
  try {
    const { licenseKey } = req.body;

    if (!licenseKey) {
      return res.status(400).json({ error: 'License key required' });
    }

    const db = readDatabase();
    const license = db.licenses.find(l => l.key === licenseKey);

    if (!license) {
      return res.json({ valid: false, isPro: false, tier: 'free' });
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
initializeDatabase();
app.listen(PORT, () => {
  console.log(`🚀 SkyPost License Backend running on port ${PORT}`);
  console.log('📊 Configuration Check:');
  console.log('  STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? '✅ Loaded' : '❌ MISSING');
  console.log('  STRIPE_PRICE_ID:', process.env.STRIPE_PRICE_ID ? '✅ Loaded' : '❌ MISSING');
  console.log('  STRIPE_WEBHOOK_SECRET:', process.env.STRIPE_WEBHOOK_SECRET ? '✅ Loaded' : '❌ MISSING');
  console.log('  EMAIL_USER:', process.env.EMAIL_USER ? '✅ Loaded' : '❌ MISSING');
  console.log('  EMAIL_PASSWORD:', process.env.EMAIL_PASSWORD ? '✅ Loaded' : '❌ MISSING');
});
