# Safari App Store Submission - Detailed Guide for SkyPost

## The Challenge
Safari doesn't have a simple "Web Store" like Chrome and Firefox. Instead, Safari extensions must be distributed as part of a macOS application through the Mac App Store.

## What You Need

### 1. Apple Developer Account
- Cost: $99/year
- Sign up at: https://developer.apple.com
- Required for code signing certificates and app submission

### 2. Xcode (Free)
```bash
xcode-select --install
# or download from Mac App Store
```

### 3. Code Signing Certificate
- Automatic with Apple Developer account
- Manage at: https://developer.apple.com/account/resources/certificates
- Will be stored in Keychain automatically

---

## Step-by-Step: Create Safari App Bundle

### Phase 1: Create Minimal macOS App

You need to create a simple macOS app that contains your Safari extension.

#### Option A: Using Xcode GUI (Recommended for First Time)

1. **Open Xcode**
   ```bash
   open /Applications/Xcode.app
   ```

2. **Create New Project**
   - File → New → Project
   - Choose "macOS" → "App"
   - Click Next

3. **Configure Project**
   - **Product Name:** SkyPost
   - **Team:** Your Apple Developer Team
   - **Organization:** SkyPost
   - **Bundle Identifier:** com.skypost.app
   - **Language:** Swift
   - **Interface:** SwiftUI
   - **Click Create**

4. **Add Extension to App**
   - In Xcode sidebar, select project
   - Right-click → Add Files to "SkyPost"
   - Navigate to `safari-extension-pro/dist/`
   - Select all files and add

5. **Configure App Info**
   - Select SkyPost project
   - Select "SkyPost" target
   - Go to "General" tab
   - Set minimum macOS version to 13.0+

#### Option B: Manual Bundle Creation

Create this folder structure:

```
SkyPost.app/
└── Contents/
    ├── Info.plist
    ├── PkgInfo
    ├── MacOS/
    │   └── SkyPost (executable script or binary)
    └── Resources/
        └── [all your extension files from dist/]
```

Create `Contents/Info.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>SkyPost</string>
    <key>CFBundleIdentifier</key>
    <string>com.skypost.app</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>SkyPost</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.1.3</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>NSHumanReadableCopyright</key>
    <string>Copyright © 2026 SkyPost. All rights reserved.</string>
    <key>NSPrincipalClass</key>
    <string>NSApplication</string>
</dict>
</plist>
```

Create `Contents/PkgInfo`:
```
APPL????
```

Create executable `Contents/MacOS/SkyPost`:
```bash
#!/bin/bash
# Minimal launcher
echo "SkyPost Safari Extension"
exit 0
```

Make executable:
```bash
chmod +x Contents/MacOS/SkyPost
```

---

### Phase 2: Code Sign the App

Before submitting to App Store, you must code sign with your Apple Developer certificate.

#### Step 1: List Available Certificates
```bash
security find-identity -v -p codesigning
```

Should show something like:
```
  1) ABC123DEF456... "Developer ID Application: Your Name (TEAM123ID)"
```

#### Step 2: Sign the App
```bash
codesign --deep --force --verify --verbose \
  --sign "Developer ID Application: Your Name (TEAM123ID)" \
  SkyPost.app
```

Or simpler, if only one certificate:
```bash
codesign --deep --force --verify --verbose \
  --sign - SkyPost.app
```

#### Step 3: Verify Signature
```bash
codesign --verify --verbose SkyPost.app
```

Should output:
```
SkyPost.app: valid on disk
SkyPost.app: satisfies its Designated Requirement
```

---

### Phase 3: Notarization (Required for Distribution)

Apple requires notarization for any macOS app distributed outside the App Store.

#### Step 1: Create App Notarization Package
```bash
ditto -c -k --sequesterRsrc SkyPost.app skypost-v1.1.3.zip
```

#### Step 2: Submit for Notarization
```bash
xcrun notarytool submit skypost-v1.1.3.zip \
  --apple-id your-apple-id@example.com \
  --team-id TEAM123ID \
  --password your-app-specific-password
```

**Note:** Use an App-Specific Password from https://appleid.apple.com/account/manage/security

