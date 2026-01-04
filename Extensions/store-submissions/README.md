# SkyPost - Store Submission Summary

**App Name:** SkyPost  
**Website:** https://skypost.app  
**Current Version:** 1.1.3  
**Build Date:** January 4, 2026

---

## Quick Reference

### Your Current Status
✅ **Firefox Build:** Ready (XPI file exists)  
✅ **Chrome Build:** Ready (ZIP created from Safari source)  
⏳ **Safari Build:** Requires manual setup (Xcode + code signing)

### Build Files Location
```
Extensions/store-submissions/
├── firefox/
│   └── skypost-v1.1.3.xpi          ← Ready for AMO submission
├── chrome/
│   └── skypost-v1.1.3.zip          ← Ready for Chrome Web Store
└── safari/
    ├── SAFARI_DETAILED_GUIDE.md     ← Follow this for app bundling
    └── (manual app bundle needed)
```

### Documentation Files
1. **SUBMISSION_GUIDE.md** - Complete guide for all 3 platforms
2. **SUBMISSION_CHECKLIST.md** - Step-by-step checklist with timelines
3. **safari/SAFARI_DETAILED_GUIDE.md** - Detailed Safari-specific instructions
4. **prepare-builds.sh** - Automated script to organize builds

---

## Submission Timeline

### Recommended Order (Fastest → Most Complex)

#### 1️⃣ Firefox Add-ons (AMO) - START HERE
- **Time to Approve:** 1-5 days
- **Effort:** 30 minutes
- **File Ready:** ✅ skypost-v1.1.3.xpi
- **Key URL:** https://addons.mozilla.org/en-US/developers/

**Steps:**
1. Log in or create Mozilla account
2. Go to AMO Developer Dashboard
3. Click "Submit a New Add-on"
4. Upload the .xpi file
5. Fill listing details (name, description, category, privacy policy)
6. Submit for review

**Status Check:** Mozilla reviews your extension and approves/requests changes

---

#### 2️⃣ Chrome Web Store - SECOND
- **Time to Approve:** 1-3 hours
- **Effort:** 30 minutes  
- **File Ready:** ✅ skypost-v1.1.3.zip
- **Key URL:** https://chrome.google.com/webstore/devconsole

**Steps:**
1. Create/Login to Google Developer Account
2. Pay $5 registration (one-time)
3. Go to Web Store Developer Dashboard
4. Click "New Item"
5. Upload the .zip file
6. Fill listing details
7. Upload graphics (icon, screenshots)
8. Submit for review

**Status Check:** Usually approved within 1-3 hours

---

#### 3️⃣ Safari App Store - MOST COMPLEX
- **Time to Approve:** 3-7 days total
- **Effort:** 2-3 hours
- **File Ready:** ❌ Requires manual setup
- **Key URL:** https://appstoreconnect.apple.com

**Prerequisites:**
- Apple Developer Program ($99/year) enrollment
- Xcode installed on macOS
- Code signing certificate

**Steps:**
1. Read `safari/SAFARI_DETAILED_GUIDE.md`
2. Enroll in Apple Developer Program
3. Create macOS app bundle with extension
4. Code sign and notarize the app
5. Access App Store Connect
6. Create new app listing
7. Upload app and graphics
8. Submit for review

**Status Check:** Typically approved 1-3 days after submission

---

## Quick Commands

### Rebuild & Prepare Submission Packages
```bash
# Go to Extensions directory
cd /Volumes/Basement/Sites/skypost-backend/Extensions

# Rebuild extensions
cd firefox-extension && ./build-firefox.sh && cd ..
cd safari-extension-pro && bash build.sh && cd ..

# Organize submission files
./store-submissions/prepare-builds.sh
```

### After Building - Check Files
```bash
# Verify Firefox XPI exists
ls -lh store-submissions/firefox/skypost-v1.1.3.xpi

# Verify Chrome ZIP
ls -lh store-submissions/chrome/skypost-v1.1.3.zip

# View all submission files
ls -la store-submissions/
```

---

## What Each Store Needs

### Firefox Add-ons Marketplace

**Required Fields:**
- Name: SkyPost
- Category: Productivity
- Description: (see SUBMISSION_GUIDE.md)
- Privacy Policy URL: https://skypost.app/privacy
- Support Email: your-email@skypost.app
- Browser ID: skypost@example.com (already set)

**Optional but Recommended:**
- Screenshots (2+ images, max 1280x720px)
- License type (MIT recommended)
- Homepage URL: https://skypost.app
- Repository: (if open source)

**File:** `.xpi` (already built for you)

---

### Chrome Web Store

**Required Fields:**
- Name: SkyPost
- Short Description: (max 132 chars)
- Detailed Description: (see SUBMISSION_GUIDE.md)
- Category: Productivity
- Content Rating: (complete questionnaire)
- Privacy Policy: https://skypost.app/privacy
- Support Email: your-email@skypost.app

