// License management for Pro features
class LicenseManager {
  constructor() {
    this.LICENSE_KEY = 'proLicenseKey';
    this.LICENSE_EXPIRY = 'proLicenseExpiry';
    this.loadLicense();
  }

  loadLicense() {
    return new Promise((resolve) => {
      chrome.storage.local.get([this.LICENSE_KEY, this.LICENSE_EXPIRY], (result) => {
        // Remove old test licenses
        if (result[this.LICENSE_KEY] === 'BLUESKY-PRO-TEST-2025-UNLIMITED') {
          chrome.storage.local.remove([this.LICENSE_KEY, this.LICENSE_EXPIRY], () => {
            this.licenseKey = null;
            this.licenseExpiry = null;
            resolve();
          });
          return;
        }
        
        this.licenseKey = result[this.LICENSE_KEY];
        this.licenseExpiry = result[this.LICENSE_EXPIRY];
        resolve();
      });
    });
  }

  // Check if user has valid pro license
  isProUser() {
    if (!this.licenseKey) return false;
    if (!this.licenseExpiry) return false;
    return new Date(this.licenseExpiry) > new Date();
  }

  // Get remaining days
  getRemainingDays() {
    if (!this.isProUser()) return 0;
    const expiry = new Date(this.licenseExpiry);
    const now = new Date();
    const days = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    return Math.max(0, days);
  }

  // Activate license with key (from email or manual entry)
  async activateLicense(licenseKey) {
    try {
      // Verify license key with backend (key-based lookup)
      const response = await fetch('https://skypost-backend-production.up.railway.app/api/licenses/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey })
      });

      if (!response.ok) {
        throw new Error('Invalid license key');
      }

      const data = await response.json();
      
      if (!data.valid || !data.isPro) {
        throw new Error(data.error || 'License is not active or not Pro');
      }

      // Store license
      const expiresAt = data.expiresAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      
      await new Promise((resolve) => {
        chrome.storage.local.set({
          [this.LICENSE_KEY]: licenseKey,
          [this.LICENSE_EXPIRY]: expiresAt
        }, resolve);
      });

      // Reload license from storage to ensure state is fresh
      await this.loadLicense();
      
      console.log('✅ License activated and reloaded:', { licenseKey, expiresAt });
      return { success: true, message: '✅ License activated!', expiresAt };
    } catch (err) {
      console.error('License activation error:', err);
      return { success: false, error: err.message };
    }
  }

  // Deactivate license
  async deactivateLicense() {
    return new Promise((resolve) => {
      chrome.storage.local.remove([this.LICENSE_KEY, this.LICENSE_EXPIRY], () => {
        this.licenseKey = null;
        this.licenseExpiry = null;
        resolve();
      });
    });
  }

  // Get feature list
  getFeatureList() {
    return {
      free: [
        { name: 'Basic Posts', limit: 'Unlimited' },
        { name: 'Local Storage', limit: 'Full' },
        { name: 'Text Formatting', limit: 'Basic' },
        { name: 'Manual Posting', limit: 'Yes' }
      ],
      pro: [
        { name: 'Scheduled Posts' },
        { name: 'Analytics' },
        { name: 'Custom link & video cards' },
        { name: 'Priority Support' }
      ]
    };
  }

  // Check if user can use a specific feature
  canUseFeature(feature) {
    const proFeatures = ['analytics', 'scheduled', 'templates', 'priority', 'advancedPreviews'];
    if (!proFeatures.includes(feature)) return true; // Free features always available
    return this.isProUser();
  }
}
