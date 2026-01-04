# SkyPost Store Submission Checklist

## Pre-Submission Preparation

### Version Management
- [ ] Update version number in manifest.json (currently 1.1.3)
- [ ] Write release notes for changelog
- [ ] Update app website with new version info
- [ ] Create git tag for release: `git tag v1.1.3`

### Content Requirements

#### Firefox Add-ons (AMO)
- [ ] XPI file built and tested
- [ ] Detailed privacy policy ready
- [ ] Screenshots (2+ recommended, 1280x720px)
- [ ] Support email configured
- [ ] Category selected: Productivity
- [ ] Release notes written

#### Chrome Web Store
- [ ] ZIP file created from dist folder
- [ ] Icon (128x128px PNG)
- [ ] Screenshots (1280x800px, at least 2)
- [ ] Promotional image (optional, 440x280px)
- [ ] Privacy policy URL
- [ ] Permissions justified in description

#### Safari App Store
- [ ] Apple Developer Account created ($99/year)
- [ ] Xcode installed on macOS
- [ ] Code signing certificate obtained
- [ ] macOS app bundle created with extension
- [ ] App signed and notarized
- [ ] App Store Connect account set up
- [ ] Screenshots prepared (1280x800px, 5-8 recommended)
- [ ] Privacy policy and support URLs ready

### Account Setup

#### Firefox
- [ ] Mozilla account created
- [ ] Browser ID for extension: `skypost@example.com` ✓
- [ ] Ready to login to addons.mozilla.org

#### Chrome
- [ ] Google Developer account created
- [ ] $5 registration fee paid
- [ ] Developer dashboard accessible

#### Safari
- [ ] Apple Developer Program enrolled ($99)
- [ ] App Store Connect access confirmed
- [ ] Developer ID certificates installed in Keychain
- [ ] Two-factor authentication enabled

### Legal & Privacy

- [ ] Privacy policy written and hosted at skypost.app
- [ ] Terms of service created (optional but recommended)
- [ ] GDPR compliance reviewed (if applicable)
- [ ] Data collection practices documented
- [ ] Privacy policy links added to all store listings

### Marketing Assets

- [ ] Logo/icon finalized
- [ ] Screenshots showing key features
  - Compose interface
  - Scheduling feature
  - Analytics view
  - Multiple posts/drafts
- [ ] Promotional copy written
- [ ] Tagline finalized: "Post Composer and Scheduler for Bluesky"
- [ ] Feature list prepared

---

## Submission Steps by Platform

### 1. Firefox Add-ons (Easiest - Start Here!)

**Timeline:** 1-5 days for review

```bash
# Checklist
- [ ] Review current XPI at: firefox-extension/skypost-firefox.xpi
- [ ] Test on clean Firefox installation
- [ ] Go to: https://addons.mozilla.org/en-US/developers/
- [ ] Click "Submit a New Add-on"
- [ ] Upload .xpi file
- [ ] Fill in listing details (see main guide)
- [ ] Accept content rating survey
- [ ] Submit for review
- [ ] Monitor status in dashboard
```

**Expected Approval:** 1-5 days

---

### 2. Chrome Web Store (Medium - 2nd)

**Timeline:** 1-3 hours for review

```bash
# Checklist
- [ ] Create ZIP from Safari build:
      cd safari-extension-pro/dist && zip -r skypost.zip .
- [ ] Prepare icon (128x128px)
- [ ] Take/prepare 2+ screenshots
- [ ] Go to: https://chrome.google.com/webstore/devconsole
- [ ] Click "New Item"
- [ ] Upload ZIP file
- [ ] Fill listing (see main guide)
- [ ] Upload graphics
- [ ] Review permissions and privacy
- [ ] Submit for review
- [ ] Monitor status
```

**Expected Approval:** 1-3 hours

---

### 3. Safari App Store (Complex - 3rd)

**Timeline:** 3-7 days total (includes notarization + review)

