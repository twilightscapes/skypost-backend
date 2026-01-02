require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

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

// Initialize SQLite database
const db = new sqlite3.Database('licenses.db', (err) => {
  if (err) {
    console.error('Database connection error:', err);
    process.exit(1);
  }
  console.log('✅ Connected to SQLite database');
  initializeDatabase();
});

function initializeDatabase() {
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Licenses table
    db.run(`
      CREATE TABLE IF NOT EXISTS licenses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        license_key TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'active',
        features TEXT DEFAULT '{"workspace":true,"scheduling":true}',
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Stripe sessions table (for tracking payment status)
    db.run(`
      CREATE TABLE IF NOT EXISTS stripe_sessions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        license_key TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });
}

// Root health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'SkyPost Pro Backend', version: '1.0.0' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Register user and generate license
app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const userId = uuidv4();
  const licenseKey = `SKY-${Math.random().toString(36).substring(2, 12).toUpperCase()}`;
  const licenseId = uuidv4();

  db.run(
    'INSERT INTO users (id, email, password) VALUES (?, ?, ?)',
    [userId, email, password],
    (err) => {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'Email already registered' });
        }
        return res.status(500).json({ error: 'Registration failed' });
      }

      // Create license
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1); // 1 month trial

      db.run(
        'INSERT INTO licenses (id, user_id, license_key, expires_at) VALUES (?, ?, ?, ?)',
        [licenseId, userId, licenseKey, expiresAt.toISOString()],
        (err) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to create license' });
          }

          res.json({
            user: { id: userId, email },
            license: { licenseKey, status: 'active', expiresAt },
            message: '✅ Registered! 1-month trial license activated.'
          });
        }
      );
    }
  );
});

// Verify license
app.post('/api/licenses/verify', (req, res) => {
  const { licenseKey } = req.body;
  if (!licenseKey) {
    return res.status(400).json({ valid: false, error: 'License key required' });
  }

  db.get(
    'SELECT * FROM licenses WHERE license_key = ?',
    [licenseKey],
    (err, license) => {
      if (err) {
        return res.status(500).json({ valid: false, error: 'Database error' });
      }

      if (!license) {
        return res.json({ valid: false, error: 'License not found' });
      }

      // Check expiration
      const expiresAt = new Date(license.expires_at);
      if (expiresAt < new Date()) {
        return res.json({ valid: false, error: 'License expired' });
      }

      res.json({
        valid: true,
        license: {
          id: license.id,
          status: license.status,
          features: JSON.parse(license.features || '{}'),
          expiresAt: license.expires_at
        }
      });
    }
  );
});

// Create Stripe checkout session
app.post('/api/subscriptions/create-checkout', async (req, res) => {
  const { userEmail } = req.body;
  if (!userEmail) {
    return res.status(400).json({ error: 'Email required' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1
        }
      ],
      success_url: 'https://skypost.app/pro/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://skypost.app/pro/cancel',
      customer_email: userEmail,
      metadata: {
        userEmail
      }
    });

    // Store session for webhook tracking
    const sessionId = uuidv4();
    db.run(
      'INSERT INTO stripe_sessions (id, session_id, user_email, status) VALUES (?, ?, ?, ?)',
      [sessionId, session.id, userEmail, 'pending'],
      (err) => {
        if (err) {
          console.error('Failed to store session:', err);
        }
      }
    );

    res.json({ 
      sessionId: session.id, 
      sessionUrl: session.url,
      message: 'Checkout session created'
    });
  } catch (error) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Stripe webhook handler
app.post('/webhooks/stripe', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const rawBody = req.body;

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'charge.succeeded') {
      const charge = event.data.object;
      const email = charge.billing_details?.email || charge.metadata?.userEmail;
      
      if (email) {
        console.log(`✅ Payment succeeded for ${email}`);
        
        // Create license for the user
        db.get('SELECT id FROM users WHERE email = ?', [email], (err, user) => {
          if (err) {
            console.error('Error finding user:', err);
            return;
          }

          if (!user) {
            // Auto-create user if doesn't exist
            const userId = uuidv4();
            db.run('INSERT INTO users (id, email, password) VALUES (?, ?, ?)',
              [userId, email, 'stripe_payment'],
              (err) => {
                if (!err) {
                  createProLicense(userId, email);
                }
              }
            );
          } else {
            createProLicense(user.id, email);
          }
        });
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

function createProLicense(userId, email) {
  const licenseKey = `SKY-${Math.random().toString(36).substring(2, 12).toUpperCase()}`;
  const licenseId = uuidv4();
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 1); // 1-month subscription

  db.run(
    'INSERT INTO licenses (id, user_id, license_key, status, expires_at) VALUES (?, ?, ?, ?, ?)',
    [licenseId, userId, licenseKey, 'active', expiresAt.toISOString()],
    (err) => {
      if (!err) {
        console.log(`✅ License created: ${licenseKey} for ${email}`);
      }
    }
  );
}

// Get license by email (for user dashboard)
app.get('/api/user/license/:email', (req, res) => {
  const { email } = req.params;
  
  db.get(
    'SELECT l.* FROM licenses l JOIN users u ON l.user_id = u.id WHERE u.email = ? ORDER BY l.created_at DESC LIMIT 1',
    [email],
    (err, license) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!license) {
        return res.json({ found: false, message: 'No license found' });
      }

      res.json({
        found: true,
        license: {
          licenseKey: license.license_key,
          status: license.status,
          expiresAt: license.expires_at
        }
      });
    }
  );
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  db.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 SkyPost Pro Backend running on port ${PORT}`);
  console.log(`📊 Stripe integration enabled`);
  console.log(`💾 Using SQLite database (licenses.db)`);
});
