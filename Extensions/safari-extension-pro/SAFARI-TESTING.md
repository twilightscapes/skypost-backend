# Safari Local Testing Guide

## Quick Start - Test in Browser First

1. Open `test.html` in your browser (double-click it or drag to Safari)
2. Try the demo notes panel - this shows how the extension works
3. Click "Demo: Toggle Notes Panel" or press **Cmd+Shift+N** to toggle

## Load Extension into Safari (Local Testing)

### Prerequisites
- macOS 11+ with Safari 15+
- This extension (manifest.json, content.js, background.js, popup files)

### Step-by-Step Instructions

#### 1. Prepare the Files
```bash
cd safari-extension
bash build.sh
```
This creates a `dist` folder with all the extension files ready.

#### 2. Enable Developer Mode in Safari
1. Open **Safari**
2. Go to **Safari → Preferences**
3. Click the **Advanced** tab
4. Check: **"Show Develop menu in menu bar"**
5. Close Preferences

#### 3. Allow Unsigned Extensions (Temporary)
- Click **Develop → Allow Unsigned Extensions**
- This allows testing for the current Safari session
- **Note**: This resets when you restart Safari, so you'll need to enable it again each time

#### 4. Load the Extension
1. Go to **Develop → Manage Extensions**
2. Click the **+** button at the bottom left
3. Navigate to your `safari-extension/dist` folder
4. Click `manifest.json`
5. Click **Open**

#### 5. Enable the Extension
1. In the Extensions window, you should see "Floating Notes"
2. Toggle it **ON**
3. Choose the scope: **"All Websites"** (for testing everywhere)

#### 6. Test It!
- Go to any website
- Press **Cmd+Shift+N** to toggle the floating notes panel
- Add, view, and delete notes
- Notes persist across all websites

### Using the Extension

**Toggle Panel:**
- Keyboard: **Cmd+Shift+N**
- Or click the extension icon in Safari's toolbar

**Add a Note:**
- Type in the input field and press Enter or click Add

**Delete a Note:**
- Click the × button on any note

### Reloading After Code Changes

If you modify `content.js` or other files:

1. Edit your files in `safari-extension/`
2. Run `bash build.sh` again to copy to dist
3. In Safari: **Develop → Reload Extensions** (or just press Cmd+R)

### Persistence Between Restarts

**Problem:** Extension disappears after restarting Safari

**Solution:** 
- Safari needs "Allow Unsigned Extensions" to be enabled
- You must re-enable it from Develop menu after each Safari restart
- This is a Safari limitation for unsigned extensions

**Workaround:**
- Once you're ready to keep the extension permanently, sign it with Xcode (requires Apple Developer account) or distribute it through the Mac App Store

### Testing Checklist

- [ ] Test.html demo works in browser
- [ ] Extension loads in Safari without errors
- [ ] Keyboard shortcut (Cmd+Shift+N) toggles panel
- [ ] Can add notes
- [ ] Can delete notes
- [ ] Notes persist when navigating to different websites
- [ ] Notes persist when closing and reopening Safari tab
- [ ] Notes persist in IndexedDB (check Safari → Develop → Show Web Inspector → Storage → IndexedDB)

### Troubleshooting

**Extension not appearing in Manage Extensions?**
- Make sure "Allow Unsigned Extensions" is enabled
- Check console for errors: Develop → Show Web Inspector → Console

**Notes not saving?**
- Check IndexedDB: Develop → Show Web Inspector → Storage → IndexedDB
- Make sure IndexedDB is enabled in browser settings

**Keyboard shortcut not working?**
- Make sure the webpage has focus (click on the page first)
- Check for keyboard shortcut conflicts in System Preferences

**Extension keeps disappearing?**
- This is normal for unsigned extensions
- Enable "Allow Unsigned Extensions" again in Develop menu

## For Permanent Distribution

To install the extension permanently or distribute to others:

1. **Sign with Xcode** (requires Apple Developer certificate)
   - Create a macOS app with Safari Web Extension target
   - Build and run from Xcode

2. **Submit to Mac App Store**
   - Package as a sandboxed app
   - Submit for App Review

3. **Request notarization** (for direct distribution)
   - Use `notarytool` to notarize the signed app

## File Structure

```
safari-extension/
├── manifest.json          # Extension config
├── content.js            # Injected into pages
├── background.js         # Service worker
├── popup.html           # Settings popup
├── popup.js            # Popup script
├── test.html           # Browser test page
├── build.sh            # Build script
├── dist/               # Generated (copy of files for Safari)
└── README.md          # User docs
```

## Next Steps

- ✅ Test in browser with test.html
- ⬜ Load into Safari locally
- ⬜ Test on real websites
- ⬜ Add more features (colors, images, etc.)
- ⬜ Build Chrome/Firefox versions
- ⬜ Sign with Xcode for permanent distribution
