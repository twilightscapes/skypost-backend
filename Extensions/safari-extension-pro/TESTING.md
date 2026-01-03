# 🧪 Testing the Rich Editor Extension

## Quick Start (5 minutes)

### Step 1: Build the Extension
```bash
cd /Volumes/Basement/Sites/pirate/safari-extension
bash build.sh
```

### Step 2: Load in Safari (Local Testing)

**Option A: Using Safari Develop Menu (Easiest)**
1. Open Safari
2. Go to **Safari → Preferences** (or press **Cmd+,**)
3. Click the **Advanced** tab
4. Check "Show Develop menu in menu bar"
5. Close preferences
6. Go to **Develop → Allow Unsigned Extensions**
7. Visit any website
8. Go to **Develop → Manage Extensions**
9. Find "Floating Notes" and click **Allow**

**Option B: Using Xcode (More Professional)**
1. Open Xcode
2. File → New → Project
3. Search for "Web Extension" template
4. Create project
5. In the Web Extension target:
   - Drag `dist/` folder contents into Xcode
   - Add to target membership
6. Press Cmd+R to run on Safari

### Step 3: Test the Features

#### 1. **Open the Panel**
- Press **Cmd+Shift+M** to toggle the floating panel
- Panel should appear in bottom-right corner

#### 2. **Create a Note**
- Click **+ Add Note** button
- A modal editor should open
- Enter a title like "My First Note"
- Type some content: "Hello, World!"
- Click **Save**
- Note should appear in the panel

#### 3. **Edit the Note**
- Click on the note in the panel
- Editor modal opens with your content
- Change the title to "Updated Title"
- Click **Save**
- Panel updates immediately

#### 4. **Test Rich Text Formatting**
- Click the note again to edit
- Select some text
- Click the **B** button to make it bold
- Click **I** for italic
- Click **U** for underline
- Click **•** to make a bullet list
- Click **Save**

#### 5. **Add a Color**
- Click the note to edit
- Click the **◉** color button
- Enter a hex code: `#fef08a` (yellow)
- Notice the colored top border appears
- Click **Save**
- Note card should have yellow background in panel

#### 6. **Upload an Image**
- Click the note to edit
- Click **🖼️** button
- Choose an image from your computer
- Image should appear in the editor
- Click **Save**
- Panel preview won't show image but it's saved

#### 7. **Delete a Note**
- Click the note to edit
- Click the red **Delete** button
- Confirm in dialog
- Note should disappear from panel

#### 8. **Test Persistence Across Sites**
- Create a note with Cmd+Shift+M
- Close the panel with the × button
- Navigate to a different website
- Press Cmd+Shift+M again
- **Your note should still be there!** ✓

#### 9. **Test Multiple Notes**
- Create 5-6 notes with different titles and colors
- Verify all appear in the panel
- Click through each one
- All content and formatting should be preserved

## ✅ Checklist for Full Feature Testing

```
[ ] Panel opens with Cmd+Shift+M
[ ] Panel closes with X button or Cmd+Shift+M
[ ] Creating note opens editor modal
[ ] Can edit title in header
[ ] Can type content in editor
[ ] Bold formatting (B button) works
[ ] Italic formatting (I button) works
[ ] Underline formatting (U button) works
[ ] Bullet lists (• button) work
[ ] Color picker (◉ button) accepts hex codes
[ ] Color applies to note card background
[ ] Image upload (🖼️ button) works
[ ] Images display inline in editor
[ ] Save button closes modal and updates panel
[ ] Delete button removes note with confirmation
[ ] Panel shows note title in bold
[ ] Panel shows 2-line content preview
[ ] Notes persist when navigating to another site
[ ] Multiple notes appear correctly
[ ] All formatting/images persist after reload
```

## 🐛 Debugging Tips

### Check Console Logs
1. Open Safari Web Inspector (Cmd+Option+I)
2. Click the **Console** tab
3. Look for `[FloatingNotes]` log messages
4. Should show:
   - "Panel initialized on: [domain]"
   - "Saved new note: [id]"
   - "Retrieved notes from storage: [count]"

### Clear Extension Data
```javascript
// In Safari Console, run:
chrome.storage.local.clear(() => console.log('Cleared!'));
```

### Reload Extension
1. Go to **Develop → Manage Extensions**
2. Find "Floating Notes"
3. Click **Reload**

### Test on Specific Sites
- Amazon.com - test on live e-commerce site
- Reddit.com - test on content-heavy site
- Wikipedia.org - test on reference site
- Twitter.com - test on dynamic site

## 📊 Performance Notes
- **Panel open/close**: Should be instant (< 50ms)
- **Create note**: < 100ms
- **Save note**: < 100ms (may be slower with images)
- **Load 10+ notes**: Should load in < 500ms
- **Image upload**: ~1-2 seconds depending on file size

## 🎯 Test Scenarios

### Scenario 1: Quick Notes
1. Open Reddit
2. Create a quick note with Cmd+Shift+M
3. Navigate to another subreddit
4. Notes should be accessible everywhere

### Scenario 2: Rich Article Summary
1. Go to a news article
2. Create a note titled "Article Summary"
3. Add bold headlines, bullet points, color
4. Add a screenshot with 🖼️
5. Verify formatting persists

### Scenario 3: Multi-Site References
1. Open 3 different websites in separate tabs
2. Create notes on each site
3. Switch between tabs
4. All notes should be visible on any site
5. Data should persist across sessions

### Scenario 4: Stress Test
1. Create 50 notes with various content
2. Monitor performance
3. Create notes with large images
4. Verify no lag or crashes

## 🔍 Expected Output Examples

### Console Log (Healthy State)
```
[FloatingNotes] Panel initialized on: reddit.com
[FloatingNotes] Loaded notes: 3
[FloatingNotes] Retrieved notes from storage: 3
[FloatingNotes] Saved new note: 1704049123456
[FloatingNotes] Note saved successfully
[FloatingNotes] Updated note: 1704049123456
[FloatingNotes] Note deleted: 1704049123456
```

### Storage Check
```javascript
chrome.storage.local.get(['floatingNotes'], (result) => {
  console.log('Current notes:', result.floatingNotes);
  console.log('Count:', result.floatingNotes?.length);
});
```

## 🚨 Troubleshooting

| Issue | Solution |
|-------|----------|
| Panel won't open | Reload extension in Develop menu |
| Cmd+Shift+M doesn't work | Check if Firefox/Chrome - shortcut is Mac-only for now |
| Notes not persisting | Check console for storage errors, clear cache |
| Images not saving | Image file may be too large, try smaller images |
| Modal won't close | Try clicking X button or background again |
| Formatting lost on save | Use standard Cmd+B, Cmd+I instead of buttons |

## 📱 Cross-Browser Testing

When extension works on Safari, test on:
- [ ] Chrome (if building Manifest V3 version)
- [ ] Firefox (if building MV3 version)
- [ ] Edge (if building Manifest V3 version)

## ✨ Success Criteria
All tests pass when:
1. ✓ Panel opens/closes reliably
2. ✓ All formatting buttons work
3. ✓ Images embed correctly
4. ✓ Colors apply to notes
5. ✓ Notes persist across sites
6. ✓ Delete works with confirmation
7. ✓ No console errors
8. ✓ Performance is smooth

---

**Ready to test!** 🚀  
Questions? Check the browser console logs first!