**Graphics Required:**
- Icon: 128x128px (PNG)
- Screenshots: 1280x800px (at least 2)

**File:** `.zip` (automatically created for you)

---

### Safari App Store

**What Makes Safari Different:**
- No dedicated "Web Store" for extensions
- Extensions must be distributed through Mac App Store
- Requires a macOS application bundle
- Needs Apple Developer Program membership ($99/year)
- Code signing and notarization mandatory

**Required Fields:**
- Name: SkyPost
- Category: Productivity
- Description: (see SUBMISSION_GUIDE.md)
- Privacy Policy: https://skypost.app/privacy
- Support Website: https://skypost.app
- Content Rating: (complete questionnaire)

**Graphics Required:**
- App Icon: 1024x1024px (PNG or JPG)
- Screenshots: 1280x800px (5-8 recommended)

**Process:**
1. Bundle extension in macOS app
2. Code sign the bundle
3. Notarize with Apple
4. Upload through App Store Connect
5. Apple reviews (1-3 days)
6. Goes live when approved

---

## Important Things to Know

### Version Management
- Update version in `manifest.json` before rebuilding
- Current version: 1.1.3
- Increment when making updates (1.1.4, 1.2.0, etc.)
- Keep all stores on same major version

### Data & Privacy
- Your extension doesn't require a backend server
- All user data stays on their device
- No cloud sync or analytics tracking
- You can keep privacy policy simple

### Support Strategy
- Set up support email: support@skypost.app
- Create FAQ on skypost.app
- Monitor store reviews regularly
- Respond to user feedback

### Update Process
After initial submission:
1. Make code changes
2. Increment version in manifest.json
3. Rebuild both extensions
4. Run prepare-builds.sh
5. Re-submit to each store
6. Each store has separate review process

---

## Accounts You'll Need

| Store | Cost | Sign Up |
|-------|------|---------|
| Firefox | Free | https://addons.mozilla.org |
| Chrome | $5 (one-time) | https://chrome.google.com/webstore/devconsole |
| Safari | $99/year | https://developer.apple.com/enroll/ |

---

## Success Metrics

Once live, track:
- Number of installs per platform
- Average rating per store
- User reviews and feedback
- Update adoption rate
- Feature requests

---

## Next Steps

1. **This Week:**
   - [ ] Create Mozilla account (if not already done)
   - [ ] Create Google Developer account (if not already done)
   - [ ] Submit to Firefox (fastest approval)

2. **Within 48 Hours:**
   - [ ] Monitor Firefox approval status
   - [ ] Submit to Chrome (while waiting for Firefox)

3. **Next Week:**
   - [ ] If going for Safari, enroll in Apple Developer Program
   - [ ] Set up Xcode for Safari app bundling
   - [ ] Create and submit Safari app

4. **Ongoing:**
   - [ ] Gather user feedback
   - [ ] Plan feature updates
   - [ ] Monitor all store reviews
   - [ ] Keep privacy policy up to date

---

## Troubleshooting Resources

### Firefox Issues
- Documentation: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions
- Support: https://discourse.mozilla.org/c/add-ons

### Chrome Issues
- Documentation: https://developer.chrome.com/docs/extensions/
- Support: https://support.google.com/chrome/a

### Safari Issues
- Documentation: https://developer.apple.com/documentation/safariservices
- Support: https://developer.apple.com/support/

---

## File Locations Reference

```
/Volumes/Basement/Sites/skypost-backend/Extensions/

├── firefox-extension/
│   ├── manifest.json              ← Version number here
│   ├── dist/                      ← Built extension files
│   └── skypost-firefox.xpi        ← Ready for Firefox submission
│
├── safari-extension-pro/
│   ├── manifest.json              ← Same version number
│   └── dist/                      ← Built extension files
│
└── store-submissions/
    ├── SUBMISSION_GUIDE.md        ← Main guide
    ├── SUBMISSION_CHECKLIST.md    ← Checklist
    ├── prepare-builds.sh          ← Build prep script
    │
    ├── firefox/
    │   └── skypost-v1.1.3.xpi     ← Firefox submission
    │
    ├── chrome/
    │   └── skypost-v1.1.3.zip     ← Chrome submission
    │
    └── safari/
        ├── SAFARI_DETAILED_GUIDE.md
        └── (app bundle created here)
```

---

## Contact & Support

For questions about:
- **General submission:** Check SUBMISSION_GUIDE.md
- **Specific store issues:** Read store-specific guides
- **Code/features:** Review workspace.js and manifest.json
- **Safari setup:** Follow SAFARI_DETAILED_GUIDE.md step-by-step

---

**Ready to launch SkyPost to the world!** 🚀
