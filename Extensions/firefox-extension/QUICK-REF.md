# 🎮 Quick Reference - Floating Notes 2.0

## Keyboard & Mouse Shortcuts

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| **Toggle Panel** | Cmd+Shift+M | Ctrl+Shift+M |
| **Save Note** | Click Save button | Click Save button |
| **Close Editor** | Click × or background | Click × or background |
| **Bold** | Click B or Cmd+B | Click B or Ctrl+B |
| **Italic** | Click I or Cmd+I | Click I or Ctrl+I |
| **Underline** | Click U or Cmd+U | Click U or Ctrl+U |

## Panel UI Elements

```
┌─────────────────────────────────┐
│ 🟣 NOTES          [×]          │  ← Header (purple gradient)
├─────────────────────────────────┤
│                                 │
│ 🟨 My First Note                │  ← Note with color
│    Preview of content...        │
│                                 │
│ 🟥 Important Item               │
│    Another note preview...      │
│                                 │
├─────────────────────────────────┤
│     [+ Add Note]               │  ← Create new note
└─────────────────────────────────┘
```

## Editor Modal Layout

```
┌──────────────────────────────────────┐
│ Title Input Field              [×]  │  ← Header
├──────────────────────────────────────┤
│ [B] [I] [U] [•] | [◉] [🖼️]       │  ← Formatting toolbar
├──────────────────────────────────────┤
│                                      │
│  [Editable content area]            │  ← contentEditable div
│  - Rich text with formatting        │
│  - Embedded images                  │
│                                      │
├──────────────────────────────────────┤
│     [Save]          [Delete]        │  ← Footer buttons
└──────────────────────────────────────┘
```

## Toolbar Buttons

| Button | Name | Shortcut | Result |
|--------|------|----------|--------|
| **B** | Bold | Cmd+B | **Bold text** |
| **I** | Italic | Cmd+I | *Italic text* |
| **U** | Underline | Cmd+U | <u>Underlined</u> |
| **•** | List | – | • Bullet point |
| \| | Divider | – | Visual separator |
| **◉** | Color | – | Hex color picker |
| **🖼️** | Image | – | File upload |

## Color Picker

Click **◉** and enter hex codes:
- `#fef08a` - Yellow
- `#fca5a5` - Red
- `#86efac` - Green
- `#93c5fd` - Blue
- `#d8b4fe` - Purple
- `#fff` - White
- `#f3f4f6` - Light gray

## Common Workflows

### Quick Note
```
1. Press Cmd+Shift+M
2. Click + Add Note
3. Type title and content
4. Click Save
```

### Formatted Note
```
1. Create new note
2. Type content
3. Select text → Click B/I/U buttons
4. Click Save
```

### Colored Note
```
1. Open note for editing
2. Click ◉ button
3. Enter hex code (e.g., #fef08a)
4. Click Save
```

### Note with Image
```
1. Open note editor
2. Click 🖼️ button
3. Select image file
4. Image appears inline
5. Click Save
```

## Storage Info

- **Location**: Chrome's local storage (extension-wide)
- **Capacity**: ~10MB per extension
- **Persistence**: Survives browser restart
- **Scope**: Global to extension (all sites)
- **Backup**: Manual export not yet supported

## Data Format

```javascript
{
  id: "1704049123456",
  title: "Note Title",
  content: "<b>Bold</b> text with <img src='data:...'>",
  color: "#fef08a",
  createdAt: 1704049123456
}
```

## Troubleshooting Quick Fixes

| Problem | Fix |
|---------|-----|
| Panel won't open | Reload in Develop → Manage Extensions |
| Shortcut doesn't work | Make sure Safari has focus (not another app) |
| Content not saving | Click Save button explicitly (auto-save only on button click) |
| Image not uploading | Try smaller file size or different format |
| Color not applying | Use valid hex format with # symbol |
| Note disappeared | Check if you accidentally hit Delete |

## Browser Compatibility

| Browser | Status | Shortcut |
|---------|--------|----------|
| **Safari** | ✅ Full | Cmd+Shift+M |
| **Chrome** | 🟡 Future | Ctrl+Shift+M |
| **Firefox** | 🟡 Future | Ctrl+Shift+M |
| **Edge** | 🟡 Future | Ctrl+Shift+M |

## Limits & Tips

- ⚠️ No cloud sync (local only)
- ⚠️ Images stored as base64 (uses storage space)
- ⚠️ Large images (~5MB+) may slow down
- ✅ Works offline
- ✅ No login required
- ✅ Fast and private

## Getting Help

1. **Check Console**: Cmd+Option+I → Console tab
2. **Look for `[FloatingNotes]` logs**
3. **Try reloading** the extension
4. **Clear storage**: `chrome.storage.local.clear()`
5. **Check browser storage** limit with DevTools

## Next Features (Coming Soon?)

- 🔍 Search/filter notes
- 📌 Pin favorite notes
- 🏷️ Tags and categories
- 📅 Sort by date
- 📊 Note statistics
- 🌙 Dark mode
- ⌨️ Keyboard shortcuts panel
- 🔗 Share notes via link

---

**v2.0 - Rich Editor**  
**Status**: Production Ready ✨
