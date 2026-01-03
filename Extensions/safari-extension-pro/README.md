# Floating Notes - Safari Web Extension

A simple, clean floating notes panel that appears on any website. Add, view, and delete notes without leaving your current page.

## Features

- **Floating Panel**: Non-intrusive notes panel that slides in from the bottom-right
- **Persistent Storage**: Notes are saved to IndexedDB, so they persist across sessions
- **Keyboard Shortcut**: Cmd+Shift+N (Mac) or Ctrl+Shift+N to toggle the panel
- **Extension Icon**: Click the extension icon in Safari toolbar to open notes
- **No Cloud**: All notes stored locally in your browser

## Installation (Safari)

1. Build the extension:
   ```bash
   # Copy the safari-extension folder contents to your Safari extension project
   # Or use Xcode to build as a Safari Web Extension
   ```

2. In Safari:
   - Go to Develop menu → Allow Unsigned Extensions (if needed for testing)
   - Open the Extension Settings and enable Floating Notes

## How to Use

### Open the Notes Panel
- Click the extension icon in Safari toolbar, OR
- Press Cmd+Shift+N (Mac) or Ctrl+Shift+N (Windows/Linux)

### Add a Note
- Type in the input field at the bottom of the panel
- Press Enter or click "Add"

### Delete a Note
- Click the × button on any note

### Close the Panel
- Click the × button in the top-right corner, OR
- Press the keyboard shortcut again

## File Structure

```
safari-extension/
├── manifest.json      # Extension configuration
├── content.js         # Injects floating panel into pages
├── background.js      # Service worker for background tasks
├── popup.html         # Extension popup UI
├── popup.js          # Popup script
└── README.md         # This file
```

## Development

To test in Safari:
1. Open Safari → Develop menu → Allow Unsigned Extensions
2. Build/reload the extension during development
3. Visit any website and use Cmd+Shift+N to toggle notes

## Future Enhancements

- [ ] Sync across devices (iCloud)
- [ ] Rich text formatting
- [ ] Tags and search
- [ ] Multiple note categories
- [ ] Export notes
- [ ] Chrome extension version
- [ ] Firefox extension version
- [ ] Note colors/styling

## Storage

Notes are stored in IndexedDB in your browser's local storage. Each browser profile has its own separate notes database.

## Privacy

All notes are stored locally on your device. Nothing is sent to any server (unless you enable cloud sync in the future).