```bash
# Checklist
- [ ] Enroll in Apple Developer Program ($99)
- [ ] Install Xcode: xcode-select --install
- [ ] Create macOS app bundle with extension
- [ ] Code sign: codesign --deep --force --sign - SkyPost.app
- [ ] Verify: codesign --verify --verbose SkyPost.app
- [ ] Create ZIP: ditto -c -k --sequesterRsrc SkyPost.app skypost.zip
- [ ] Notarize: xcrun notarytool submit skypost.zip --apple-id <email>
- [ ] Wait for notarization (5-30 min)
- [ ] Staple: xcrun stapler staple SkyPost.app
- [ ] Access App Store Connect: https://appstoreconnect.apple.com
- [ ] Create new app in ASC
- [ ] Fill app information (see Safari guide)
- [ ] Upload screenshots (1280x800px, 5-8)
- [ ] Add app to release version
- [ ] Submit for review
- [ ] Wait 1-3 days for review
- [ ] Respond to any reviewer feedback
- [ ] Monitor for approval
```

**Expected Approval:** 1-3 days (after notarization)

---

## Store Listing Template

### Name & Summary
- **Store:** Firefox / Chrome / Safari
- **Name:** SkyPost
- **Tagline:** Post Composer and Scheduler for Bluesky
- **Category:** Productivity

### Description
```
SkyPost is the essential companion for Bluesky users who want to 
compose, schedule, and track their posts.

KEY FEATURES:
✓ Rich post composer with formatting options
✓ Schedule posts to publish at optimal times  
✓ Track engagement with analytics
✓ Manage multiple drafts simultaneously
✓ Auto-detect YouTube links with hashtag suggestions
✓ Custom link preview metadata and thumbnails

PERFECT FOR:
- Content creators and influencers
- Community managers
- Regular Bluesky users wanting scheduling power
- Anyone who writes better with a powerful editor

PRIVACY FIRST:
All your data stays on your device. We never store your posts, 
credentials, or session information on our servers.
```

### Support & Privacy
- **Website:** https://skypost.app
- **Support:** support@skypost.app
- **Privacy Policy:** https://skypost.app/privacy
- **GitHub:** (if public repository)

---

## Post-Submission

### Timeline for All Platforms
| Platform | Review Time | Time to Live |
|----------|-------------|--------------|
| Firefox | 1-5 days | 2-6 days |
| Chrome | 1-3 hours | 1-4 hours |
| Safari | 1-3 days | 2-4 days |

### Monitoring Dashboard Links
- **Firefox:** https://addons.mozilla.org/en-US/developers/addons
- **Chrome:** https://chrome.google.com/webstore/devconsole
- **Safari:** https://appstoreconnect.apple.com

### After Approval
- Updates go live automatically on Firefox/Chrome
- Safari updates require re-submission to App Store
- Email support team to announce availability

---

## Important Reminders

1. **Test Before Submitting**
   - Install on fresh browser
   - Verify all features work
   - Check permissions are justified

2. **Version Consistency**
   - Keep manifest.json version in sync with store listings
   - Update all platforms together for major releases

3. **Review Policies**
   - Firefox: Read Mozilla Add-on Policies
   - Chrome: Read Chrome Web Store Program Policies  
   - Safari: Read App Store Review Guidelines

4. **Security**
   - No API keys in extension code
   - Use secure storage for user data
   - Validate all user inputs

5. **Permissions**
   - Request minimum necessary permissions
   - Justify each permission in description
   - Remove unused permissions

---

## Build Commands for Submission

```bash
# Firefox (already built)
# Located at: firefox-extension/skypost-firefox.xpi

# Chrome - Create submission ZIP
cd safari-extension-pro/dist && \
  zip -r ../../store-submissions/chrome/skypost-v1.1.3.zip . && \
  cd ../../

# Safari - Create app bundle (more complex - see Safari guide)
# Requires Xcode and macOS
```

---

## First-Time Submission Order

1. **Start with Firefox** - Quickest to approve
2. **Then Chrome** - Very fast review  
3. **Finally Safari** - Most complex, allow more time

This gives you momentum and confidence before tackling Safari.

---

## Questions to Answer Before Submitting

- [ ] What permissions does the extension need? Why?
- [ ] Where does user data get stored?
- [ ] Who pays for server costs (if any)?
- [ ] What's the privacy policy?
- [ ] Is there a support email address?
- [ ] Will you provide updates regularly?
- [ ] What's the monetization strategy (free, paid, ads)?

---

## Success Criteria

✓ All three platforms live and distributing SkyPost  
✓ User base growing organically  
✓ Positive reviews on all stores  
✓ Update cycle: minor updates monthly, features quarterly  
✓ Community feedback integrated into roadmap