#### Step 3: Check Notarization Status
```bash
xcrun notarytool log <REQUEST-ID> \
  --apple-id your-apple-id@example.com \
  --password your-app-specific-password
```

#### Step 4: Staple Ticket to App (if approved)
```bash
xcrun stapler staple SkyPost.app
```

---

### Phase 4: Submit to Mac App Store

You have two options:

#### Option A: Use Transporter App (Easier)
1. Download Transporter from Mac App Store
2. Click "+" to add app
3. Select `SkyPost.app`
4. Sign in with Apple ID
5. Click "Deliver"

#### Option B: Use Command Line
```bash
xcrun altool --upload-app \
  -f SkyPost.app \
  -t macOS \
  -u your-apple-id@example.com \
  -p your-app-specific-password
```

---

## Creating App Store Listing

### In App Store Connect (https://appstoreconnect.apple.com)

1. **Create New App**
   - Click "Create New App"
   - Platform: macOS
   - Name: SkyPost
   - Bundle ID: com.skypost.app
   - SKU: SKYPOST001
   - User Access: Full User

2. **App Information**
   - **Subtitle:** Bluesky Post Composer & Scheduler
   - **Description:**
     ```
     SkyPost is the ultimate Safari extension for Bluesky users who want to compose, schedule, and track posts.
     
     Features:
     • Post composer with rich formatting
     • Schedule posts for future publication
     • Track post analytics
     • Multiple draft management
     • Auto-detect video links with hashtag suggestions
     • Custom link preview metadata
     
     Perfect for content creators and power users.
     ```
   - **Keywords:** bluesky, social media, posts, scheduler, composer
   - **Support URL:** https://skypost.app/support
   - **Privacy Policy URL:** https://skypost.app/privacy
   - **Licensing Agreement:** Standard

3. **Screenshots (Required)**
   - 5-8 screenshots recommended
   - Use 16:10 aspect ratio (1280x800px)
   - Show main features

4. **Categories**
   - **Primary:** Productivity
   - **Secondary:** Social Networking

5. **Age Rating**
   - Complete questionnaire
   - Select appropriate rating

6. **Pricing & Distribution**
   - **Price Tier:** Free (or paid if desired)
   - **Regions:** Select all where available

7. **Build**
   - Upload your app after notarization
   - Select build for release

---

## Troubleshooting

### Code Signing Issues
```bash
# Remove old signatures
codesign --remove-signature SkyPost.app

# Re-sign
codesign --force --sign - --deep SkyPost.app
```

### Notarization Rejected
Check the log for details:
```bash
xcrun notarytool log <REQUEST-ID> \
  --apple-id your-apple-id@example.com
```

Common issues:
- Unsigned binaries in app
- Entitlements problems
- Invalid certificate

### App Won't Run on Other Macs
Ensure you signed with "Developer ID Application" certificate, not "Mac Developer" certificate.

---

## Timeline

- **Code Signing:** 5-10 minutes
- **Notarization:** 5-30 minutes
- **App Store Review:** 1-3 days
- **Going Live:** Within 24 hours of approval

---

## Quick Reference Commands

```bash
# Create ZIP
ditto -c -k --sequesterRsrc SkyPost.app SkyPost.zip

# Sign
codesign --deep --force --verify --verbose --sign - SkyPost.app

# Verify
codesign --verify --verbose SkyPost.app

# Notarize
xcrun notarytool submit SkyPost.zip --apple-id your@email.com

# Check notarization
xcrun notarytool history --apple-id your@email.com

# Staple (after approved)
xcrun stapler staple SkyPost.app

# Upload
xcrun altool --upload-app -f SkyPost.app -t macOS -u your@email.com
```

---

## Next Steps

1. Enroll in Apple Developer Program ($99/year)
2. Create code signing certificate
3. Follow Xcode GUI path (Option A) for easiest setup
4. Code sign and notarize
5. Submit to App Store Connect
6. Wait for review and approval

The key difference from Chrome/Firefox: Safari requires the extension to be part of a macOS application. Once set up, future updates are managed through App Store Connect.
