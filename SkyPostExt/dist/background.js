// Background service worker - Opens workspace as popup window and handles scheduled posts

// Firefox compatibility: use browser API with chrome fallback
const api = typeof browser !== 'undefined' ? browser : chrome;

console.log('[Background] Script loaded');

const STORAGE_KEY = 'floatingNotes';
const SCHEDULE_CHECK_ALARM = 'checkScheduledPosts';

// Storage Architecture:
// - Primary: IndexedDB (workspace.js) - Main note storage with large capacity (~50MB)
// - Fallback: api.storage - Synced from IndexedDB for background worker access
// The background worker reads from api.storage which is kept in sync by workspace.js

// Using api.storage for persistent data synced to Firefox account
console.log('[Background] Using api.storage for scheduled posts access');

// Global error handlers
try {
  self.addEventListener && self.addEventListener('error', (e) => {
    // Handle errors silently
  });
  self.addEventListener && self.addEventListener('unhandledrejection', (e) => {
    // Handle rejections silently
  });
} catch (e) {
  // ignore
}

// Firefox uses browserAction instead of action
const actionAPI = api.action || api.browserAction;
if (actionAPI && actionAPI.onClicked) {
  actionAPI.onClicked.addListener((tab) => {
    console.log('[Background] Action clicked!');
    
    // Open workspace.html in a new tab
    const windowUrl = api.runtime.getURL('workspace.html');
    console.log('[Background] Opening:', windowUrl);
    
    api.tabs.create({
      url: windowUrl
    }, (newTab) => {
      if (!newTab) {
        console.error('[Background] Failed to create tab');
      } else {
        console.log('[Background] Tab created successfully');
      }
    });
  });
}

// UNIFIED Message handler - all message types
try {
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log('[Background] Message received:', msg?.action);
    
    try {
      // Handle openWorkspace action
      if (msg && msg.action === 'openWorkspace') {
        console.log('[Background] Opening workspace...');
        const windowUrl = api.runtime.getURL('workspace.html');
        api.tabs.create({ url: windowUrl }, (tab) => {
          sendResponse({ success: !!tab });
        });
        return true;
      }
      
      // Storage proxy handlers - for persistent storage from popup
      if (msg && msg.action === 'getAllNotes') {
        console.log('[Background] getAllNotes request');
        api.storage.sync.get([STORAGE_KEY], (result) => {
          if (api.runtime.lastError) {
            console.error('[Background] ✗ Storage error:', api.runtime.lastError);
            sendResponse({ notes: [] });
            return;
          }
          const notes = result[STORAGE_KEY] || [];
          console.log('[Background] ✓ Returning', notes.length, 'notes from api.storage.sync');
          sendResponse({ notes: notes });
        });
        return true; // Will respond asynchronously
      }
      
      if (msg && msg.action === 'saveNote') {
        console.log('[Background] saveNote request for:', msg.note?.id);
        api.storage.sync.get([STORAGE_KEY], (result) => {
          if (api.runtime.lastError) {
            console.error('[Background] ✗ Storage error:', api.runtime.lastError);
            sendResponse({ success: false });
            return;
          }
          const notes = result[STORAGE_KEY] || [];
          const index = notes.findIndex(n => n.id === msg.note.id);
          if (index >= 0) {
            notes[index] = msg.note;
            console.log('[Background] Updated note at index', index);
          } else {
            notes.push(msg.note);
            console.log('[Background] Added new note, total:', notes.length);
          }
          api.storage.sync.set({ [STORAGE_KEY]: notes }, () => {
            if (api.runtime.lastError) {
              console.error('[Background] ✗ Save failed:', api.runtime.lastError);
              sendResponse({ success: false });
              return;
            }
            console.log('[Background] ✓ Saved', notes.length, 'notes to storage');
            sendResponse({ success: true, count: notes.length });
          });
        });
        return true; // Will respond asynchronously
      }
      
      if (msg && msg.action === 'deleteNote' && msg.noteId) {
        console.log('[Background] deleteNote request for:', msg.noteId);
        api.storage.sync.get([STORAGE_KEY], (result) => {
          if (api.runtime.lastError) {
            console.error('[Background] ✗ Storage error:', api.runtime.lastError);
            sendResponse({ success: false });
            return;
          }
          const notes = result[STORAGE_KEY] || [];
          const filtered = notes.filter(n => n.id !== msg.noteId);
          api.storage.sync.set({ [STORAGE_KEY]: filtered }, () => {
            if (api.runtime.lastError) {
              console.error('[Background] ✗ Delete failed:', api.runtime.lastError);
              sendResponse({ success: false });
              return;
            }
            console.log('[Background] ✓ Deleted note, now has:', filtered.length, 'notes');
            sendResponse({ success: true, count: filtered.length });
          });
        });
        return true; // Will respond asynchronously
      }
      
      if (msg && msg.action === 'postNow' && msg.noteId) {
        console.log('[Background] Received postNow for id:', msg.noteId);
        // Load notes and find the note
        api.storage.sync.get([STORAGE_KEY], async (result) => {
          const notes = result[STORAGE_KEY] || [];
          const note = notes.find(n => n.id === msg.noteId);
          if (note) {
            await postScheduledNote(note);
            sendResponse({ ok: true });
          } else {
            console.warn('[Background] postNow: note not found', msg.noteId);
            sendResponse({ ok: false, error: 'not found' });
          }
        });
        // return true to indicate we'll send response asynchronously
        return true;
      }
      
      console.warn('[Background] Unknown action:', msg?.action);
    } catch (err) {
      console.error('[Background] onMessage handler error:', err);
    }
  });
} catch (e) {
  console.error('[Background] Failed to register message listener:', e);
}

