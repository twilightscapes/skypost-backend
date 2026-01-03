// Background service worker - Opens workspace as popup window and handles scheduled posts

console.log('[Background] Script loaded');

const STORAGE_KEY = 'floatingNotes';
const SCHEDULE_CHECK_ALARM = 'checkScheduledPosts';

// Storage wrapper using IndexedDB in background script for true persistence
class BackgroundStorageDB {
  constructor() {
    this.db = null;
    this.ready = this.init();
  }
  
  async init() {
    return new Promise((resolve) => {
      try {
        console.log('[BackgroundDB] Opening IndexedDB (background context)...');
        const request = indexedDB.open('SkyPostDB', 1);
        
        request.onerror = () => {
          console.error('[BackgroundDB] ✗ Failed to open DB:', request.error);
          resolve(false);
        };
        
        request.onsuccess = () => {
          this.db = request.result;
          console.log('[BackgroundDB] ✓ IndexedDB initialized in background');
          resolve(true);
        };
        
        request.onupgradeneeded = (e) => {
          console.log('[BackgroundDB] Creating object store...');
          const db = e.target.result;
          if (!db.objectStoreNames.contains('notes')) {
            db.createObjectStore('notes');
          }
        };
      } catch (error) {
        console.error('[BackgroundDB] Init error:', error);
        resolve(false);
      }
    });
  }
  
  async getAllNotes() {
    try {
      await this.ready;
      if (!this.db) {
        console.warn('[BackgroundDB] DB not ready');
        return [];
      }
      
      return new Promise((resolve) => {
        const tx = this.db.transaction('notes', 'readonly');
        const store = tx.objectStore('notes');
        const request = store.get(STORAGE_KEY);
        
        request.onsuccess = () => {
          const notes = request.result || [];
          console.log('[BackgroundDB] ✓ Retrieved', notes.length, 'notes from IndexedDB');
          resolve(notes);
        };
        
        request.onerror = () => {
          console.error('[BackgroundDB] ✗ Get error:', request.error);
          resolve([]);
        };
      });
    } catch (error) {
      console.error('[BackgroundDB] getAllNotes error:', error);
      return [];
    }
  }
  
  async saveNote(notes) {
    try {
      await this.ready;
      if (!this.db) {
        console.warn('[BackgroundDB] DB not ready, cannot save');
        return;
      }
      
      return new Promise((resolve) => {
        const tx = this.db.transaction('notes', 'readwrite');
        const store = tx.objectStore('notes');
        const request = store.put(notes, STORAGE_KEY);
        
        request.onsuccess = () => {
          console.log('[BackgroundDB] ✓ Saved', notes.length, 'notes to IndexedDB');
          resolve();
        };
        
        request.onerror = () => {
          console.error('[BackgroundDB] ✗ Save error:', request.error);
          resolve();
        };
      });
    } catch (error) {
      console.error('[BackgroundDB] saveNote error:', error);
    }
  }
}

// Initialize storage at script load
let bgStorage = null;
try {
  bgStorage = new BackgroundStorageDB();
  console.log('[Background] Storage initialized');
} catch (error) {
  console.error('[Background] Failed to initialize storage:', error);
}

// Migration: Move old notes from chrome.storage.local to IndexedDB if they exist
async function migrateOldNotes() {
  try {
    if (!bgStorage) {
      console.warn('[Background] Storage not available for migration');
      return;
    }
    await bgStorage.ready;
    const existingNotes = await bgStorage.getAllNotes();
    
    if (existingNotes && existingNotes.length > 0) {
      console.log('[Background] Migration: Notes already in IndexedDB, skipping');
      return;
    }
    
    // Try to get old notes from chrome.storage.local
    chrome.storage.local.get([STORAGE_KEY], async (result) => {
      const oldNotes = result[STORAGE_KEY];
      
      if (oldNotes && oldNotes.length > 0) {
        console.log('[Background] Migration: Found', oldNotes.length, 'old notes in chrome.storage, migrating to IndexedDB...');
        await bgStorage.saveNote(oldNotes);
        console.log('[Background] Migration: ✓ Migrated', oldNotes.length, 'notes to IndexedDB');
      } else {
        console.log('[Background] Migration: No old notes found');
      }
    });
  } catch (error) {
    console.warn('[Background] Migration error:', error);
  }
}

// Run migration on startup with error handling
setTimeout(() => {
  try {
    migrateOldNotes();
  } catch (error) {
    console.error('[Background] Migration startup error:', error);
  }
}, 100);

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

chrome.action.onClicked.addListener((tab) => {
  console.log('[Background] Action clicked!');
  
  // Open workspace.html in a new tab
  const windowUrl = chrome.runtime.getURL('workspace.html');
  console.log('[Background] Opening:', windowUrl);
  
  chrome.tabs.create({
    url: windowUrl
  }, (newTab) => {
    if (!newTab) {
      console.error('[Background] Failed to create tab');
    } else {
      console.log('[Background] Tab created successfully');
    }
  });
});

