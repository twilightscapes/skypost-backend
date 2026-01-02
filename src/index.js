const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
app.use(express.json());

// Raw body for webhook signature verification
app.use(express.raw({type: 'application/json'}, (req, res, next) => {
  if (req.path === '/webhooks/stripe') {
    return next();
  }
  express.json()(req, res, next);
}));

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

// Create Stripe checkout session
app.post('/api/subscriptions/create-checkout', async (req, res) => {
  try {
    const { deviceId, success_url, cancel_url } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID required' });
    }

    const db = readDatabase();
    let license = db.licenses.find(l => l.device_id === deviceId);

    // Create license if it doesn't exist
    if (!license) {
      const newLicense = {
        id: require('crypto').randomUUID(),
        device_id: deviceId,
        key: 'SKY-' + Math.random().toString(36).substr(2, 8).toUpperCase(),
        tier: 'free',
        created_at: new Date().toISOString(),
        expires_at: null
      };
      db.licenses.push(newLicense);
      writeDatabase(db);
      license = newLicense;
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1
        }
      ],
      mode: 'subscription',
      success_url: success_url || 'https://skypost.app/pro/success',
      cancel_url: cancel_url || 'https://skypost.app/pro/cancel',
      client_reference_id: license.key,
      metadata: {
        license_key: license.key,
        device_id: deviceId
      }
    });

    res.json({ session_id: session.id, sessionUrl: session.url });
  } catch (error) {
    console.error('❌ Checkout error:', error.message || error);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: 'Checkout creation failed', details: error.message });
  }
});

// Stripe webhook handler
app.post('/webhooks/stripe', express.raw({type: 'application/json'}), (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === 'charge.succeeded') {
      const charge = event.data.object;
      const licenseKey = charge.metadata?.license_key;
      const deviceId = charge.metadata?.device_id;

      if (licenseKey && deviceId) {
        const db = readDatabase();
        const license = db.licenses.find(l => l.key === licenseKey && l.device_id === deviceId);

        if (license) {
          license.tier = 'pro';
          license.status = 'active';
          license.expires_at = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        }

        // Record payment
        db.payments.push({
          id: uuidv4(),
          license_key: licenseKey,
          device_id: deviceId,
          amount: charge.amount,
          currency: charge.currency,
          stripe_charge_id: charge.id,
          created_at: new Date().toISOString()
        });

        writeDatabase(db);
        console.log(`✅ License ${licenseKey} upgraded to Pro`);
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error.message);
    res.status(400).send(`Webhook Error: ${error.message}`);
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
});
