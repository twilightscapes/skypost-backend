# Safari Extension Setup Guide

## Quick Start

This is a Safari Web Extension that adds a floating notes panel to any website.

## To Test in Safari (Development)

1. **Open Safari Preferences:**
   - Safari → Preferences → Advanced
   - Check "Show Develop menu in menu bar"

2. **Load the Extension:**
   - Develop → Allow Unsigned Extensions (temporary, for testing)
   - Develop → Web Inspector or Extension options

3. **Alternative: Using Xcode**
   - You'll need to wrap this as a Safari App Extension in Xcode
   - Create a new macOS App with Safari Extension target
   - Copy the files into the Resources folder

## File Checklist

- ✅ manifest.json - Extension configuration
- ✅ content.js - Injects the floating panel
- ✅ background.js - Handles background tasks
- ✅ popup.html - Settings popup
- ✅ popup.js - Popup functionality

## Key Features

1. **Floating Panel** - Appears at bottom-right of any page
2. **Keyboard Shortcut** - Cmd+Shift+N to toggle
3. **IndexedDB Storage** - Notes persist locally
4. **Enable/Disable** - Toggle per website in popup

## Next Steps

### To Convert to Official Safari Extension:

1. Create Xcode project with Safari Web Extension target
2. Copy content.js and background.js to Web Extension target
3. Create Safari App Extension wrapper
4. Sign and package for distribution

### To Build Chrome Version:

- The manifest.json and code are mostly compatible
- Just copy to a Chrome extension folder
- May need minor API adjustments (chrome.* vs browser.*)

### To Build Firefox Version:

- Similar to Chrome, use Firefox WebExtensions API
- Manifest v2 or v3 compatible
- Storage API might need adjustment

## Troubleshooting

**Panel not appearing?**
- Check if extension is enabled for the site (click extension icon)
- Check browser console for errors (Develop → Web Inspector)

**Notes not saving?**
- Check IndexedDB in DevTools (Application tab)
- Verify IndexedDB is enabled in browser

**Keyboard shortcut not working?**
- Make sure page has focus
- Check Safari's keyboard shortcut conflicts

## Testing Checklist

- [ ] Can add notes
- [ ] Can delete notes
- [ ] Panel persists across page navigation
- [ ] Notes saved after browser restart
- [ ] Keyboard shortcut works
- [ ] Panel can be toggled on/off
- [ ] Works on multiple different websites
