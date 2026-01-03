# SkyPost Image Backup Test

## Overview
This document outlines how to test that images are properly backed up and restored in the SkyPost extension.

## How Images Are Stored

Images in SkyPost are embedded as **base64-encoded data URLs** within the note's HTML content. For example:

```html
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" 
     style="max-width: 100%; height: auto; border-radius: 4px; margin: 0.5rem 0;" />
```

This means **images are automatically included in backups** because they're part of the note content stored in the `floatingNotes` storage.

## What Changed in the Backup System

The backup manager has been enhanced to:

1. **Count images** in notes by scanning for `<img>` tags with `data:image/` URLs
2. **Track image count** in backup metadata
3. **Display image count** in:
   - Backup preview information
   - Restore confirmation dialog
   - Restore completion report

## How to Test Image Backup

### Test 1: Create a Backup with Images

1. **Create notes with images:**
   - Open the SkyPost extension
   - Create a new note with some text
   - Click the image button (📷) and select an image file
   - Save the note
   - Create 2-3 more notes, some with images and some without

2. **Create a backup:**
   - Click the backup button in the settings
   - The backup file will download as `skypost-backup-[DATE].json`

3. **Verify images in backup:**
   - Open the JSON file in a text editor
   - Search for `"data:image/"` - you should find base64-encoded images
   - Check the metadata: `"imageCount": X` should match the number of images you added

### Test 2: Restore and Verify Images

1. **Clear all extension data:**
   - In the extension settings, click "Clear All Data"
   - Confirm the action
   - Verify all notes are gone

2. **Restore from backup:**
   - In settings, select the backup file you created
   - The restore dialog should show:
     - Number of notes
     - Number of images (e.g., "• 3 images")
     - Number of settings
   - Confirm the restore

3. **Verify images are restored:**
   - All notes should reappear with their images intact
   - Images should display correctly
   - Check that image dimensions and styling match the original

### Test 3: Image Data Integrity

1. **Export a note with an image:**
   - Create a note with an image
   - Copy the full HTML content from browser dev tools

2. **Backup and restore:**
   - Create a backup
   - Clear data
   - Restore from backup

3. **Compare:**
   - Copy the HTML content again
   - The `data:image/` URLs should be identical
   - This confirms images haven't been corrupted or modified

## Test Cases

| Test Case | Expected Result |
|-----------|-----------------|
| Create notes with/without images | Notes save successfully |
| Backup with images | Backup file contains `data:image/` URLs |
| Preview shows image count | Dialog displays correct image count |
| Restore with images | All images appear with correct styling |
| Image display quality | Images appear identical to originals |
| Multiple images per note | All images in each note are preserved |
| Mixed content (text + images) | Both text and images restore correctly |

## Metadata Structure

The backup now includes image count in metadata:

```json
{
  "version": "1.0",
  "extensionName": "SkyPost",
  "timestamp": 1672531200000,
  "date": "2023-01-01T00:00:00.000Z",
  "data": {
    "notes": [...],
    "settings": {...},
    "metadata": {
      "noteCount": 5,
      "imageCount": 3,
      "backupVersion": "1.0"
    }
  }
}
```

## Implementation Details

### New Method: `countImagesInNotes(notes)`

This private method scans all notes for embedded images:

```javascript
countImagesInNotes(notes) {
  let imageCount = 0;
  notes.forEach(note => {
    if (note.content) {
      // Count all img tags with data:image URLs (base64 encoded images)
      const imgMatches = note.content.match(/<img[^>]+src="data:image\/[^"]+"/g);
      if (imgMatches) {
        imageCount += imgMatches.length;
      }
    }
  });
  return imageCount;
}
```

## Files Modified

- `firefox-extension/backup.js`
- `safari-extension-pro/backup.js`

Both files received identical updates for consistency.

## Validation Checklist

- [ ] Can add images to notes
- [ ] Images are embedded as base64 data URLs
- [ ] Backup file contains image data
- [ ] Image count is tracked in metadata
- [ ] Restore dialog shows image count
- [ ] Images restore with correct styling
- [ ] Multiple images per note work correctly
- [ ] Image data is not corrupted during backup/restore
- [ ] Backup works without images (fallback counting)
- [ ] Empty/old backups without imageCount field still work

## Notes

- Images are always backed up because they're stored in note content
- No special image handling is needed - it's automatic
- Large images (in data URL format) can make backup files large
- The backup file format remains JSON for easy inspection and portability
- Image count counting is safe and won't fail on old backups that lack the field
