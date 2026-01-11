# SkyPost Safari Extension Setup

This is the Safari web extension version of SkyPost.

## Project Structure

```
SkyPost-Safari/
└── SkyPost/
    ├── Resources/          # Web extension files
    │   ├── manifest.json   # Extension configuration
    │   ├── *.html          # UI files
    │   ├── *.js            # JavaScript code
    │   ├── icons/          # Extension icons
    │   └── logo.svg        # SkyPost logo
    ├── Info.plist          # App bundle configuration
    ├── SkyPost.entitlements # Safari permissions
    ├── AppDelegate.swift    # App delegate
    └── main.swift          # Entry point
```

## Setup Instructions

1. **Open in Xcode**
   ```bash
   open SkyPost-Safari/SkyPost.xcodeproj
   ```
   Or manually open Xcode and select "Open" → navigate to `SkyPost-Safari`

2. **Create Xcode Project** (if not already created)
   - File → New → Project
   - Choose "macOS" → "App"
   - Product Name: "SkyPost"
   - Language: Swift
   - Organization: Your Company

3. **Configure the Project**
   - Set the Bundle Identifier (e.g., `com.yourcompany.skypost`)
   - Set Team ID (requires Apple Developer account)
   - Update version to 1.1.3 in General tab

4. **Add Web Extension Resources**
   - In Xcode, right-click project → Add Files to "SkyPost"
   - Select the `Resources` folder containing manifest.json
   - Ensure "Copy items if needed" is checked
   - Add to targets: SkyPost

5. **Configure Signing & Capabilities**
   - Select target "SkyPost"
   - Go to "Signing & Capabilities"
   - Select your Team
   - Add capability: "Safari Web Extension"
   - Add capability: "App Sandbox"

6. **Set Extension Identifier**
   - In Signing & Capabilities, under Safari Web Extension
   - Set Extension Identifier to: `[Your Team ID].com.skypost.webapp`

7. **Build and Test**
   ```bash
   xcodebuild build
   ```

8. **Run the App**
   - Press Cmd+R in Xcode or select Product → Run
   - The app will launch and Safari should recognize the extension

9. **Enable in Safari**
   - Open Safari
   - Safari → Settings → Extensions
   - Find "SkyPost" in the list
   - Check "Allow on every website" (or configure specific sites)

## Testing the Extension

1. Navigate to https://bsky.app
2. The SkyPost icon should appear in Safari's address bar
3. Click it to open the workspace

## Troubleshooting

- **Extension not appearing**: Make sure Safari Web Extension capability is added
- **Permission issues**: Check Info.plist and entitlements files
- **Build errors**: Ensure all web extension files are included in the target

## Building for Distribution

1. Archive the app: Product → Archive
2. Notarize for macOS (required for distribution)
3. Create App Store listing
4. Upload notarized app bundle

For detailed Apple documentation, see:
https://developer.apple.com/documentation/safariservices/safari_web_extensions