// Set up alarm to check scheduled posts every minute
try {
  api.alarms.create(SCHEDULE_CHECK_ALARM, { periodInMinutes: 1 });
} catch (error) {
  console.warn('[Background] Failed to create alarm:', error);
}

// Listen for alarm
try {
  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SCHEDULE_CHECK_ALARM) {
      checkAndPostScheduledNotes();
    }
  });
} catch (error) {
  console.warn('[Background] Failed to register alarm listener:', error);
}

// Keep-alive connection from workspace during development to make debugging easier
try {
  chrome.runtime.onConnect.addListener((port) => {
    if (port && port.name === 'dev-keep-alive') {
      console.log('[Background] dev-keep-alive port connected');
      port.onDisconnect.addListener(() => {
        console.log('[Background] dev-keep-alive port disconnected');
      });
    }
  });
} catch (e) {
  // ignore if runtime not available
}
async function checkAndPostScheduledNotes() {
  console.log('[Background] ========== checkAndPostScheduledNotes called ==========');
  try {
    // Get notes from chrome.storage.sync (IndexedDB is synced there by workspace)
    let notes = [];
    
    console.log('[Background] Querying chrome.storage.sync for floatingNotes...');
    const result = await new Promise((resolve, reject) => {
      chrome.storage.sync.get(['floatingNotes'], (result) => {
        if (chrome.runtime.lastError) {
          console.error('[Background] chrome.storage.sync error:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          console.log('[Background] chrome.storage.sync returned:', result);
          resolve(result);
        }
      });
    });
    
    notes = result.floatingNotes || [];
    console.log('[Background] Found', notes.length, 'scheduled notes from chrome.storage.sync');
    
    const now = Date.now();
    console.log('[Background] Current timestamp:', now);
    let needsUpdate = false;

    for (const note of notes) {
      console.log('[Background] Checking note:', { id: note.id, status: note.status, scheduledFor: note.scheduledFor });
      if (note.status === 'scheduled' && note.scheduledFor) {
        // scheduledFor is now a timestamp (ms)
        const timeUntil = note.scheduledFor - now;
        console.log('[Background] Scheduled note found - timeUntil:', timeUntil, 'ms');
        
        if (timeUntil <= 0) {
          console.log('[Background] TIME TO POST! Requesting full note data for:', note.id);
          const statusBefore = note.status;
          
          // Request full note data from workspace (includes imageData)
          const fullNote = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'getFullNote', noteId: note.id }, (response) => {
              if (response && response.note) {
                console.log('[Background] Received full note data');
                resolve(response.note);
              } else {
                console.log('[Background] No full note data received, using synced version');
                resolve(note);
              }
            });
          });
          
          await postScheduledNote(fullNote);
          console.log('[Background] After postScheduledNote - status changed from', statusBefore, 'to', fullNote.status);
          needsUpdate = true;
        } else {
          console.log('[Background] Not yet time for this note, waiting', timeUntil, 'ms');
        }
      }
    }

    if (needsUpdate) {
      console.log('[Background] Updates needed, notifying workspace...');
      // Notify workspace to update the posted notes in IndexedDB
      for (const note of notes) {
        if (note.status === 'published' || note.status === 'failed') {
          console.log('[Background] Sending update for note:', note.id, 'status:', note.status);
          chrome.runtime.sendMessage({
            action: 'updateScheduledNote',
            note: note
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.warn('[Background] Workspace update error:', chrome.runtime.lastError);
            } else {
              console.log('[Background] ✓ Workspace updated note:', note.id);
            }
          });
        }
      }
      
      // Also save to chrome.storage.sync as fallback
      await new Promise((resolve, reject) => {
        chrome.storage.sync.set({ [STORAGE_KEY]: notes }, () => {
          if (chrome.runtime.lastError) {
            console.warn('[Background] chrome.storage.sync save failed:', chrome.runtime.lastError);
            resolve();
          } else {
            console.log('[Background] ✓ Also saved to chrome.storage.sync');
            resolve();
          }
        });
      });
    } else {
      console.log('[Background] No updates needed');
    }
  } catch (error) {
    console.error('[Background] Error checking scheduled posts:', error);
  }
}

