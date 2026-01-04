// Background service worker - Opens workspace as popup window and handles scheduled posts

console.log('[Background] Script loaded');

const STORAGE_KEY = 'floatingNotes';
const SCHEDULE_CHECK_ALARM = 'checkScheduledPosts';

// Using chrome.storage.sync for persistent data synced to Firefox account
console.log('[Background] Using chrome.storage.sync for persistent data');

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
        console.log('[Background] getAllNotes request');
        chrome.storage.sync.get([STORAGE_KEY], (result) => {
          if (chrome.runtime.lastError) {
            console.error('[Background] ✗ Storage error:', chrome.runtime.lastError);
            sendResponse({ notes: [] });
            return;
          }
          const notes = result[STORAGE_KEY] || [];
          console.log('[Background] ✓ Returning', notes.length, 'notes from chrome.storage.sync');
          sendResponse({ notes: notes });
        });
        return true; // Will respond asynchronously
      }
      
      if (msg && msg.action === 'saveNote') {
        console.log('[Background] saveNote request for:', msg.note?.id);
        chrome.storage.sync.get([STORAGE_KEY], (result) => {
          if (chrome.runtime.lastError) {
            console.error('[Background] ✗ Storage error:', chrome.runtime.lastError);
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
          chrome.storage.sync.set({ [STORAGE_KEY]: notes }, () => {
            if (chrome.runtime.lastError) {
              console.error('[Background] ✗ Save failed:', chrome.runtime.lastError);
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
        chrome.storage.sync.get([STORAGE_KEY], (result) => {
          if (chrome.runtime.lastError) {
            console.error('[Background] ✗ Storage error:', chrome.runtime.lastError);
            sendResponse({ success: false });
            return;
          }
          const notes = result[STORAGE_KEY] || [];
          const filtered = notes.filter(n => n.id !== msg.noteId);
          chrome.storage.sync.set({ [STORAGE_KEY]: filtered }, () => {
            if (chrome.runtime.lastError) {
              console.error('[Background] ✗ Delete failed:', chrome.runtime.lastError);
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
        chrome.storage.sync.get([STORAGE_KEY], async (result) => {
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
          console.log('[Background] TIME TO POST! Calling postScheduledNote for:', note.title);
          const statusBefore = note.status;
          await postScheduledNote(note);
          console.log('[Background] After postScheduledNote - status changed from', statusBefore, 'to', note.status);
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
    
    // Get Bluesky session from both storage.local and storage.sync (fallback)
    let session = null;
    
    // Try chrome.storage.local first (Firefox)
    const localResult = await new Promise((resolve) => {
      chrome.storage.local.get(['blueskySession'], (result) => {
        resolve(result);
      });
    });
    
    if (localResult?.blueskySession) {
      session = localResult.blueskySession;
      console.log('[Background] Found session in chrome.storage.local');
    } else {
      // Fallback to chrome.storage.sync
      const syncResult = await new Promise((resolve) => {
        chrome.storage.sync.get(['blueskySession'], (result) => {
          resolve(result);
        });
      });
      if (syncResult?.blueskySession) {
        session = syncResult.blueskySession;
        console.log('[Background] Found session in chrome.storage.sync');
      }
    }
    
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
      const responseData = await postResponse.json();
      console.log('[Background] Response received:', responseData);
      
      note.status = 'published';
      const timestamp = Date.now();
      note.postedAt = timestamp;
      
      // Save the post URI from the API response
      if (responseData.uri) {
        note.postUri = responseData.uri;
        console.log('[Background] ✓ Post successful, saved URI:', responseData.uri);
      } else if (responseData.value && responseData.value.uri) {
        note.postUri = responseData.value.uri;
        console.log('[Background] ✓ Post successful, saved URI from value:', responseData.value.uri);
      } else {
        console.warn('[Background] ⚠️  No URI found in response:', Object.keys(responseData));
      }
      
      console.log('[Background] Note after URI assignment:', {id: note.id, postUri: note.postUri, status: note.status});
      
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