// UNIFIED Message handler - all message types
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log('[Background] Message received:', msg?.action);
    
    try {
      // Handle openWorkspace action
      if (msg && msg.action === 'openWorkspace') {
        console.log('[Background] Opening workspace...');
        const windowUrl = chrome.runtime.getURL('workspace.html');
        chrome.tabs.create({ url: windowUrl }, (tab) => {
          sendResponse({ success: !!tab });
        });
        return true;
      }
      
      // Storage proxy handlers - for persistent storage from popup
      if (msg && msg.action === 'getAllNotes') {
        console.log('[Background] 🔵 getAllNotes request received');
        bgStorage.getAllNotes().then((notes) => {
          console.log('[Background] 🟢 getAllNotes returning', notes.length, 'notes from IndexedDB');
          sendResponse({ notes: notes });
        });
        return true; // Will respond asynchronously
      }
      
      if (msg && msg.action === 'saveNote') {
        console.log('[Background] 🔵 saveNote request received for:', msg.note?.id, 'note:', msg.note);
        bgStorage.getAllNotes().then((notes) => {
          console.log('[Background] Current notes in IndexedDB:', notes.length);
          const index = notes.findIndex(n => n.id === msg.note.id);
          if (index >= 0) {
            notes[index] = msg.note;
            console.log('[Background] Updated note at index', index);
          } else {
            notes.push(msg.note);
            console.log('[Background] Added new note, total now:', notes.length);
          }
          console.log('[Background] About to save', notes.length, 'notes to IndexedDB');
          bgStorage.saveNote(notes).then(() => {
            console.log('[Background] 🟢 Saved to IndexedDB, total:', notes.length);
            // Verify it was written
            bgStorage.getAllNotes().then((verify) => {
              console.log('[Background] 🟢 Verification: IndexedDB now has', verify.length, 'notes');
              sendResponse({ success: true, count: notes.length });
            });
          });
        });
        return true; // Will respond asynchronously
      }
      
      if (msg && msg.action === 'deleteNote' && msg.noteId) {
        console.log('[Background] 🔵 deleteNote request for:', msg.noteId);
        bgStorage.getAllNotes().then((notes) => {
          console.log('[Background] Current notes before delete:', notes.length);
          const filtered = notes.filter(n => n.id !== msg.noteId);
          console.log('[Background] After filter:', filtered.length, 'notes');
          bgStorage.saveNote(filtered).then(() => {
            console.log('[Background] 🟢 Deleted note, IndexedDB now has:', filtered.length, 'notes');
            sendResponse({ success: true, count: filtered.length });
          });
        });
        return true; // Will respond asynchronously
      }
      
      if (msg && msg.action === 'postNow' && msg.noteId) {
        console.log('[Background] Received postNow for id:', msg.noteId);
        // Load notes and find the note from IndexedDB
        bgStorage.getAllNotes().then((notes) => {
          const note = notes.find(n => n.id === msg.noteId);
          if (note) {
            postScheduledNote(note).then(() => {
              sendResponse({ ok: true });
            });
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
  chrome.alarms.create(SCHEDULE_CHECK_ALARM, { periodInMinutes: 1 });
} catch (error) {
  console.warn('[Background] Failed to create alarm:', error);
}

// Listen for alarm
try {
  chrome.alarms.onAlarm.addListener((alarm) => {
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
  try {
    const notes = await bgStorage.getAllNotes();
    
    const now = Date.now();
    let needsUpdate = false;

    for (const note of notes) {
      if (note.status === 'scheduled' && note.scheduledFor) {
        // scheduledFor is now a timestamp (ms)
        const timeUntil = note.scheduledFor - now;
        
        if (timeUntil <= 0) {
          const statusBefore = note.status;
          await postScheduledNote(note);
          needsUpdate = true;
        }
      }
    }

    if (needsUpdate) {
      // Save updated notes to IndexedDB
      await bgStorage.saveNote(notes);
    }
  } catch (error) {
    console.error('[Background] Error checking scheduled posts:', error);
  }
}

async function postScheduledNote(note) {
  try {
    
    // Get Bluesky session
    const sessionResult = await new Promise((resolve, reject) => {
      chrome.storage.local.get(['blueskySession'], (result) => {
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
            chrome.storage.local.set({ 'blueskySession': session }, () => {
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
      previewUrl: note.customLinkPreview?.url
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

    // Handle image if present - upload separately as embed (only if no link preview)
    if (!hasLinkPreview && note.content && note.content.includes('<img')) {
      const imgMatch = note.content.match(/<img[^>]+src="([^"]+)"/);
      if (imgMatch && imgMatch[1]) {
        const imageDataUrl = imgMatch[1];
        
        // Convert data URL to blob
        const response = await fetch(imageDataUrl);
        const blob = await response.blob();
        
        // Upload blob to AT Protocol
        const uploadResponse = await fetch('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', {
          method: 'POST',
          headers: {
            'Content-Type': blob.type || 'image/jpeg',
            'Authorization': `Bearer ${session.accessJwt}`,
          },
          body: blob,
        });

        if (uploadResponse.ok) {
          const uploadData = await uploadResponse.json();
          postRecord.embed = {
            $type: 'app.bsky.embed.images',
            images: [{
              image: uploadData.blob,
              alt: note.title,
            }],
          };
        } else {
          console.warn('[Background] Image upload failed, posting without image');
        }
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