async function postScheduledNote(note) {
  try {
    
    // Get Bluesky session
    const sessionResult = await new Promise((resolve, reject) => {
      chrome.storage.sync.get(['blueskySession'], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      });
    });

    let session = sessionResult['blueskySession'];
    
    if (!session || !session.accessJwt) {
      console.error('[Background] BLOCKING: No Bluesky session available');
      console.error('[Background] Session object:', session);
      console.error('[Background] AccessJwt present:', session?.accessJwt ? 'yes' : 'no');
      note.status = 'failed';
      note.failureReason = 'No Bluesky session available';
      return;
    }

    // Try to refresh token if we have a refresh token
    if (session.refreshJwt) {
      try {
        const refreshResponse = await fetch('https://bsky.social/xrpc/com.atproto.server.refreshSession', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.refreshJwt}`,
          },
        });

        if (refreshResponse.ok) {
          const newSession = await refreshResponse.json();
          session = {
            did: session.did,
            handle: session.handle,
            accessJwt: newSession.accessJwt,
            refreshJwt: newSession.refreshJwt || session.refreshJwt,
          };
          
          // Save the refreshed session
          await new Promise((resolve) => {
            chrome.storage.sync.set({ 'blueskySession': session }, () => {
              resolve();
            });
          });
        } else {
          console.warn('[Background] Token refresh failed:', refreshResponse.status);
          // Continue with old token and see if it works
        }
      } catch (refreshError) {
        console.error('[Background] Error refreshing token:', refreshError.message);
        // Continue with old token and see if it works
      }
    }


    // Strip HTML and images from content for plain text
    let cleanContent = note.content || '';
    
    console.log('[Background] Processing note:', {
      title: note.title,
      hasContent: !!note.content,
      hasCustomPreview: !!note.customLinkPreview,
      customLinkPreview: note.customLinkPreview
    });

    // Convert <br> to newlines
    cleanContent = cleanContent.replace(/<br\s*\/?>/g, '\n');
    
    // Remove image tags and all HTML
    cleanContent = cleanContent.replace(/<img[^>]*>/g, '');
    cleanContent = cleanContent.replace(/<[^>]*>/g, '');
    cleanContent = cleanContent.trim();
    
    // If there's a custom link preview, remove the URL from the text
    let finalText = cleanContent;
    if (note.customLinkPreview && note.customLinkPreview.url) {
      // Remove the URL from the text (same pattern as detectLinks does)
      const urlPattern = /(https?:\/\/[^\s]+)/g;
      finalText = cleanContent.replace(urlPattern, '').trim();
    }
    
    // Build post record with plain text
    const postRecord = {
      $type: 'app.bsky.feed.post',
      text: finalText,
      createdAt: new Date().toISOString(),
    };
    // Handle custom link preview if present
    let hasLinkPreview = false;
    console.log('[Background] customLinkPreview object:', note.customLinkPreview);
    console.log('[Background] customLinkPreview.url:', note.customLinkPreview?.url);
    if (note.customLinkPreview && note.customLinkPreview.url) {
      const preview = note.customLinkPreview;
      postRecord.embed = {
        $type: 'app.bsky.embed.external',
        external: {
          uri: preview.url,
          title: preview.title || '',
          description: preview.description || '',
        },
      };
      
      // If preview has an image, fetch and upload it as a blob
      if (preview.image) {
        try {
          const imageResponse = await fetch(preview.image);
          const imageBlob = await imageResponse.blob();
          
          // Upload blob to AT Protocol
          const uploadResponse = await fetch('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', {
            method: 'POST',
            headers: {
              'Content-Type': imageBlob.type || 'image/jpeg',
              'Authorization': `Bearer ${session.accessJwt}`,
            },
            body: imageBlob,
          });

          if (uploadResponse.ok) {
            const uploadData = await uploadResponse.json();
            postRecord.embed.external.thumb = uploadData.blob;
            console.log('[Background] Added image thumb to link embed');
          } else {
            console.warn('[Background] Image upload failed for link preview');
          }
        } catch (imageError) {
          console.warn('[Background] Error fetching/uploading preview image:', imageError.message);
        }
      }
      
      hasLinkPreview = true;
      console.log('[Background] Created link embed:', postRecord.embed);
    } else {
      console.log('[Background] No customLinkPreview found');
    }

    // Handle images if present - upload separately as embed (only if no link preview)
    if (!hasLinkPreview && note.imageData && Array.isArray(note.imageData) && note.imageData.length > 0) {
      console.log('[Background] Found', note.imageData.length, 'images to upload');
      const uploadedImages = [];
      
      for (const imageData of note.imageData) {
        if (!imageData) {
          console.log('[Background] Skipping empty imageData');
          continue;
        }
        
        try {
          let imageBlob;
          
          console.log('[Background] Processing imageData, type:', typeof imageData, 'starts with:', imageData.substring(0, 30));
          
          // Convert data URL to blob (don't use fetch for data URLs)
          if (imageData.startsWith('data:')) {
            console.log('[Background] Converting data URL to blob');
            const parts = imageData.split(',');
            if (parts.length < 2) {
              console.warn('[Background] Invalid data URL format');
              continue;
            }
            const mimeMatch = parts[0].match(/:(.*?);/);
            const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
            const bstr = atob(parts[1]);
            const n = bstr.length;
            const u8arr = new Uint8Array(n);
            for (let i = 0; i < n; i++) {
              u8arr[i] = bstr.charCodeAt(i);
            }
            imageBlob = new Blob([u8arr], { type: mimeType });
            console.log('[Background] Created blob from data URL, size:', imageBlob.size, 'type:', mimeType);
          } else {
            // For non-data URLs, use fetch
            console.log('[Background] Fetching image from URL');
            const response = await fetch(imageData);
            imageBlob = await response.blob();
            console.log('[Background] Fetched image blob, size:', imageBlob.size);
          }
          
          // Upload blob to AT Protocol
          console.log('[Background] Uploading blob to Bluesky...');
          const uploadResponse = await fetch('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', {
            method: 'POST',
            headers: {
              'Content-Type': imageBlob.type || 'image/jpeg',
              'Authorization': `Bearer ${session.accessJwt}`,
            },
            body: imageBlob,
          });

          if (uploadResponse.ok) {
            const uploadData = await uploadResponse.json();
            uploadedImages.push({
              image: uploadData.blob,
              alt: 'User uploaded image',
            });
            console.log('[Background] Image uploaded successfully');
          } else {
            const errorText = await uploadResponse.text();
            console.warn('[Background] Image upload failed with status', uploadResponse.status, ':', errorText.substring(0, 100));
          }
        } catch (imgError) {
          console.error('[Background] Error processing image:', imgError);
        }
      }
      
      if (uploadedImages.length > 0) {
        postRecord.embed = {
          $type: 'app.bsky.embed.images',
          images: uploadedImages.slice(0, 4), // Max 4 images
        };
        console.log('[Background] Created image embed with', uploadedImages.length, 'images');
      } else {
        console.log('[Background] No images successfully uploaded');
      }
    }

    // Post to Bluesky
    console.log('[Background] Posting to Bluesky with record:', postRecord);
    const postResponse = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.accessJwt}`,
      },
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record: postRecord,
      }),
    });

    if (postResponse.ok) {
      note.status = 'published';
      const timestamp = Date.now();
      note.postedAt = timestamp;
      
      // Initialize postHistory if it doesn't exist
      if (!note.postHistory) {
        note.postHistory = [];
      }
      // Add this post to history
      note.postHistory.push(timestamp);
      
      note.failureReason = null;
      
      // Preserve imageData before sending message (it should be there but let's be explicit)
      const imageDataToPreserve = note.imageData || [];
      
      // Notify workspace that the post was published (for real-time UI updates)
      console.log('[Background] Sending postPublished notification for:', note.id, 'with', imageDataToPreserve.length, 'images');
      
      // Create a clean note object to send back, preserving all fields including imageData
      const noteToSend = {
        ...note,
        imageData: imageDataToPreserve
      };
      
      chrome.runtime.sendMessage(
        { type: 'postPublished', note: noteToSend },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[Background] Could not notify workspace:', chrome.runtime.lastError.message);
          } else {
            console.log('[Background] Workspace notified of post publication');
          }
        }
      );
    } else {
      const error = await postResponse.text();
      console.error('[Background] Post failed with status:', postResponse.status);
      console.error('[Background] Post error response:', error);
      note.status = 'failed';
      note.failureReason = `API error (${postResponse.status}): ${error.substring(0, 100)}`;
    }
  } catch (error) {
    console.error('[Background] CRITICAL ERROR posting scheduled note:', error);
    console.error('[Background] Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    note.status = 'failed';
    note.failureReason = error.message;
  }
}



