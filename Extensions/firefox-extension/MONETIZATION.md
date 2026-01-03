# SkyPost - Monetization Guide

## Directory Structure

- **`/safari-extension`** - Free version (original, unchanged)
- **`/safari-extension-pro`** - Monetized Pro version (new)

Keep both versions separate to maintain the free tier while developing premium features.

## Pro Features Implementation

### New Files Added to Pro Version

- **`license.js`** - License verification and feature management
- **`pro-settings.html`** - Settings page for Pro features and license activation

### Feature Tiers

#### Free Plan (Safari Extension)
- ✅ Unlimited manual posts
- ✅ Basic scheduling (5 pending posts max)
- ✅ Link preview cards
- ✅ Image uploads
- ✅ Post history tracking
- ✅ Calendar view

#### Pro Plan ($9.99/month)
- ✅ Unlimited scheduled posts
- ✅ Post analytics (views, likes, replies)
- ✅ Best time to post recommendations
- ✅ Post templates & presets
- ✅ Advanced link previews with custom descriptions
- ✅ Bulk import (CSV/JSON)
- ✅ Priority support

## Implementing Monetization

### Step 1: Enable License Checking

In `workspace.js`, wrap pro features with license checks:

```javascript
if (licenseManager.canUseFeature('bulkScheduling')) {
  // Allow bulk scheduling
} else {
  this.showMessage('Upgrade to Pro to schedule more posts', 'info');
  window.location.href = 'pro-settings.html';
}
```

### Step 2: Add Pro Settings Link

In `workspace.html`, add a gear icon to open Pro settings:

```html
<button id="pro-settings" title="Pro Features" style="margin-left: auto;">⚙️ Pro</button>
```

```javascript
document.getElementById('pro-settings').addEventListener('click', () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('pro-settings.html')
  });
});
```

### Step 3: Setup Payment Backend

Replace `https://your-payment-backend.com` in `license.js` with:

**Option A: Stripe (Recommended)**
- Create Stripe account
- Setup subscription products
- Backend endpoint: `/verify-license` validates license keys
- Returns: `{ expiresAt: "2025-01-31T00:00:00Z" }`

**Option B: Paddle (No Backend Needed)**
- Use Paddle's hosted checkout
- Directly issue license keys
- Simpler but less control

**Option C: Custom Backend**
- Use your own server
- Issue time-limited license keys
- Store license in database

### Step 4: License Key Format

Generate keys like: `BLUESKY-PRO-XXXX-YYYY-EXPIRY-HASH`

Example validation:
```javascript
const validateLicense = (key) => {
  const parts = key.split('-');
  return parts.length === 6 && parts[0] === 'BLUESKY' && parts[1] === 'PRO';
};
```

## Revenue Model

### Pricing Strategy
- **$9.99/month** - Entry level (competitive with Buffer, Later)
- **$19.99/month** - Team plan (future)
- **$99/year** - Annual (better deal, more committed users)

### Payment Flow

1. User clicks "Get Pro Access" button
2. Opens your pricing page (Stripe checkout, Paddle, etc.)
3. Payment processed
4. User receives license key
5. User pastes key in Pro Settings
6. License activated in extension
7. Pro features unlock

## Marketing

**Where to Promote:**
- Bluesky communities & starter packs
- Product Hunt (free version first)
- Indie Hackers
- Tech Twitter (now Bluesky!)
- Reddit: r/Bluesky, r/socialmedia

**Free → Pro Strategy:**
- Launch free version to build user base
- Gather feedback (1-2 months)
- Add first pro feature based on feedback
- Launch pro tier
- Expect 5-10% conversion rate

## Implementation Checklist

- [ ] Set up Stripe/Paddle/payment processor
- [ ] Create backend endpoint for license verification
- [ ] Update `license.js` with backend URL
- [ ] Add Pro settings button to workspace UI
- [ ] Add feature unlock checks throughout codebase
- [ ] Create landing page with pricing
- [ ] Test license activation flow
- [ ] Set up analytics to track pro conversions
- [ ] Create help docs for Pro features
- [ ] Plan email automation for free→pro nurture

## Next Steps

1. Choose payment processor
2. Set up backend license verification
3. Start with 1-2 marquee pro features
4. Release free version first
5. Monitor adoption and feedback
6. Roll out pro features incrementally

## File Locations

- License manager: `safari-extension-pro/license.js`
- Pro settings UI: `safari-extension-pro/pro-settings.html`
- Manifest (Pro): `safari-extension-pro/manifest.json`
