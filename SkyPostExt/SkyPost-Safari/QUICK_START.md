# SkyPost Safari - Quick Start

## What You Have

A complete Safari web extension project ready to open in Xcode.

## Next Steps

1. **Open the project in Xcode:**
   - Open Xcode
   - File → Open
   - Navigate to `/Volumes/Basement/Sites/SkyPost/SkyPost-Safari`
   - **OR** just double-click `SkyPost-Safari/SkyPost` folder

2. **Create a New Xcode Project:**
   Since we have the source files but need the .xcodeproj file:

   ```bash
   cd /Volumes/Basement/Sites/SkyPost/SkyPost-Safari
   swift package init --type executable
   ```

   Or manually in Xcode:
   - File → New → Project
   - Select macOS → App
   - Name: "SkyPost"
   - Language: Swift
   - Save to: SkyPost-Safari folder

3. **Configure in Xcode:**
   
   After creating the project:
   
   a. **Add files to project:**
      - Right-click on project navigator
      - Add Files to "SkyPost"
      - Select `SkyPost/Resources` folder
      - Check "Copy items if needed"
   
   b. **Set Bundle Identifier:**
      - Select target
      - General tab
      - Update Bundle Identifier (e.g., com.yourname.skypost)
   
   c. **Add Capabilities:**
      - Signing & Capabilities tab
      - Click "+ Capability"
      - Add "Safari Web Extension"
      - Set Extension Identifier (e.g., com.yourname.skypost.webapp)
   
   d. **Configure Entitlements:**
      - Set Code Sign Entitlements file: `SkyPost/SkyPost.entitlements`

4. **Build & Test:**
   - Product → Run (or Cmd+R)
   - Open Safari
   - Safari → Settings → Extensions
   - Enable "SkyPost" extension

## File Locations

- **Web Extension Code**: `/SkyPost/Resources/`
- **App Configuration**: `/SkyPost/Info.plist`
- **Permissions**: `/SkyPost/SkyPost.entitlements`
- **Swift Code**: `/SkyPost/AppDelegate.swift`, `/SkyPost/main.swift`

## Documentation

See `README.md` for detailed setup instructions.

## Support

For Safari web extension documentation:
https://developer.apple.com/documentation/safariservices/safari_web_extensions
