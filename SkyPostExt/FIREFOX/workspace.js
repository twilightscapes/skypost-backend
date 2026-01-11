// Floating Notes Workspace - Full Screen Editor
class NotesWorkspace {
  constructor() {
    this.db = new NotesDBStorage();
    this.currentNote = null;
    this.allNotes = [];
    this.colors = ['#ffffff', '#fef08a', '#fca5a5', '#bfdbfe', '#bbf7d0', '#e9d5ff', '#fed7aa', '#f3f3f3'];
    this.currentFilter = 'all'; // Track current filter
    this.currentSearchQuery = ''; // Track search query
    
    // Initialize isPro from license manager if available
    if (typeof window.licenseManager !== 'undefined') {
      this.isPro = window.licenseManager.isProUser();
      console.log('[Workspace] isPro initialized from license manager:', this.isPro);
    } else {
      this.isPro = false;
    }
    
    // Initialize backup manager if available
    if (typeof BackupManager !== 'undefined') {
      this.backupManager = new BackupManager();
    }
    
    this.init();
  }

  async init() {
    try {
      
      // Initialize IndexedDB
      await this.db.init();

      // Load notes from storage
      this.allNotes = await this.db.getAllNotes();

      // Set up UI
      this.setupEventListeners();
      this.setupMessageListener();
      await this.renderNotesList();

      // Select first note if exists
      if (this.allNotes.length > 0) {
        this.selectNote(this.allNotes[0]);
      }

      // Note: Polling disabled. Background worker handles auto-posting scheduled notes.
      // Real-time updates of published/failed status will show on next manual refresh or extension reload.

      // During development attempt to maintain a long-lived port to the background
      // service worker so it doesn't shut down immediately and we can inspect logs.
      try {
        const tryConnectDevPort = () => {
          try {
            if (!(chrome && chrome.runtime && chrome.runtime.connect)) return false;
            // Clean up previous port if any
            if (this._devKeepAlivePort && this._devKeepAlivePort.disconnect) {
              try { this._devKeepAlivePort.disconnect(); } catch (e) {}
            }
            this._devKeepAlivePort = chrome.runtime.connect({ name: 'dev-keep-alive' });
            this._devKeepAlivePort.onDisconnect.addListener(() => {
              // Retry after a short delay
              setTimeout(() => tryConnectDevPort(), 500);
            });
            return true;
          } catch (err) {
            return false;
          }
        };

        // Try immediately and again after short intervals until connected
        if (!tryConnectDevPort()) {
          const retryInterval = setInterval(() => {
            if (tryConnectDevPort()) clearInterval(retryInterval);
          }, 500);
        }
      } catch (e) {
        // ignore in environments without chrome.runtime
      }

      // Show pro storage dashboard if user is pro
      console.log('[Workspace Init] isPro:', this.isPro, 'setupProStorageDashboard type:', typeof this.setupProStorageDashboard);
      if (this.isPro && typeof this.setupProStorageDashboard === 'function') {
        console.log('[Workspace Init] User is pro, initializing storage dashboard');
        this.setupProStorageDashboard();
      }

    } catch (error) {
      console.error('[Workspace Init] Error during initialization:', error);
    }
  }

  setupMessageListener() {
    console.log('[Workspace] Setting up message listener');
    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('[Workspace] ✓ Message received:', message?.action);
        
        if (message && (message.action === 'getScheduledNotes' || message.type === 'getScheduledNotes')) {
          console.log('[Workspace] Handling getScheduledNotes');
          console.log('[Workspace] this.db:', !!this.db, 'getAllNotes:', typeof this.db?.getAllNotes);
          
          if (!this.db) {
            console.log('[Workspace] DB not ready, returning empty');
            sendResponse({ notes: [] });
            return true;
          }
          
          this.db.getAllNotes().then(notes => {
            console.log('[Workspace] Got', notes.length, 'total notes');
            const schedulableNotes = notes.filter(n => n.scheduledFor && !n.status?.includes('published') && !n.status?.includes('failed'));
            console.log('[Workspace] Filtered to', schedulableNotes.length, 'schedulable notes');
            console.log('[Workspace] Sending response with', schedulableNotes.length, 'notes');
            sendResponse({ notes: schedulableNotes });
          }).catch(err => {
            console.error('[Workspace] Error getting notes:', err);
            sendResponse({ notes: [] });
          });
          return true;
        } else if (message && (message.action === 'getFullNote' || message.type === 'getFullNote')) {
          console.log('[Workspace] Handling getFullNote:', message.noteId);
          
          if (!this.db) {
            console.log('[Workspace] DB not ready, returning empty');
            sendResponse({ note: null });
            return true;
          }
          
          this.db.getAllNotes().then(notes => {
            const note = notes.find(n => n.id === message.noteId);
            console.log('[Workspace] Found note:', !!note, 'with', note?.imageData?.length || 0, 'images');
            sendResponse({ note: note || null });
          }).catch(err => {
            console.error('[Workspace] Error getting note:', err);
            sendResponse({ note: null });
          });
          return true;
        } else if (message && (message.action === 'updateScheduledNote' || message.type === 'updateScheduledNote')) {
          console.log('[Workspace] Handling updateScheduledNote:', message.note?.id, message.note?.status);
          // Background worker updated a note status - refresh the UI
          if (this.db && message.note) {
            // Save the updated note from background worker to ensure IndexedDB is in sync
            this.db.saveNote(message.note).then(() => {
              return this.db.getAllNotes();
            }).then(notes => {
              this.allNotes = notes;
              console.log('[Workspace] ✓ Updated IndexedDB, refreshing UI');
              // Refresh the notes list to show updated status
              this.renderNotesList();
              // If current note was updated, refresh its display too
              if (this.currentNote && this.currentNote.id === message.note.id) {
                const updated = notes.find(n => n.id === message.note.id);
                if (updated) {
                  this.currentNote = updated;
                  this.selectNote(updated);
                }
              }
              sendResponse({ success: true });
            }).catch(err => {
              console.error('[Workspace] Error updating notes:', err);
              sendResponse({ success: false });
            });
          } else {
            sendResponse({ success: false });
          }
          return true;
        } else if (message && message.type === 'postPublished') {
          // Handle real-time post publication notification from background
          console.log('[Workspace] Received postPublished notification for:', message.note?.id);
          console.log('[Workspace] Note has', message.note?.imageData?.length || 0, 'images');
          
          if (message.note && this.db) {
            // Ensure imageData is preserved
            if (!message.note.imageData) {
              console.warn('[Workspace] WARNING: imageData is missing in published note!');
            }
            
            // Update IndexedDB and refresh UI
            this.db.saveNote(message.note).then(() => {
              console.log('[Workspace] Saved published note to IndexedDB, imageData:', message.note.imageData?.length || 0);
              return this.db.getAllNotes();
            }).then(notes => {
              this.allNotes = notes;
              console.log('[Workspace] ✓ Post published! Updated UI');
              // Refresh the notes list to show updated status
              this.renderNotesList();
              // If current note was published, refresh its display too
              if (this.currentNote && this.currentNote.id === message.note.id) {
                const updated = notes.find(n => n.id === message.note.id);
                if (updated) {
                  console.log('[Workspace] Updated current note, imageData count:', updated.imageData?.length || 0);
                  this.currentNote = updated;
                  this.selectNote(updated);
                }
              }
              
              // Update storage dashboard if user is pro
              if (this.isPro) {
                this.setupProStorageDashboard();
              }
              
              sendResponse({ success: true });
            }).catch(err => {
              console.error('[Workspace] Error handling published post:', err);
              sendResponse({ success: false });
            });
          } else {
            sendResponse({ success: false });
          }
          return true;
        }
      });
    } else {
      console.log('[Workspace] chrome.runtime.onMessage not available');
    }
  }

  setupEventListeners() {
    // Only set up once
    if (this._eventListenersSetUp) return;
    this._eventListenersSetUp = true;

    // Close button
    document.getElementById('close-workspace').addEventListener('click', () => {
      window.close();
    });

    // New note
    document.getElementById('new-note-btn').addEventListener('click', async () => {
      // Save current draft if exists and has content
      if (this.currentNote) {
        const editor = document.getElementById('editor-content');
        const hasContent = editor && editor.textContent && editor.textContent.trim().length > 0;
        if (hasContent) {
          await this.saveCurrentNote();
          this.showMessage('Post saved ✓', 'success');
        }
      }
      this.createNewNote();
    });

    // Clear all
    document.getElementById('clear-all-btn').addEventListener('click', async () => {
      if (this.allNotes.length === 0) {
        this.showMessage('No notes to delete', 'info');
        return;
      }
      
      // Show custom confirmation modal
      const confirmed = await this.showConfirmModal(
        `Delete all ${this.allNotes.length} notes?`,
        'This action cannot be undone. All notes and Bluesky session data will be removed.'
      );
      
      if (confirmed) {
        try {
          await this.clearAllNotes();
        } catch (err) {
          console.error('[Workspace] Clear all error:', err);
          this.showMessage('❌ Error clearing notes: ' + err.message, 'error');
        }
      }
    });

    // Search functionality
    const searchInput = document.getElementById('notes-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.currentSearchQuery = e.target.value.toLowerCase().trim();
        this.renderNotesList();
      });
    }

    // Clear search button (the ✕ in search box) - only clears search, doesn't delete anything
    const clearSearchBtn = document.getElementById('clear-all');
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[Search] Clear search button clicked');
        this.currentSearchQuery = '';
        if (searchInput) {
          searchInput.value = '';
          console.log('[Search] Search input cleared');
        }
        // Don't reset filter - just clear the search query
        this.renderNotesList();
        console.log('[Search] Search cleared');
      });
    }

    // Toolbar buttons
    document.getElementById('btn-color').addEventListener('click', (e) => {
      e.preventDefault();
      const colorPicker = document.getElementById('color-picker');
      colorPicker.classList.toggle('visible');
    });

    // Initialize color picker dots
    this.initializeColorPicker();

    // Color filter dropdown toggle
    const colorFilterBtn = document.getElementById('color-filter-btn');
    if (colorFilterBtn) {
      colorFilterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = document.getElementById('color-filter-menu');
        if (menu) {
          menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        }
      });
      
      // Close dropdown when clicking outside
      document.addEventListener('click', () => {
        const menu = document.getElementById('color-filter-menu');
        if (menu) {
          menu.style.display = 'none';
        }
      });
    }

    // Tab switching for Posts/Calendar
    document.getElementById('tab-posts').addEventListener('click', () => {
      document.getElementById('posts-tab-content').style.display = 'block';
      document.getElementById('calendar-tab-content').style.display = 'none';
      document.getElementById('analytics-tab-content').style.display = 'none';
      document.getElementById('lists-tab-content').style.display = 'none';
      document.getElementById('tab-posts').classList.add('active');
      document.getElementById('tab-calendar').classList.remove('active');
      // Disabled tabs - don't reference them
      // document.getElementById('tab-analytics').classList.remove('active');
      // document.getElementById('tab-lists').classList.remove('active');
    });

    document.getElementById('tab-calendar').addEventListener('click', () => {
      document.getElementById('posts-tab-content').style.display = 'none';
      document.getElementById('calendar-tab-content').style.display = 'block';
      document.getElementById('analytics-tab-content').style.display = 'none';
      document.getElementById('lists-tab-content').style.display = 'none';
      document.getElementById('tab-posts').classList.remove('active');
      document.getElementById('tab-calendar').classList.add('active');
      // Disabled tabs - don't reference them
      // document.getElementById('tab-analytics').classList.remove('active');
      // document.getElementById('tab-lists').classList.remove('active');
      
      // Render calendar inline
      const self = this;
      const calendarView = document.getElementById('calendar-view');
      
      // Calendar filter state
      let calendarFilters = { scheduled: true, published: false };
      
      const getFilteredNotes = () => {
        let filtered = this.allNotes.filter(n => n.scheduledFor);
        if (calendarFilters.scheduled && !calendarFilters.published) {
          filtered = filtered.filter(n => n.status === 'scheduled');
        } else if (calendarFilters.published && !calendarFilters.scheduled) {
          filtered = filtered.filter(n => n.status === 'published');
        }
        return filtered;
      };
      
      // Build calendar HTML
      const now = new Date();
      let currentMonth = now.getMonth();
      let currentYear = now.getFullYear();
      
      const renderCalendarMonth = () => {
        const filteredNotes = getFilteredNotes();
        
        if (filteredNotes.length === 0) {
          calendarView.innerHTML = '<div style="text-align: center; color: #6b7280; padding: 2rem;">No posts to display</div>';
          return;
        }
        
        const notesByDate = {};
        filteredNotes.forEach(note => {
          const date = new Date(note.scheduledFor);
          const dateStr = date.toISOString().split('T')[0];
          if (!notesByDate[dateStr]) notesByDate[dateStr] = [];
          notesByDate[dateStr].push(note);
        });
        
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        let html = `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; padding: 0 0.5rem;">
          <button id="prev-month" style="background: #f3f4f6; border: 1px solid #d1d5db; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; color: #1f2937; font-weight: 500;">← Prev</button>
          <span style="font-weight: 600; font-size: 1rem; color: #1f2937;">${monthNames[currentMonth]} ${currentYear}</span>
          <button id="next-month" style="background: #f3f4f6; border: 1px solid #d1d5db; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; color: #1f2937; font-weight: 500;">Next →</button>
        </div>`;
        
        html += '<div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.5rem; padding: 0 0.5rem;">';
        dayNames.forEach(day => {
          html += `<div style="font-weight: 600; font-size: 0.8rem; color: #6b7280; text-align: center; padding: 0.5rem 0;">${day}</div>`;
        });
        
        const firstDay = new Date(currentYear, currentMonth, 1);
        const lastDay = new Date(currentYear, currentMonth + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startingDayOfWeek = firstDay.getDay();
        
        for (let i = 0; i < startingDayOfWeek; i++) {
          html += '<div style="background: #f3f4f6; border: 1px solid #e5e7eb; opacity: 0.3; border-radius: 4px; min-height: 80px;"></div>';
        }
        
        const getContrastColor = (hexColor) => {
          const hex = hexColor.replace('#', '');
          const r = parseInt(hex.substr(0, 2), 16);
          const g = parseInt(hex.substr(2, 2), 16);
          const b = parseInt(hex.substr(4, 2), 16);
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          return brightness > 128 ? '#000000' : '#ffffff';
        };
        
        for (let day = 1; day <= daysInMonth; day++) {
          const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const dayNotes = notesByDate[dateStr] || [];
          const bgColor = dayNotes.length > 0 ? '#dbeafe' : '#f3f4f6';
          const borderColor = dayNotes.length > 0 ? '#0284c7' : '#e5e7eb';
          
          html += `<div style="background: ${bgColor}; border: 1px solid ${borderColor}; border-radius: 4px; padding: 0.5rem; font-size: 0.75rem; min-height: 80px; display: flex; flex-direction: column;">
            <div style="font-weight: 600; color: #1f2937; margin-bottom: 0.25rem;">${day}</div>`;
          
          if (dayNotes.length > 0) {
            html += '<div style="display: flex; flex-direction: column; gap: 0.25rem; flex: 1; overflow-y: auto;">';
            dayNotes.forEach(note => {
              const time = new Date(note.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const noteColor = note.color || '#0284c7';
              const textColor = getContrastColor(noteColor);
              html += `<button class="calendar-note-btn" data-note-id="${note.id}" style="background: ${noteColor}; color: ${textColor}; border: none; padding: 0.4rem 0.5rem; border-radius: 3px; font-size: 0.65rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; text-align: left; transition: all 0.2s; font-weight: 500;" title="${note.title}">${time}</button>`;
            });
            html += '</div>';
          }
          
          html += '</div>';
        }
        
        const totalCells = startingDayOfWeek + daysInMonth;
        const remainingCells = (7 - (totalCells % 7)) % 7;
        for (let i = 0; i < remainingCells; i++) {
          html += '<div style="background: #f3f4f6; border: 1px solid #e5e7eb; opacity: 0.3; border-radius: 4px; min-height: 80px;"></div>';
        }
        
        html += '</div>';
        calendarView.innerHTML = html;
        
        // Add click handlers for note buttons
        document.querySelectorAll('.calendar-note-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const noteId = btn.getAttribute('data-note-id');
            const note = self.allNotes.find(n => n.id === noteId);
            if (note) {
              // Switch to posts tab
              document.getElementById('posts-tab-content').style.display = 'block';
              document.getElementById('calendar-tab-content').style.display = 'none';
              document.getElementById('tab-posts').classList.add('active');
              document.getElementById('tab-calendar').classList.remove('active');
              // Select the note
              setTimeout(() => {
                self.selectNote(note);
                // Scroll the note into view
                const noteCard = document.getElementById(`note-${noteId}`);
                if (noteCard) {
                  noteCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }, 100);
            }
          });
        });
        
        // Add navigation button listeners
        const prevBtn = document.getElementById('prev-month');
        const nextBtn = document.getElementById('next-month');
        
        if (prevBtn) {
          prevBtn.addEventListener('click', (e) => {
            e.preventDefault();
            currentMonth--;
            if (currentMonth < 0) {
              currentMonth = 11;
              currentYear--;
            }
            renderCalendarMonth();
          });
        }
        
        if (nextBtn) {
          nextBtn.addEventListener('click', (e) => {
            e.preventDefault();
            currentMonth++;
            if (currentMonth > 11) {
              currentMonth = 0;
              currentYear++;
            }
            renderCalendarMonth();
          });
        }
      };
      
      renderCalendarMonth();
    });

    // Analytics tab handler - DISABLED (feature not ready)
    // document.getElementById('tab-analytics').addEventListener('click', () => {
    //   // Check Pro license
    //   if (!window.licenseManager.canUseFeature('analytics')) {
    //     window.bluesky.showMessage('📊 Analytics is a Pro feature', 'info');
    //     window.renderProModal();
    //     document.getElementById('pro-modal').classList.add('active');
    //     return;
    //   }
    //
    //   document.getElementById('posts-tab-content').style.display = 'none';
    //   document.getElementById('calendar-tab-content').style.display = 'none';
    //   document.getElementById('analytics-tab-content').style.display = 'block';
    //   document.getElementById('lists-tab-content').style.display = 'none';
    //   document.getElementById('tab-posts').classList.remove('active');
    //   document.getElementById('tab-calendar').classList.remove('active');
    //   document.getElementById('tab-analytics').classList.add('active');
    //   document.getElementById('tab-lists').classList.remove('active');
    //   
    //   // Render analytics on workspace instance (which has allNotes)
    //   if (window.workspace && window.workspace.renderAnalytics) {
    //     window.workspace.renderAnalytics();
    //   }
    // });

    // Lists tab handler - DISABLED (feature not ready)
    // document.getElementById('tab-lists').addEventListener('click', () => {
    //   document.getElementById('posts-tab-content').style.display = 'none';
    //   document.getElementById('calendar-tab-content').style.display = 'none';
    //   document.getElementById('analytics-tab-content').style.display = 'none';
    //   document.getElementById('lists-tab-content').style.display = 'block';
    //   document.getElementById('tab-posts').classList.remove('active');
    //   document.getElementById('tab-calendar').classList.remove('active');
    //   document.getElementById('tab-analytics').classList.remove('active');
    //   document.getElementById('tab-lists').classList.add('active');
    //   
    //   // Render lists on workspace instance
    //   if (window.workspace && window.workspace.renderLists) {
    //     window.workspace.renderLists();
    //   }
    // });

    document.getElementById('btn-image').addEventListener('click', (e) => {
      e.preventDefault();
      
      // Create a note if none exists
      if (!this.currentNote) {
        this.createNewNote();
      }
      
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.multiple = true; // Allow selecting multiple files at once
      fileInput.onchange = (event) => {
        if (!event.target.files) {
          console.error('[ImageUpload] No files selected');
          return;
        }
        
        const files = Array.from(event.target.files);
        console.log('[ImageUpload] Selected', files.length, 'files');
        
        if (files.length === 0) {
          console.warn('[ImageUpload] No files to upload');
          return;
        }
        
        let uploadedCount = 0;
        let failedCount = 0;
        
        for (const file of files) {
          // Check if we've reached the 4 image limit
          if (this.currentNote && this.currentNote.imageData && this.currentNote.imageData.length >= 4) {
            console.warn('[ImageUpload] Maximum 4 images reached, skipping remaining files');
            break;
          }
          
          if (!file.type.startsWith('image/')) {
            console.warn('[ImageUpload] Skipping non-image file:', file.type);
            failedCount++;
            continue;
          }
          
          try {
            const reader = new FileReader();
            reader.onload = (readerEvent) => {
              try {
                if (!readerEvent.target?.result) {
                  console.error('[ImageUpload] Failed to read file:', file.name);
                  failedCount++;
                  return;
                }
                
                // Add image to array (max 4 images)
                if (this.currentNote) {
                  if (!this.currentNote.imageData) {
                    this.currentNote.imageData = [];
                  }
                  
                  if (this.currentNote.imageData.length < 4) {
                    this.currentNote.imageData.push(readerEvent.target.result);
                    uploadedCount++;
                    console.log('[ImageUpload] Added image', uploadedCount, 'of', files.length);
                  } else {
                    console.warn('[ImageUpload] Maximum 4 images reached');
                  }
                }
              } catch (err) {
                console.error('[ImageUpload] Error processing image:', err);
                failedCount++;
              }
            };
            reader.onerror = (error) => {
              console.error('[ImageUpload] FileReader error:', error);
              failedCount++;
            };
            reader.readAsDataURL(file);
          } catch (err) {
            console.error('[ImageUpload] Error reading file', file.name, ':', err);
            failedCount++;
          }
        }
        
        // After all files are processed, update display and save
        setTimeout(() => {
          console.log('[ImageUpload] Complete - uploaded:', uploadedCount, 'failed:', failedCount);
          this.updateAttachmentsDisplay();
          this.saveCurrentNote(); // Auto-save
          
          if (failedCount > 0) {
            this.showMessage(`⚠️ Uploaded ${uploadedCount}/${files.length} images`, 'warning');
          } else if (uploadedCount > 0) {
            this.showMessage(`✓ Uploaded ${uploadedCount} image${uploadedCount !== 1 ? 's' : ''}`, 'success');
          }
        }, 100);
      };
      fileInput.click();
    });

    // Save button
    document.getElementById('btn-save').addEventListener('click', async () => {
      await this.saveCurrentNote();
      this.showMessage('Post saved ✓', 'success');
    });

    // Schedule button
    document.getElementById('btn-schedule').addEventListener('click', () => {
      if (!this.currentNote) {
        alert('Please create a post first');
        return;
      }
      
      // Check scheduled post limit for non-pro users
      if (!this.isPro) {
        const scheduledCount = this.allNotes.filter(n => n.status === 'scheduled').length;
        if (scheduledCount >= 1) {
          this.showMessage('❌ Upgrade to Pro to schedule more posts', 'info');
          return;
        }
      }
      
      // Save current note before scheduling
      this.currentNote.title = document.getElementById('note-title').value || 'Untitled Post';
      const editor = document.getElementById('editor-content');
      this.currentNote.content = editor.innerHTML || editor.value || '';
      this.showScheduleModal();
    });

    // Schedule form
    const scheduleForm = document.getElementById('schedule-form');
    if (scheduleForm) {
      scheduleForm.addEventListener('submit', (e) => {
        console.log('[EventListener] Schedule form submit');
        e.preventDefault();
        this.scheduleCurrentNote();
      });
    } else {
      console.warn('[EventListener] schedule-form element not found');
    }

    // Also add direct click handler to schedule button as fallback
    const scheduleBtn = scheduleForm ? scheduleForm.querySelector('button[type="submit"]') : document.querySelector('form#schedule-form button[type="submit"]');
    if (scheduleBtn) {
      console.log('[EventListener] Schedule button found, adding click handler');
      scheduleBtn.addEventListener('click', (e) => {
        console.log('[EventListener] Schedule button clicked');
        // Let form handle it if it submits, but this is a fallback
        if (!e.defaultPrevented) {
          e.preventDefault();
          this.scheduleCurrentNote();
        }
      });
    } else {
      console.warn('[EventListener] schedule button not found');
    }

    document.getElementById('cancel-schedule').addEventListener('click', () => {
      // Clear scheduled time if one was set
      if (this.currentNote) {
        this.currentNote.scheduledFor = null;
        this.saveCurrentNote();
      }
      this.hideScheduleModal();
    });

    // Close modal on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideScheduleModal();
      }
    });

    // Delete button (also handles retry for failed notes)
    document.getElementById('btn-delete').addEventListener('click', () => {
      if (this.currentNote && this.currentNote.status === 'failed') {
        this.retryFailedNote();
      } else {
        this.deleteCurrentNote();
      }
    });

    // Attachment removal handlers
    const removeImageBtn = document.getElementById('editor-remove-image-btn');
    if (removeImageBtn) {
      removeImageBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.removeAttachment('image');
      });
    }

    // Individual image removal
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('editor-remove-image-individual')) {
        e.preventDefault();
        const index = parseInt(e.target.getAttribute('data-image-index'));
        this.removeAttachment('image', index);
      }
    });

    const removeVideoBtn = document.getElementById('editor-remove-video-btn');
    if (removeVideoBtn) {
      removeVideoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.removeAttachment('video');
      });
    }

    // #Adblock hashtag checkbox
    const adblockCheckbox = document.getElementById('editor-video-adblock-checkbox');
    if (adblockCheckbox) {
      adblockCheckbox.addEventListener('change', (e) => {
        if (this.currentNote) {
          this.currentNote.addAdblockHashtag = e.target.checked;
        }
      });
    }

    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;
      
      if (modKey && e.key === 's') {
        e.preventDefault();
        this.saveCurrentNote();
      }
    });

    // Hide placeholder when typing
    const editorContent = document.getElementById('editor-content');
    if (editorContent) {
      // Listen for input on contenteditable div
      editorContent.addEventListener('input', async () => {
        // Auto-create note on first input if none exists
        if (!this.currentNote) {
          await this.createNewNote();
        }
        
        // Auto-update title based on first line of content
        if (this.currentNote) {
          const firstLine = editorContent.textContent.split('\n')[0].substring(0, 50) || 'Untitled Post';
          this.currentNote.title = firstLine;
        }
        
        this.updatePlaceholder();
        this.updateCharCounter();
        const text = editorContent.textContent || '';
        this.detectAndShowEditorLinkPreview(text);
      });
    }

    // Set up event delegation for notes list (added once, not on every render)
    const notesList = document.getElementById('notes-list');
    notesList.addEventListener('click', (e) => {
      const noteCard = e.target.closest('.note-card-content');
      if (noteCard) {
        const noteId = noteCard.parentElement.getAttribute('data-note-id');
        const note = this.allNotes.find(n => n.id === noteId);
        if (note) {
          // Save current note before switching
          if (this.currentNote) {
            this.currentNote.title = document.getElementById('note-title').value || 'Untitled Post';
            const editor = document.getElementById('editor-content');
            this.currentNote.content = editor.innerHTML || '';
          }
          this.selectNote(note);
        }
      }

      const shareBtn = e.target.closest('.note-card-share');
      if (shareBtn) {
        e.stopPropagation();
        const noteId = shareBtn.getAttribute('data-share-note');
        const note = this.allNotes.find(n => n.id === noteId);
        if (note && window.bluesky) {
          // Decode HTML entities and strip tags while preserving line breaks
          let cleanedContent = note.content
            .replace(/<img[^>]*>/g, '') // Remove images
            .replace(/<br\s*\/?>/gi, '\n') // Convert <br> to newlines
            .replace(/<p>/gi, '') // Remove opening <p> tags
            .replace(/<\/p>/gi, '\n') // Replace closing </p> with newlines
            .replace(/<div>/gi, '') // Remove opening <div> tags
            .replace(/<\/div>/gi, '\n') // Replace closing </div> with newlines
            .replace(/<[^>]*>/g, ''); // Remove all other remaining tags
          
          const textarea = document.createElement('textarea');
          textarea.innerHTML = cleanedContent;
          let cleanContent = textarea.value.trim();
          
          // Add #Adblock hashtag if enabled for video/YouTube link posts
          if (note.addAdblockHashtag && !cleanContent.includes('#Adblock')) {
            cleanContent = (cleanContent ? cleanContent + ' ' : '') + '#Adblock';
          }
          
          const text = cleanContent;
          
          // Use imageData from note object (new unified attachments panel)
          const imageData = note.imageData || [];
          
          // Pass customLinkPreview too
          window.bluesky.sendToComposer(text, imageData, note.customLinkPreview);
        }
      }

      const deleteBtn = e.target.closest('.note-card-delete');
      if (deleteBtn) {
        e.stopPropagation();
        const noteId = deleteBtn.getAttribute('data-delete-note');
        this.deleteNote(noteId);
      }
    });
  }

  initializeColorPicker() {
    const colorPicker = document.getElementById('color-picker');
    colorPicker.innerHTML = '';
    
    this.colors.forEach((color, index) => {
      const dot = document.createElement('button');
      dot.className = 'color-dot';
      dot.style.backgroundColor = color;
      dot.title = `Select color ${color}`;
      dot.type = 'button';
      
      if (this.currentNote && this.currentNote.color === color) {
        dot.classList.add('selected');
      }
      
      dot.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.currentNote) {
          this.currentNote.color = color;
          this.updateColorPicker();
          document.getElementById('color-picker').classList.remove('visible');
          this.saveCurrentNote();
          this.renderNotesList();
        }
      });
      
      colorPicker.appendChild(dot);
    });
    
    // Close picker when clicking outside
    document.addEventListener('click', (e) => {
      const btn = document.getElementById('btn-color');
      const picker = document.getElementById('color-picker');
      if (!btn.contains(e.target) && !picker.contains(e.target)) {
        picker.classList.remove('visible');
      }
    });
  }

  updateColorPicker() {
    const dots = document.querySelectorAll('.color-dot');
    dots.forEach((dot) => {
      dot.classList.remove('selected');
    });
    
    if (this.currentNote) {
      dots.forEach((dot) => {
        if (dot.style.backgroundColor === this.currentNote.color) {
          dot.classList.add('selected');
        }
      });
    }
  }

  updatePlaceholder() {
    const editor = document.getElementById('editor-content');
    if (!editor) return;
    
    const isEmpty = !editor.textContent || editor.textContent.trim() === '';
    const placeholder = editor.getAttribute('data-placeholder');
    
    if (isEmpty && placeholder) {
      editor.classList.add('empty-placeholder');
    } else {
      editor.classList.remove('empty-placeholder');
    }
  }

  updateCharCounter() {
    const editor = document.getElementById('editor-content');
    const counter = document.getElementById('char-counter');
    const charCount = document.getElementById('char-count');
    const MAX_CHARS = 300;
    
    // Get text from contenteditable div
    const text = editor.textContent || '';
    const count = text.length;
    
    charCount.textContent = count;
    
    // Update visual warning states
    counter.classList.remove('warning', 'error');
    if (count > MAX_CHARS) {
      counter.classList.add('error');
    } else if (count > MAX_CHARS * 0.9) {
      counter.classList.add('warning');
    }
  }

  async createNewNote() {
    const note = {
      id: Date.now().toString(),
      title: 'New Post',
      content: '',
      color: '#ffffff',
      status: 'draft',
      scheduledFor: null,
      postedAt: null,
      postUri: null,  // Bluesky post URI for analytics
      analytics: null,  // Store engagement stats
      failureReason: null,
      createdAt: Date.now(),
      // Attachments
      imageData: [],  // Array of up to 4 base64 image data strings
      customLinkPreview: null,  // { url, title, description, image }
      videoData: null,  // Video embed data
      addAdblockHashtag: false,  // Flag to add #Adblock on video posts
    };

    this.allNotes.unshift(note);
    await this.db.saveNote(note);
    this.selectNote(note);
    await this.renderNotesList();
    
    // Focus editor for immediate editing (title is hidden)
    const editor = document.getElementById('editor-content');
    editor.focus();
  }

  selectNote(note) {
    this.currentNote = note;

    // Ensure imageData is always an array (for backward compatibility)
    if (note.imageData === null || note.imageData === undefined || typeof note.imageData === 'string') {
      note.imageData = note.imageData ? [note.imageData] : [];
    }

    // Update UI - extract first line of content as title for display
    const firstLine = (note.content || '').split('\n')[0].substring(0, 50) || 'Untitled Post';
    note.title = firstLine;
    document.getElementById('note-title').value = note.title;
    
    // Set content in contenteditable div - preserve HTML (images, etc)
    const editor = document.getElementById('editor-content');
    editor.innerHTML = note.content || '';
    
    // Update attachments display (unified panel for image, link, video)
    this.updateAttachmentsDisplay();
    
    // Update #Adblock checkbox state
    const adblockCheckbox = document.getElementById('editor-video-adblock-checkbox');
    if (adblockCheckbox) {
      adblockCheckbox.checked = note.addAdblockHashtag || false;
    }
    
    // Clear Bluesky panel images and previews when switching notes
    const bskyImagePreview = document.getElementById('bsky-image-preview');
    if (bskyImagePreview) {
      bskyImagePreview.style.display = 'none';
    }
    const bskyLinkPreview = document.getElementById('bsky-link-preview');
    if (bskyLinkPreview) {
      bskyLinkPreview.style.display = 'none';
    }
    
    // Update color picker
    this.updateColorPicker();
    
    // Update sidebar - only update the active class
    const previousActive = document.querySelector('.note-card.active');
    if (previousActive) previousActive.classList.remove('active');
    const newActive = document.getElementById(`note-${note.id}`);
    if (newActive) newActive.classList.add('active');

    // Disable editing for failed notes only
    const noteTitle = document.getElementById('note-title');
    const editorContent = document.getElementById('editor-content');
    const colorPickerBtn = document.getElementById('btn-color');
    const imageBtn = document.getElementById('btn-image');
    const deleteBtn = document.getElementById('btn-delete');
    const saveBtn = document.getElementById('btn-save');
    const scheduleBtn = document.getElementById('btn-schedule');

    if (note.status === 'failed') {
      // Failed: read-only, show retry and delete
      noteTitle.disabled = true;
      editorContent.disabled = true;
      editorContent.style.opacity = '0.6';
      colorPickerBtn.style.opacity = '0.5';
      colorPickerBtn.style.cursor = 'not-allowed';
      imageBtn.style.opacity = '0.5';
      imageBtn.style.cursor = 'not-allowed';
      deleteBtn.style.display = 'inline-block';
      deleteBtn.textContent = '🔄 Retry';
      saveBtn.style.display = 'none';
      scheduleBtn.style.display = 'none';
    } else {
      // Draft/scheduled/published: editable
      noteTitle.disabled = false;
      editorContent.disabled = false;
      editorContent.style.opacity = '1';
      colorPickerBtn.style.opacity = '1';
      colorPickerBtn.style.cursor = 'pointer';
      imageBtn.style.opacity = '1';
      imageBtn.style.cursor = 'pointer';
      deleteBtn.style.display = 'inline-block';
      deleteBtn.textContent = 'Delete';
      saveBtn.style.display = 'inline-block';
      scheduleBtn.style.display = 'inline-block';
    }

    this.updatePlaceholder();
    this.updateCharCounter();
  }

  async saveCurrentNote() {
    if (!this.currentNote) return;

    this.currentNote.title = document.getElementById('note-title').value || 'Untitled Post';
    // Save content from textarea/contenteditable - try innerHTML first (for images), fall back to value
    const editor = document.getElementById('editor-content');
    this.currentNote.content = editor.innerHTML || editor.value || '';

    // Add #Adblock hashtag if enabled and this is a video post
    if (this.currentNote.addAdblockHashtag && this.currentNote.videoData && !this.currentNote.content.includes('#Adblock')) {
      this.currentNote.content = (this.currentNote.content.trim() ? this.currentNote.content.trim() + ' ' : '') + '#Adblock';
    }

    // DEBUG: Log what we're saving
    console.log('[Workspace] Saving note with customLinkPreview:', this.currentNote.customLinkPreview);
    
    await this.db.saveNote(this.currentNote);
    
    // Refresh the UI to show updated title in the list
    await this.renderNotesList();
    
    // Update storage dashboard if user is pro
    if (this.isPro) {
      this.setupProStorageDashboard();
    }
    
    // Re-select the current note to refresh the editor display
    this.selectNote(this.currentNote);
  }

  async deleteCurrentNote() {
    if (!this.currentNote || !confirm('Delete this note?')) return;

    const noteId = this.currentNote.id;
    await this.db.deleteNote(noteId);
    
    this.allNotes = this.allNotes.filter(n => n.id !== noteId);

    // Clear editor
    this.currentNote = null;
    document.getElementById('note-title').value = '';
    document.getElementById('editor-content').innerHTML = '';
    this.updatePlaceholder();

    // Update list and select first if exists
    await this.renderNotesList();
    
    // Update storage dashboard if user is pro
    if (this.isPro) {
      this.setupProStorageDashboard();
    }
    
    if (this.allNotes.length > 0) {
      this.selectNote(this.allNotes[0]);
    }
  }

  // Attachment Management Methods
  
  removeAttachment(type, index = null) {
    if (!this.currentNote) return;
    
    if (type === 'image') {
      if (index !== null && Array.isArray(this.currentNote.imageData)) {
        this.currentNote.imageData.splice(index, 1);
      } else {
        this.currentNote.imageData = [];
      }
      this.updateAttachmentsDisplay();
    } else if (type === 'link') {
      this.currentNote.customLinkPreview = null;
      this.updateAttachmentsDisplay();
    } else if (type === 'video') {
      this.currentNote.videoData = null;
      this.updateAttachmentsDisplay();
    }
    
    // Auto-save
    this.saveCurrentNote();
  }

  updateAttachmentsDisplay() {
    const panel = document.getElementById('editor-attachments-panel');
    const imagePreview = document.getElementById('editor-image-preview');
    const linkPreview = document.getElementById('editor-link-preview');
    const videoPreview = document.getElementById('editor-video-preview');
    
    if (!this.currentNote) {
      panel.style.display = 'none';
      return;
    }

    let hasAny = false;

    // Show/hide images (up to 4)
    if (this.currentNote.imageData && this.currentNote.imageData.length > 0) {
      imagePreview.style.display = 'block';
      const imagesGrid = document.getElementById('editor-images-grid');
      const imageCount = document.getElementById('editor-image-count');
      
      imagesGrid.innerHTML = '';
      this.currentNote.imageData.forEach((imgData, idx) => {
        const imgContainer = document.createElement('div');
        imgContainer.style.position = 'relative';
        imgContainer.style.display = 'inline-block';
        imgContainer.innerHTML = `
          <img src="${imgData}" style="max-width: 100%; height: 120px; width: 100%; object-fit: cover; border-radius: 4px;">
          <button type="button" data-image-index="${idx}" class="editor-remove-image-individual" style="position: absolute; top: 2px; right: 2px; background: rgba(239, 68, 68, 0.9); color: white; border: none; border-radius: 4px; width: 24px; height: 24px; cursor: pointer; font-size: 0.75rem; padding: 0; display: flex; align-items: center; justify-content: center;">✕</button>
        `;
        imagesGrid.appendChild(imgContainer);
      });
      
      imageCount.textContent = this.currentNote.imageData.length;
      hasAny = true;
    } else {
      imagePreview.style.display = 'none';
    }

    // Show/hide link preview
    if (this.currentNote.customLinkPreview) {
      linkPreview.style.display = 'block';
      const content = document.getElementById('editor-link-preview-content');
      content.innerHTML = this.formatLinkPreview(this.currentNote.customLinkPreview);
      
      // Add event listeners for edit and remove buttons
      setTimeout(() => {
        const editBtn = document.getElementById('editor-link-edit-btn');
        if (editBtn) {
          editBtn.onclick = (e) => {
            e.preventDefault();
            this.togglePreviewEdit(linkPreview, this.currentNote.customLinkPreview);
          };
        }
        
        const upgradeBtn = document.getElementById('editor-link-upgrade-btn');
        if (upgradeBtn) {
          upgradeBtn.onclick = (e) => {
            e.preventDefault();
            this.showProModal('Custom Link Previews', 'Edit and customize your link previews with custom titles, descriptions, and images. Stand out with rich link cards!');
          };
        }
        
        const removeBtn = document.getElementById('editor-link-edit-remove-btn');
        if (removeBtn) {
          removeBtn.onclick = (e) => {
            e.preventDefault();
            this.removeAttachment('link');
          };
        }
        
        // Handle YouTube #Adblock checkbox
        const adblockCheckbox = document.getElementById('editor-link-adblock-checkbox');
        if (adblockCheckbox) {
          adblockCheckbox.checked = this.currentNote.addAdblockHashtag || false;
          adblockCheckbox.onchange = (e) => {
            if (this.currentNote) {
              this.currentNote.addAdblockHashtag = e.target.checked;
            }
          };
        }
      }, 0);
      
      hasAny = true;
    } else {
      linkPreview.style.display = 'none';
    }

    // Show/hide video
    if (this.currentNote.videoData) {
      videoPreview.style.display = 'block';
      // Render video preview
      hasAny = true;
    } else {
      videoPreview.style.display = 'none';
    }

    // Show/hide panel
    panel.style.display = hasAny ? 'block' : 'none';
  }

  formatLinkPreview(preview) {
    if (!preview) return '';
    
    // Show edit button for pro users, upgrade button for non-pro users
    let actionBtn = '';
    if (window.licenseManager && window.licenseManager.isProUser()) {
      actionBtn = `<button type="button" id="editor-link-edit-btn" style="flex: 1; padding: 0.4rem 0.8rem; background: #0284c7; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem; font-weight: 500;">✏️ Edit</button>`;
    } else {
      actionBtn = `<button type="button" id="editor-link-upgrade-btn" style="flex: 1; padding: 0.4rem 0.8rem; background: #8b5cf6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem; font-weight: 500;">⭐ Upgrade to Edit</button>`;
    }
    
    // Check if this is a YouTube video
    const isYoutubeVideo = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/.test(preview.url);
    const adblockCheckbox = isYoutubeVideo ? `
      <div style="margin-bottom: 0.5rem; padding-top: 0.5rem; border-top: 1px solid #e5e7eb;">
        <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 0.8rem;">
          <input type="checkbox" id="editor-link-adblock-checkbox" style="cursor: pointer;">
          <span>Add #Adblock hashtag</span>
        </label>
      </div>
    ` : '';
    
    return `
      <div style="font-size: 0.85rem; line-height: 1.4;">
        ${preview.image ? `<img src="${preview.image}" style="max-width: 100%; max-height: 120px; border-radius: 4px; margin-bottom: 0.5rem;">` : ''}
        ${preview.title ? `<div style="font-weight: 600; color: #1f2937; margin-bottom: 0.25rem;">${this.escapeHtml(preview.title)}</div>` : ''}
        ${preview.description ? `<div style="color: #6b7280; margin-bottom: 0.25rem;">${this.escapeHtml(preview.description.substring(0, 100))}</div>` : ''}
        <div style="color: #0066cc; word-break: break-all; font-size: 0.75rem; margin-bottom: 0.75rem;">${this.escapeHtml(preview.url)}</div>
        ${adblockCheckbox}
        <div style="display: flex; gap: 0.5rem;">
          ${actionBtn}
          <button type="button" id="editor-link-edit-remove-btn" style="flex: 1; padding: 0.4rem 0.8rem; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem; font-weight: 500;">🗑️ Remove</button>
        </div>
      </div>
    `;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async retryFailedNote() {
    if (!this.currentNote || this.currentNote.status !== 'failed') return;

    // Reset status to draft and clear failure reason
    this.currentNote.status = 'draft';
    this.currentNote.failureReason = null;

    await this.db.saveNote(this.currentNote);

    // Update list
    await this.renderNotesList();
    this.selectNote(this.currentNote);
  }

  async clearAllNotes() {
    try {
      for (const note of this.allNotes) {
        await this.db.deleteNote(note.id);
      }

      this.allNotes = [];
      this.currentNote = null;

      // Update UI
      document.getElementById('note-title').value = '';
      document.getElementById('editor-content').innerHTML = '';
      this.updatePlaceholder();
      await this.renderNotesList();
      
      // Clear ALL data including Bluesky session from both storages
      try {
        // Clear sync storage
        await new Promise((resolve, reject) => {
          chrome.storage.sync.clear(() => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              console.log('[Workspace] Sync storage cleared');
              resolve();
            }
          });
        });
        
        // Clear local storage (includes blueskySession)
        await new Promise((resolve, reject) => {
          chrome.storage.local.clear(() => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              console.log('[Workspace] Local storage cleared');
              resolve();
            }
          });
        });
      } catch (syncErr) {
        console.warn('[Workspace] Storage clear error:', syncErr);
      }
      
      this.showMessage('✅ All data removed', 'success');
      
      // Refresh the page to fully reset the UI (like license activation)
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('[Workspace] Error clearing notes:', error);
      this.showMessage('❌ Error deleting notes: ' + error.message, 'error');
    }
  }

  async renderNotesList() {
    const list = document.getElementById('notes-list');
    const container = document.getElementById('all-notes-container');
    
    if (this.allNotes.length === 0) {
      container.innerHTML = '';
      document.getElementById('empty-state').style.display = 'flex';
      return;
    }

    document.getElementById('empty-state').style.display = 'none';

    // Build unique color filter buttons
    const uniqueColors = [...new Set(this.allNotes.map(n => n.color || '#ffffff'))].sort();
    // Filter out white (#ffffff) as it's the default
    const colorOptions = uniqueColors.filter(color => color !== '#ffffff');
    const colorFiltersContainer = document.getElementById('color-filters');
    const colorFilterBtn = document.getElementById('color-filter-btn');
    const colorFilterMenu = document.getElementById('color-filter-menu');
    
    if (colorFiltersContainer) {
      if (colorOptions.length === 0) {
        // Hide color filter button if no colors are set
        if (colorFilterBtn) colorFilterBtn.style.display = 'none';
        if (colorFilterMenu) colorFilterMenu.style.display = 'none';
        colorFiltersContainer.innerHTML = '';
      } else {
        if (colorFilterBtn) colorFilterBtn.style.display = 'inline-block';
        colorFiltersContainer.innerHTML = colorOptions.map(color => `
          <button class="color-filter-btn" data-filter="color-${color}" style="
            width: 28px;
            height: 28px;
            border-radius: 4px;
            background-color: ${color};
            border: 2px solid transparent;
            cursor: pointer;
            transition: all 0.2s;
          " title="Filter by ${color}"></button>
        `).join('');
        
        // Add click handlers to color filter buttons
        document.querySelectorAll('.color-filter-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const filter = btn.getAttribute('data-filter');
            this.currentFilter = filter;
            this.updateFilterButtons();
            this.renderNotesList();
            // Close dropdown after selection
            const menu = document.getElementById('color-filter-menu');
            if (menu) {
              menu.style.display = 'none';
            }
          });
        });
      }
    }

    // Add click handlers to type filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.getAttribute('data-filter');
        this.currentFilter = filter;
        this.updateFilterButtons();
        this.renderNotesList();
        // Close dropdown when selecting type filter
        const menu = document.getElementById('color-filter-menu');
        if (menu) {
          menu.style.display = 'none';
        }
      });
    });

    // Update filter button styles
    this.updateFilterButtons();

    // Filter notes based on current filter
    let filteredNotes = this.allNotes;
    
    if (this.currentFilter.startsWith('color-')) {
      const filterColor = this.currentFilter.replace('color-', '');
      filteredNotes = this.allNotes.filter(n => (n.color || '#ffffff') === filterColor);
    } else {
      switch (this.currentFilter) {
        case 'has-image':
          filteredNotes = this.allNotes.filter(n => n.imageData && n.imageData.length > 0);
          break;
        case 'has-video':
          filteredNotes = this.allNotes.filter(n => 
            n.videoData ||
            n.content.includes('<video') || 
            n.content.match(/\.(mp4|webm|mov|mkv|avi|flv)/i) ||
            n.content.match(/(youtu\.be|youtube\.com|vimeo\.com|twitch\.tv|dailymotion\.com)/i)
          );
          break;
        case 'text-only':
          filteredNotes = this.allNotes.filter(n => (!n.imageData || n.imageData.length === 0) && !n.videoData);
          break;
        case 'empty':
          filteredNotes = this.allNotes.filter(n => !n.content || n.content.trim() === '');
          break;
        case 'scheduled':
          filteredNotes = this.allNotes.filter(n => n.status === 'scheduled');
          break;
        case 'published':
          filteredNotes = this.allNotes.filter(n => n.status === 'published');
          break;
        case 'all':
        default:
          filteredNotes = this.allNotes;
          break;
      }
    }

    // Apply search query filter if present
    if (this.currentSearchQuery && this.currentSearchQuery.length > 0) {
      filteredNotes = filteredNotes.filter(n => {
        const title = (n.title || '').toLowerCase();
        const content = (n.content || '').toLowerCase();
        // Remove HTML tags for better search matching
        const cleanContent = content.replace(/<[^>]*>/g, '');
        return title.includes(this.currentSearchQuery) || cleanContent.includes(this.currentSearchQuery);
      });
    }

    // Sort by date (newest first)
    let sortedNotes = [...filteredNotes];
    sortedNotes.sort((a, b) => b.createdAt - a.createdAt);

    // Group by status
    const groups = {
      draft: [],
      scheduled: [],
      published: [],
      failed: []
    };

    for (const note of sortedNotes) {
      const status = note.status || 'draft';
      if (groups[status]) {
        groups[status].push(note);
      } else {
        groups.draft.push(note);
      }
    }

    const renderSection = (notes, title, statusType) => {
      if (notes.length === 0) return '';
      
      return `
        <div class="notes-section">
          <div class="section-header">${title} (${notes.length})</div>
          ${notes.map(note => {
            let statusBadge = '';
            let timeInfo = '';
            
            if (note.status === 'scheduled' && note.scheduledFor) {
              const timeLeft = note.scheduledFor - Date.now();
              if (timeLeft > 0) {
                timeInfo = this.formatTimeUntil(timeLeft);
                statusBadge = `<span class="status-badge scheduled">📅 ${timeInfo}</span>`;
              } else {
                statusBadge = `<span class="status-badge expired">⏰ Posting</span>`;
              }
            } else if (note.status === 'published' && note.postedAt) {
              timeInfo = this.formatTimeAgo(Date.now() - note.postedAt);
              statusBadge = `<span class="status-badge published">✨ ${timeInfo}</span>`;
            } else if (note.status === 'failed') {
              const failureText = note.failureReason || 'Unknown error';
              statusBadge = `<span class="status-badge failed" title="${failureText}">❌ Failed</span>`;
            }
            
            return `
              <div class="note-card ${this.currentNote?.id === note.id ? 'active' : ''}" id="note-${note.id}" data-note-id="${note.id}">
                <div class="note-card-color" style="background-color: ${note.color};"></div>
                <div class="note-card-content">
                  <div class="note-card-title" style="font-size: 0.75rem; color: #999; font-weight: 500;">Post #${this.allNotes.indexOf(note) + 1}</div>
                  <div class="note-card-preview">${this.getPreview(note.content)}</div>
                  ${statusBadge}
                </div>
                <button class="note-card-share" data-share-note="${note.id}" title="Post to Bluesky">🦋</button>
                <button class="note-card-delete" data-delete-note="${note.id}">×</button>
              </div>
            `;
          }).join('')}
        </div>
      `;
    };

    // LEFT SIDEBAR: Show ALL notes (draft/scheduled/published/failed)
    const allFilteredNotes = [...groups.draft, ...groups.scheduled, ...groups.published, ...groups.failed];
    container.innerHTML = renderSection(allFilteredNotes, '');

    // RIGHT PANEL: Show status dashboard with published/failed only (scheduled is in left sidebar)
    this.renderPostSummary(groups.published, groups.failed);
  }

  renderPostSummary(publishedNotes, failedNotes) {
    const publishedContainer = document.getElementById('published-posts-container');
    const failedContainer = document.getElementById('failed-posts-container');

    // Render failed posts FIRST - clickable to select from left
    if (failedNotes && failedNotes.length > 0) {
      failedContainer.innerHTML = `
        <div style="margin-bottom: 1.5rem;">
          <h4 style="font-size: 0.9rem; font-weight: 600; margin-bottom: 0.5rem; color: #dc2626;">❌ Failed (${failedNotes.length})</h4>
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            ${failedNotes.map(note => {
              const failureText = note.failureReason || 'Unknown error';
              return `
                <div class="failed-post-item" data-note-id="${note.id}" style="padding: 0.75rem; background: #fef2f2; border-left: 3px solid #dc2626; border-radius: 4px; font-size: 0.85rem; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='#fee2e2';" onmouseout="this.style.background='#fef2f2';" title="${failureText}">
                  <div style="font-weight: 500; color: #1f2937; margin-bottom: 0.25rem;">Post #${this.allNotes.indexOf(note) + 1}</div>
                  <div style="color: #dc2626; font-size: 0.75rem;">Error: ${failureText.substring(0, 50)}${failureText.length > 50 ? '...' : ''}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
      
      // Add click handlers to select note from left
      failedContainer.querySelectorAll('.failed-post-item').forEach(item => {
        item.addEventListener('click', (e) => {
          const noteId = item.dataset.noteId;
          const note = this.allNotes.find(n => n.id === noteId);
          if (note) {
            this.selectNote(note);
          }
        });
      });
    } else {
      failedContainer.innerHTML = '';
    }

    // Render published posts - clickable to select from left
    if (publishedNotes && publishedNotes.length > 0) {
      publishedContainer.innerHTML = `
        <div style="margin-bottom: 1.5rem;">
          <h4 style="font-size: 0.9rem; font-weight: 600; margin-bottom: 0.5rem; color: #15803d;">✨ Published (${publishedNotes.length})</h4>
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            ${publishedNotes.map(note => {
              const postHistory = note.postHistory && note.postHistory.length > 0 
                ? note.postHistory 
                : (note.postedAt ? [note.postedAt] : []);
              
              const historyText = postHistory.map(timestamp => {
                return this.formatTimeAgo(Date.now() - timestamp);
              }).join(', ');
              
              const postCount = postHistory.length;
              const countText = postCount > 1 ? `Posted ${postCount} times: ${historyText}` : `Posted ${historyText}`;
              
              return `
                <div class="published-post-item" data-note-id="${note.id}" style="padding: 0.75rem; background: #f0fdf4; border-left: 3px solid #15803d; border-radius: 4px; font-size: 0.85rem; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='#dcfce7';" onmouseout="this.style.background='#f0fdf4';">
                  <div style="font-weight: 500; color: #1f2937; margin-bottom: 0.25rem;">${note.title}</div>
                  <div style="color: #6b7280; font-size: 0.8rem;">${countText}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
      
      // Add click handlers to select note from left
      publishedContainer.querySelectorAll('.published-post-item').forEach(item => {
        item.addEventListener('click', (e) => {
          const noteId = item.dataset.noteId;
          const note = this.allNotes.find(n => n.id === noteId);
          if (note) {
            this.selectNote(note);
          }
        });
      });
    } else {
      publishedContainer.innerHTML = '';
    }
  }

  formatTimeUntil(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return 'now';
  }

  formatTimeAgo(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
  }

  htmlToBlueskyMarkdown(html) {
    // Convert HTML to Bluesky-compatible markdown
    let text = html;
    
    // Convert <strong> and <b> to **text**
    text = text.replace(/<strong>(.*?)<\/strong>/g, '**$1**');
    text = text.replace(/<b>(.*?)<\/b>/g, '**$1**');
    
    // Convert <em> and <i> to _text_
    text = text.replace(/<em>(.*?)<\/em>/g, '_$1_');
    text = text.replace(/<i>(.*?)<\/i>/g, '_$1_');
    
    // Remove <u> tags (underline not supported)
    text = text.replace(/<u>(.*?)<\/u>/g, '$1');
    
    // Convert <br> to newlines
    text = text.replace(/<br\s*\/?>/g, '\n');
    
    // Remove all other HTML tags
    text = text.replace(/<[^>]*>/g, '');
    
    // Decode HTML entities
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    text = textarea.value;
    
    return text.trim();
  }

  getPreview(content) {
    const temp = document.createElement('div');
    temp.innerHTML = content;
    const text = temp.textContent || temp.innerText;
    return text.substring(0, 50) + (text.length > 50 ? '...' : '');
  }

  showScheduleModal() {
    const modal = document.getElementById('schedule-modal');
    const dateTimeInput = document.getElementById('schedule-datetime');
    
    // Set minimum to now + 1 minute
    const now = new Date();
    now.setMinutes(now.getMinutes() + 1);
    
    // Format for datetime-local: YYYY-MM-DDTHH:mm
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const datetimeValue = `${year}-${month}-${day}T${hours}:${minutes}`;
    
    dateTimeInput.min = datetimeValue;
    dateTimeInput.value = datetimeValue;
    
    modal.classList.add('visible');
    dateTimeInput.focus();
  }


  hideScheduleModal() {
    document.getElementById('schedule-modal').classList.remove('visible');
  }

  showProModal(featureName, featureDescription) {
    // Show the pro upgrade modal
    if (window.renderProModal) {
      window.renderProModal();
    }
    const modal = document.getElementById('pro-modal');
    if (modal) {
      modal.classList.add('active');
    }
  }

  showConfirmModal(title, message) {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      `;
      
      modal.innerHTML = `
        <div style="background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); max-width: 400px; text-align: center;">
          <h2 style="color: #333; margin-top: 0; margin-bottom: 1rem; font-size: 1.25rem;">${title}</h2>
          <p style="color: #666; margin-bottom: 1.5rem; line-height: 1.5;">${message}</p>
          <div style="display: flex; gap: 1rem; justify-content: center;">
            <button id="confirm-cancel" style="padding: 0.75rem 1.5rem; background: #e5e7eb; color: #333; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">Cancel</button>
            <button id="confirm-ok" style="padding: 0.75rem 1.5rem; background: #dc2626; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">Delete All</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
      
      document.getElementById('confirm-cancel').addEventListener('click', () => {
        modal.remove();
        resolve(false);
      });
      
      document.getElementById('confirm-ok').addEventListener('click', () => {
        modal.remove();
        resolve(true);
      });
      
      // Close on Escape key
      const escapeHandler = (e) => {
        if (e.key === 'Escape') {
          document.removeEventListener('keydown', escapeHandler);
          modal.remove();
          resolve(false);
        }
      };
      document.addEventListener('keydown', escapeHandler);
    });
  }

  showMessage(message, type = 'info') {
    // Get or create message container
    let container = document.getElementById('message-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'message-container';
      container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10001;
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 350px;
      `;
      document.body.appendChild(container);
    }
    
    // Create message element
    const msgEl = document.createElement('div');
    
    // Color based on type
    let bgColor = '#e3f2fd';
    let textColor = '#1976d2';
    let borderColor = '#1976d2';
    
    if (type === 'success') {
      bgColor = '#f1f8e9';
      textColor = '#558b2f';
      borderColor = '#558b2f';
    } else if (type === 'error') {
      bgColor = '#ffebee';
      textColor = '#c62828';
      borderColor = '#c62828';
    } else if (type === 'warning') {
      bgColor = '#fff3e0';
      textColor = '#e65100';
      borderColor = '#e65100';
    }
    
    msgEl.style.cssText = `
      background: ${bgColor};
      color: ${textColor};
      padding: 12px 16px;
      border-radius: 4px;
      border-left: 4px solid ${borderColor};
      animation: slideIn 0.3s ease-out;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    `;
    msgEl.textContent = message;
    
    container.appendChild(msgEl);
    
    // Auto remove after 4 seconds
    setTimeout(() => {
      msgEl.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => msgEl.remove(), 300);
    }, 4000);
  }

  updateNoteCard(noteId) {
    const note = this.allNotes.find(n => n.id === noteId);
    if (note) {
      const card = document.getElementById(`note-${noteId}`);
      if (card) {
        card.style.backgroundColor = note.color;
      }
    }
  }

  deleteNote(noteId) {
    if (!confirm('Delete this note?')) return;
    
    this.allNotes = this.allNotes.filter(n => n.id !== noteId);
    
    if (this.currentNote?.id === noteId) {
      this.currentNote = null;
      document.getElementById('note-title').value = '';
      document.getElementById('editor-content').innerHTML = '';
      this.updatePlaceholder();
    }

    this.db.deleteNote(noteId);
    this.renderNotesList();
    
    // Select first if exists
    if (this.allNotes.length > 0) {
      this.selectNote(this.allNotes[0]);
    }
  }

  updateFilterButtons() {
    // Update color filter buttons
    document.querySelectorAll('.color-filter-btn').forEach(btn => {
      const btnFilter = btn.getAttribute('data-filter');
      if (btnFilter === this.currentFilter) {
        btn.style.borderColor = '#1f2937';
        btn.style.boxShadow = '0 0 0 2px white, 0 0 0 4px #1f2937';
      } else {
        btn.style.borderColor = 'transparent';
        btn.style.boxShadow = 'none';
      }
    });

    // Update type filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      const btnFilter = btn.getAttribute('data-filter');
      if (btnFilter === this.currentFilter) {
        btn.style.background = '#00a8e8';
        btn.style.color = 'white';
      } else {
        btn.style.background = '#e5e7eb';
        btn.style.color = '#1f2937';
      }
    });
  }

  async scheduleCurrentNote() {
    if (!this.currentNote) return;

    const datetimeStr = document.getElementById('schedule-datetime').value;
    if (!datetimeStr) {
      alert('Please select a date and time');
      return;
    }

    try {
      // Parse datetime-local string (YYYY-MM-DDTHH:mm) as LOCAL time, not UTC
      const [date, time] = datetimeStr.split('T');
      const [year, month, day] = date.split('-').map(Number);
      const [hours, minutes] = time.split(':').map(Number);
      
      // Create date in LOCAL timezone
      const scheduledTime = new Date(year, month - 1, day, hours, minutes, 0, 0);
      const scheduledFor = scheduledTime.getTime();
      
      
      // Save current note content with scheduled status
      this.currentNote.title = document.getElementById('note-title').value || 'Untitled Post';
      const editor = document.getElementById('editor-content');
      this.currentNote.content = editor.innerHTML || editor.value || '';
      this.currentNote.status = 'scheduled';
      this.currentNote.scheduledFor = scheduledFor;

      // If there's no customLinkPreview but there's a URL in the content, fetch it now
      if (!this.currentNote.customLinkPreview) {
        const { url } = this.detectLinks(this.currentNote.content);
        if (url) {
          const ogData = await this.fetchOGData(url);
          if (ogData) {
            this.currentNote.customLinkPreview = {
              url,
              title: ogData.title || '',
              description: ogData.description || '',
              image: ogData.image
            };
          }
        }
      }

      await this.db.saveNote(this.currentNote);

      this.hideScheduleModal();
      
      // Reload all notes from storage to ensure consistency
      this.allNotes = await this.db.getAllNotes();
      
      await this.renderNotesList();
      alert('Post scheduled for ' + new Date(scheduledFor).toLocaleString());

    } catch (error) {
      console.error('[Schedule] Error scheduling note:', error);
      alert('Error scheduling post: ' + error.message);
    }
  }

  async renderAnalytics() {
    const analyticsView = document.getElementById('analytics-view');
    
    // Get published posts with URIs
    const publishedPosts = this.allNotes.filter(n => n.status === 'published' && n.postUri);
    
    if (publishedPosts.length === 0) {
      analyticsView.innerHTML = `
        <div style="padding: 2rem; text-align: center; color: #6b7280;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">📊</div>
          <p>No published posts yet. Post to Bluesky to see analytics!</p>
        </div>
      `;
      return;
    }
    
    analyticsView.innerHTML = `<div style="padding: 1rem;"><p>Loading analytics...</p></div>`;
    
    // Fetch stats for each published post
    let html = '<div style="display: flex; flex-direction: column; gap: 1rem;">';
    
    for (const post of publishedPosts) {
      // Call fetchPostAnalytics on the bluesky instance
      const stats = window.bluesky ? await window.bluesky.fetchPostAnalytics(post.postUri) : null;
      
      if (stats) {
        const daysSincePub = Math.floor((Date.now() - post.postedAt) / (1000 * 60 * 60 * 24));
        html += `
          <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; background: white;">
            <div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 0.5rem; color: #333;">${post.title}</div>
            <div style="font-size: 0.85rem; color: #6b7280; margin-bottom: 1rem;">${daysSincePub}d ago</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 1rem;">
              <div style="text-align: center; padding: 0.75rem; background: #f3f4f6; border-radius: 6px;">
                <div style="font-size: 1.5rem; font-weight: 700; color: #0284c7;">${stats.likes}</div>
                <div style="font-size: 0.75rem; color: #6b7280;">Likes</div>
              </div>
              <div style="text-align: center; padding: 0.75rem; background: #f3f4f6; border-radius: 6px;">
                <div style="font-size: 1.5rem; font-weight: 700; color: #06b6d4;">${stats.reposts}</div>
                <div style="font-size: 0.75rem; color: #6b7280;">Reposts</div>
              </div>
              <div style="text-align: center; padding: 0.75rem; background: #f3f4f6; border-radius: 6px;">
                <div style="font-size: 1.5rem; font-weight: 700; color: #8b5cf6;">${stats.replies}</div>
                <div style="font-size: 0.75rem; color: #6b7280;">Replies</div>
              </div>
              <div style="text-align: center; padding: 0.75rem; background: #f3f4f6; border-radius: 6px;">
                <div style="font-size: 1.5rem; font-weight: 700; color: #ec4899;">${stats.quotes}</div>
                <div style="font-size: 0.75rem; color: #6b7280;">Quotes</div>
              </div>
            </div>
          </div>
        `;
      }
    }
    
    html += '</div>';
    analyticsView.innerHTML = html;
  }

  async renderLists() {
    const listsView = document.getElementById('lists-view');
    
    // Show loading state
    listsView.innerHTML = `<div style="padding: 1rem;"><p>Loading lists...</p></div>`;
    
    // Fetch lists this user created
    const myLists = window.bluesky ? await window.bluesky.fetchUserLists() : null;
    
    if (!myLists || myLists.length === 0) {
      listsView.innerHTML = `
        <div style="padding: 2rem; text-align: center; color: #6b7280;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">📋</div>
          <p>No lists created. Create a list on Bluesky to see it here!</p>
        </div>
      `;
      return;
    }
    
    let html = '<div style="display: flex; flex-direction: column; gap: 1rem;">';
    
    // My Lists section
    for (const list of myLists) {
      const url = `https://bsky.app/profile/${list.creator}/lists/${list.uri.split('/').pop()}`;
      
      html += `
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; background: white;">
          <div style="display: flex; align-items: flex-start; justify-content: space-between;">
            <div style="flex: 1;">
              <div style="font-weight: 600; color: #333; margin-bottom: 0.25rem;">${list.name}</div>
              ${list.description ? `<div style="font-size: 0.85rem; color: #6b7280; margin-bottom: 0.5rem;">${list.description}</div>` : ''}
              <div style="font-size: 0.8rem; color: #9ca3af;">👥 ${list.listItemCount} member${list.listItemCount !== 1 ? 's' : ''}</div>
            </div>
            <a href="${url}" target="_blank" style="margin-left: 1rem; padding: 0.5rem 1rem; background: #0284c7; color: white; border-radius: 6px; text-decoration: none; font-size: 0.85rem; white-space: nowrap;">View</a>
          </div>
        </div>
      `;
    }
    
    html += '</div>';
    listsView.innerHTML = html;
  }

  detectLinks(text) {
    // Match URLs with or without http/https prefix
    // Supports: https://example.com, http://example.com, example.com, www.example.com
    const urlRegex = /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9][a-zA-Z0-9-]*(?:\.[a-zA-Z]{2,})+(?:\/[^\s]*)?/g;
    const match = urlRegex.exec(text);
    
    if (!match) return { cleanText: text, url: null };
    
    let url = match[0];
    
    // Add https:// if no protocol specified
    if (!url.match(/^https?:\/\//)) {
      url = 'https://' + url;
    }
    
    // Remove URL from text and trim extra whitespace
    const originalUrl = match[0];
    const cleanText = text.substring(0, match.index) + text.substring(match.index + originalUrl.length);
    
    return { cleanText: cleanText.trim(), url };
  }

  async fetchOGData(url) {
    try {
      console.log('[fetchOGData] Starting for URL:', url);
      // Check if it's a YouTube link - use oEmbed API instead of OG scraping
      const youtubeMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (youtubeMatch) {
        const videoId = youtubeMatch[1];
        console.log('[fetchOGData] YouTube video detected:', videoId);
        
        try {
          // Use YouTube oEmbed API (no authentication needed)
          const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
          const oembedResponse = await fetch(oembedUrl);
          
          if (oembedResponse.ok) {
            const oembedData = await oembedResponse.json();
            console.log('[fetchOGData] YouTube oembed data:', oembedData);
            
            return {
              title: (oembedData.title || 'Video').substring(0, 100),
              description: (oembedData.author_name || 'YouTube').substring(0, 256),
              image: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
            };
          }
        } catch (e) {
          console.warn('[fetchOGData] YouTube oembed failed, using fallback:', e.message);
          // Fall back to constructed thumbnail
          return {
            title: 'Video'.substring(0, 100),
            description: 'YouTube'.substring(0, 256),
            image: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
          };
        }
      }

      // For non-YouTube links, use OG tag extraction via proxy
      const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(url);
      console.log('[fetchOGData] Using proxy:', proxyUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeout);
      
      console.log('[fetchOGData] Proxy response status:', response.status);
      if (!response.ok) {
        console.warn('[fetchOGData] Proxy returned non-OK status:', response.status);
        return null;
      }
      
      const html = await response.text();
      console.log('[fetchOGData] HTML fetched, length:', html.length);
      
      // Simple extraction - allow any chars between property and content
      const extractMeta = (property) => {
        // Allow anything between property/name and content
        const pattern1 = new RegExp(`og:${property}[^>]*content=["\']([^"']+)["\']`, 'i');
        let match = html.match(pattern1);
        if (match && match[1]) {
          console.log(`[fetchOGData] Found og:${property} via pattern1:`, match[1].substring(0, 50));
          return match[1];
        }
        
        const pattern2 = new RegExp(`content=["\']([^"']+)["\'][^>]*property=["\']og:${property}["\']`, 'i');
        match = html.match(pattern2);
        if (match && match[1]) {
          console.log(`[fetchOGData] Found og:${property} via pattern2:`, match[1].substring(0, 50));
          return match[1];
        }
        
        // Try without og: prefix (for name attribute)
        const pattern3 = new RegExp(`name=["\']${property}["\'][^>]*content=["\']([^"']+)["\']`, 'i');
        match = html.match(pattern3);
        if (match && match[1]) {
          console.log(`[fetchOGData] Found ${property} via pattern3:`, match[1].substring(0, 50));
          return match[1];
        }
        
        return null;
      };
      
      let title = extractMeta('title');
      let description = extractMeta('description');
      let image = extractMeta('image');
      
      // Fallback to title tag only if no OG title found
      if (!title) {
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        title = titleMatch ? titleMatch[1] : '';
        console.log('[fetchOGData] Using fallback title:', title);
      }
      
      const result = { 
        title: (title || 'Link').substring(0, 100), 
        description: (description || '').substring(0, 256), 
        image 
      };
      console.log('[fetchOGData] Final result:', result);
      return result;
    } catch (error) {
      console.error('[fetchOGData] Error:', error.message);
      return null;
    }
  }

  async detectAndShowEditorLinkPreview(text) {
    if (!this.currentNote) return;
    
    const { url } = this.detectLinks(text);
    
    if (!url) {
      // No URL found, hide link preview
      if (this.currentNote.customLinkPreview) {
        this.updateAttachmentsDisplay();
      }
      return;
    }
    
    // Check if already have a preview for this URL
    if (this.currentNote.customLinkPreview && this.currentNote.customLinkPreview.url === url) {
      // Already have a preview for this URL
      return;
    }
    
    // Fetch OG data for the URL
    try {
      console.log('[Editor] Fetching preview for URL:', url);
      let ogData;
      if (window.bluesky && window.bluesky.fetchOGData) {
        ogData = await window.bluesky.fetchOGData(url);
      } else {
        ogData = await this.fetchOGData(url);
      }
      
      console.log('[Editor] OG data received:', ogData);
      
      if (ogData) {
        // Store in customLinkPreview and update display
        this.currentNote.customLinkPreview = {
          url,
          title: ogData.title || '',
          description: ogData.description || '',
          image: ogData.image
        };
        console.log('[Editor] Updated customLinkPreview:', this.currentNote.customLinkPreview);
        this.updateAttachmentsDisplay();
      } else {
        console.warn('[Editor] No OG data returned for URL:', url);
      }
    } catch (error) {
      console.error('[Editor] Error fetching preview:', error);
    }
  }

  displayEditorLinkPreview(url, ogData, previewEl) {
    // Create a note if one doesn't exist
    if (!this.currentNote) {
      const newNote = {
        id: Date.now().toString(),
        title: 'New Post',
        content: '',
        color: '#ffffff',
        status: 'draft',
        scheduledFor: null,
        postedAt: null,
        postUri: null,
        analytics: null,
        failureReason: null,
        createdAt: Date.now(),
        imageData: [],
        customLinkPreview: null,
        videoData: null,
      };
      this.currentNote = newNote;
    }
    
    this.currentNote.customLinkPreview = {
      url,
      title: ogData?.title || '',
      description: ogData?.description || '',
      image: ogData?.image
    };

    // Update the unified attachments display
    this.updateAttachmentsDisplay();
    
    // Store for edit functionality
    this._currentOgData = ogData;
  }

  togglePreviewEdit(previewEl, ogData) {
    const isEditing = previewEl.querySelector('input[data-field="title"]');
    
    if (isEditing) {
      // Save mode - save the edits
      const titleInput = previewEl.querySelector('input[data-field="title"]');
      const descInput = previewEl.querySelector('textarea[data-field="desc"]');
      
      if (this.currentNote && this.currentNote.customLinkPreview) {
        this.currentNote.customLinkPreview.title = titleInput.value;
        this.currentNote.customLinkPreview.description = descInput.value;
        // Make sure URL is preserved
        if (!this.currentNote.customLinkPreview.url) {
          console.warn('[Workspace] WARNING: customLinkPreview missing URL');
        }
      }
      
      // Persist changes to database
      this.db.saveNote(this.currentNote);
      
      // Update display
      this.updateAttachmentsDisplay();
    } else {
      // Edit mode - show input fields in the attachments panel
      const linkPreviewDiv = document.getElementById('editor-link-preview');
      if (linkPreviewDiv) {
        const content = document.getElementById('editor-link-preview-content');
        if (content) {
          let html = '';
          if (ogData.image) {
            html += `<img src="${ogData.image}" style="max-width: 100%; max-height: 100px; border-radius: 4px; margin-bottom: 0.5rem;">`;
          }
          html += `<input type="text" data-field="title" value="${ogData.title || ''}" style="width: 100%; padding: 0.4rem; margin-bottom: 0.5rem; border: 1px solid #ccc; border-radius: 4px; background: white; color: #1f2937;">`;
          html += `<textarea data-field="desc" style="width: 100%; padding: 0.4rem; margin-bottom: 0.5rem; border: 1px solid #ccc; border-radius: 4px; min-height: 60px; font-size: 0.8rem; background: white; color: #1f2937;">${ogData.description || ''}</textarea>`;
          html += `<div style="display: flex; gap: 0.5rem;">`;
          html += `<button id="editor-link-save-btn" style="flex: 1; padding: 0.4rem 0.8rem; background: #10b981; color: white; border: none; border-radius: 4px; font-size: 0.8rem; cursor: pointer;">✅ Save</button>`;
          html += `<button id="editor-link-cancel-btn" style="flex: 1; padding: 0.4rem 0.8rem; background: #6b7280; color: white; border: none; border-radius: 4px; font-size: 0.8rem; cursor: pointer;">Cancel</button>`;
          html += `</div>`;
          content.innerHTML = html;
          
          // Add button listeners
          document.getElementById('editor-link-save-btn').addEventListener('click', () => {
            const titleInput = content.querySelector('input[data-field="title"]');
            const descInput = content.querySelector('textarea[data-field="desc"]');
            
            if (this.currentNote && this.currentNote.customLinkPreview) {
              this.currentNote.customLinkPreview.title = titleInput.value;
              this.currentNote.customLinkPreview.description = descInput.value;
            }
            
            this.db.saveNote(this.currentNote);
            this.updateAttachmentsDisplay();
          });
          
          document.getElementById('editor-link-cancel-btn').addEventListener('click', () => {
            this.updateAttachmentsDisplay();
          });
        }
      }
    }
  }

  setupProStorageDashboard() {
    console.log('[Pro Storage] setupProStorageDashboard() called');
    console.log('[Pro Storage] this.allNotes:', this.allNotes?.length || 0, 'notes');
    
    // Calculate total storage used by all notes
    let totalBytes = 0;
    
    if (this.allNotes && Array.isArray(this.allNotes)) {
      for (const note of this.allNotes) {
        // Count note content
        if (note.content) {
          totalBytes += new Blob([note.content]).size;
        }
        
        // Count all image data (imageData is an array of base64 strings)
        if (note.imageData && Array.isArray(note.imageData)) {
          for (const imageData of note.imageData) {
            if (imageData) {
              totalBytes += new Blob([imageData]).size;
            }
          }
          console.log('[Pro Storage] Note', note.id, 'has', note.imageData.length, 'images');
        }
        
        // Fallback: count old single image format if present
        if (note.image && !note.imageData) {
          totalBytes += new Blob([note.image]).size;
        }
        
        // Count video data if present
        if (note.videoData) {
          totalBytes += new Blob([note.videoData]).size;
        }
        
        // Count link preview if present
        if (note.customLinkPreview) {
          totalBytes += new Blob([JSON.stringify(note.customLinkPreview)]).size;
        }
      }
    }
    
    // Convert bytes to MB
    const usedMB = (totalBytes / (1024 * 1024)).toFixed(2);
    
    // Default pro quota is 50MB
    const quotaMB = 50;
    const percentageUsed = Math.min((totalBytes / (quotaMB * 1024 * 1024)) * 100, 100);
    
    // Update dashboard elements
    const dashboardDiv = document.getElementById('pro-storage-dashboard');
    const progressBar = document.getElementById('pro-storage-bar');
    const statsDiv = document.getElementById('pro-storage-stats');
    
    console.log('[Pro Storage] Total bytes calculated:', totalBytes, 'bytes');
    console.log('[Pro Storage] Found dashboard div:', !!dashboardDiv);
    console.log('[Pro Storage] Found progress bar:', !!progressBar);
    console.log('[Pro Storage] Found stats div:', !!statsDiv);
    
    if (dashboardDiv) {
      dashboardDiv.hidden = false;
      console.log('[Pro Storage] ✅ Dashboard unhidden');
    }
    
    if (progressBar) {
      progressBar.style.width = percentageUsed + '%';
      console.log('[Pro Storage] ✅ Progress bar width set to:', percentageUsed + '%');
    }
    
    if (statsDiv) {
      statsDiv.textContent = `${usedMB}MB / ${quotaMB}MB used`;
      console.log('[Pro Storage] ✅ Stats text set to:', `${usedMB}MB / ${quotaMB}MB used`);
    }
    
    console.log(`[Pro Storage] ✅ Dashboard complete: ${usedMB}MB / ${quotaMB}MB used (${percentageUsed.toFixed(1)}%)`);
    
    // Add click handler to request more storage button
    const requestBtn = document.getElementById('pro-request-storage-btn');
    if (requestBtn) {
      requestBtn.addEventListener('click', async () => {
        try {
          if (navigator.storage && navigator.storage.persist) {
            const isPersistent = await navigator.storage.persist();
            if (isPersistent) {
              alert('✅ Persistent storage enabled! Your notes are now saved permanently.');
            } else {
              alert('Storage request was not granted. Please check your browser settings.');
            }
          } else {
            alert('Persistent storage API not available in this browser.');
          }
        } catch (err) {
          console.error('[Pro Storage] Error requesting persistent storage:', err);
          alert('Error requesting storage: ' + err.message);
        }
      });
    }
  }
}

// Bluesky Integration - handles login, posting, and session management
class BlueskyIntegration {
  constructor() {
    this.pdsUrl = 'https://bsky.social';
    this.session = null;
    this.pendingImageData = null;
    this.pendingLinkUrl = null;
    this.customLinkPreview = null; // For Pro feature: custom link preview data
    this.pendingLinkPreview = null; // For preserving custom preview when transferred to composer
    this.init();
  }

  async init() {
    await this.loadSession();
    this.setupEventListeners();
    this.updateUI();
  }

  loadSession() {
    return new Promise((resolve) => {
      // Try chrome.storage.sync first (for background service worker compatibility)
      if (chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(['blueskySession'], (result) => {
          if (result.blueskySession) {
            this.session = result.blueskySession;
            resolve(this.session);
            return;
          }

          // If not in sync storage, try local storage
          if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['blueskySession'], (result) => {
              if (result.blueskySession) {
                this.session = result.blueskySession;
                resolve(this.session);
                return;
              }

              // If not in chrome.storage, try localStorage
              try {
                const sessionStr = localStorage.getItem('blueskySession');
                if (sessionStr) {
                  this.session = JSON.parse(sessionStr);
                  resolve(this.session);
                  return;
                }
              } catch (error) {
                console.warn('[Bluesky] localStorage error:', error);
              }

              resolve(null);
            });
          } else {
            // If no local storage, try localStorage
            try {
              const sessionStr = localStorage.getItem('blueskySession');
              if (sessionStr) {
                this.session = JSON.parse(sessionStr);
              }
            } catch (error) {
              console.warn('[Bluesky] localStorage error:', error);
            }
            resolve(this.session || null);
          }
        });
      } else if (chrome.storage && chrome.storage.local) {
        // Fallback if sync not available
        chrome.storage.local.get(['blueskySession'], (result) => {
          if (result.blueskySession) {
            this.session = result.blueskySession;
            resolve(this.session);
            return;
          }

          // If not in chrome.storage, try localStorage
          try {
            const sessionStr = localStorage.getItem('blueskySession');
            if (sessionStr) {
              this.session = JSON.parse(sessionStr);
              resolve(this.session);
              return;
            }
          } catch (error) {
            console.warn('[Bluesky] localStorage error:', error);
          }

          resolve(null);
        });
      } else {
        // If chrome.storage not available, use localStorage
        try {
          const sessionStr = localStorage.getItem('blueskySession');
          if (sessionStr) {
            this.session = JSON.parse(sessionStr);
          }
        } catch (error) {
          console.warn('[Bluesky] localStorage error:', error);
        }
        resolve(this.session || null);
      }
    });
  }

  setupEventListeners() {
    const loginForm = document.getElementById('bluesky-login-form');
    const composerForm = document.getElementById('bluesky-composer-form');
    const textarea = document.getElementById('bsky-textarea');
    const logoutBtn = document.getElementById('bsky-logout-btn');
    const removeImageBtn = document.getElementById('bsky-remove-image-btn');

    if (loginForm) {
      loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    }

    if (composerForm) {
      composerForm.addEventListener('submit', (e) => this.handlePost(e));
    }

    if (textarea) {
      textarea.addEventListener('input', () => {
        document.getElementById('bsky-char-count').textContent = textarea.value.length;
        const remaining = 300 - textarea.value.length;
        const countEl = document.getElementById('bsky-char-count').parentElement;
        countEl.classList.toggle('warning', remaining < 50 && remaining >= 0);
        countEl.classList.toggle('error', remaining < 0);
        
        // Real-time link detection
        this.detectAndShowLinkPreview(textarea.value);
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        if (confirm('Logout from Bluesky?')) {
          chrome.storage.local.remove('blueskySession');
          this.session = null;
          this.updateUI();
        }
      });
    }

    if (removeImageBtn) {
      removeImageBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.pendingImageData = null;
        const preview = document.getElementById('bsky-image-preview');
        if (preview) preview.style.display = 'none';
      });
    }

    // Link preview modal handlers (Pro feature)
    const linkEditBtn = document.getElementById('link-preview-edit-btn');
    const linkSaveBtn = document.getElementById('link-preview-save-btn');
    const linkCancelBtn = document.getElementById('link-preview-cancel-btn');
    const linkModal = document.getElementById('link-preview-modal');

    if (linkEditBtn) {
      linkEditBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!window.licenseManager.canUseFeature('advancedPreviews')) {
          this.showMessage('Upgrade to Pro to edit link previews', 'info');
          window.renderProModal();
          document.getElementById('pro-modal').classList.add('active');
          return;
        }
        // Pass the current customLinkPreview or fetch it if needed
        this.openLinkPreviewModal(null, this.customLinkPreview);
      });
    }

    if (linkSaveBtn) {
      linkSaveBtn.addEventListener('click', () => this.saveLinkPreview());
    }

    if (linkCancelBtn) {
      linkCancelBtn.addEventListener('click', () => {
        if (linkModal) linkModal.style.display = 'none';
      });
    }

    if (linkModal) {
      linkModal.addEventListener('click', (e) => {
        // Only close if clicking the exact background, not the modal content
        if (e.target === linkModal) {
          linkModal.style.display = 'none';
        }
      });
      
      // Close on Escape key
      linkModal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          linkModal.style.display = 'none';
        }
      });
    }
  }

  updateUI() {
    const loginContainer = document.getElementById('bluesky-login-container');
    const composerContainer = document.getElementById('bluesky-composer-container');

    if (this.session) {
      loginContainer.style.display = 'none';
      composerContainer.style.display = 'block';
      
      const avatarElement = document.getElementById('bsky-avatar');
      
      // If we have a profile picture URL, display it as an image
      if (this.session.avatar) {
        avatarElement.innerHTML = `<img src="${this.session.avatar}" alt="Profile" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
      } else {
        // Otherwise, show initials
        const initials = this.session.handle.charAt(0).toUpperCase();
        avatarElement.textContent = initials;
      }
      
      document.getElementById('bsky-handle').textContent = `@${this.session.handle}`;
      document.getElementById('bsky-textarea').value = '';
      document.getElementById('bsky-char-count').textContent = '0';
      
      // Clear image and link previews
      const imagePreview = document.getElementById('bsky-image-preview');
      if (imagePreview) {
        imagePreview.style.display = 'none';
      }
      const linkPreview = document.getElementById('bsky-link-preview');
      if (linkPreview) {
        linkPreview.style.display = 'none';
      }
    } else {
      loginContainer.style.display = 'block';
      composerContainer.style.display = 'none';
    }
  }

  async handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('bsky-username').value;
    const password = document.getElementById('bsky-password').value;

    try {
      const response = await fetch(`${this.pdsUrl}/xrpc/com.atproto.server.createSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: username, password })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Login failed');
      }

      const data = await response.json();
      const sessionData = {
        accessJwt: data.accessJwt,
        refreshJwt: data.refreshJwt,
        did: data.did,
        handle: data.handle,
        timestamp: Date.now()
      };

      // Save to both chrome.storage.sync and chrome.storage.local
      try {
        chrome.storage.sync.set({ blueskySession: sessionData });
      } catch (error) {
        console.warn('[Bluesky] chrome.storage.sync failed:', error);
      }

      try {
        chrome.storage.local.set({ blueskySession: sessionData });
      } catch (error) {
        console.warn('[Bluesky] chrome.storage.local failed:', error);
      }

      try {
        localStorage.setItem('blueskySession', JSON.stringify(sessionData));
      } catch (error) {
        console.warn('[Bluesky] localStorage failed:', error);
      }

      this.session = sessionData;

      // Fetch user profile to get avatar
      try {
        const profileResponse = await fetch(`${this.pdsUrl}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(data.did)}`, {
          headers: { Authorization: `Bearer ${data.accessJwt}` }
        });
        if (profileResponse.ok) {
          const profileData = await profileResponse.json();
          if (profileData.avatar) {
            this.session.avatar = profileData.avatar;
          }
        }
      } catch (err) {
        console.warn('[Bluesky] Failed to fetch profile picture:', err);
      }

      // Save updated session with avatar
      try {
        chrome.storage.sync.set({ blueskySession: this.session });
        chrome.storage.local.set({ blueskySession: this.session });
        localStorage.setItem('blueskySession', JSON.stringify(this.session));
      } catch (error) {
        console.warn('[Bluesky] Failed to save session with avatar:', error);
      }

      this.showMessage('✅ Logged in!', 'success');
      this.updateUI();
    } catch (error) {
      this.showMessage(`❌ ${error.message}`, 'error');
    }
  }

  detectLinks(text) {
    // Match URLs with or without http/https prefix
    // Supports: https://example.com, http://example.com, example.com, www.example.com
    const urlRegex = /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9][a-zA-Z0-9-]*(?:\.[a-zA-Z]{2,})+(?:\/[^\s]*)?/g;
    const match = urlRegex.exec(text);
    
    if (!match) return { cleanText: text, url: null };
    
    let url = match[0];
    
    // Add https:// if no protocol specified
    if (!url.match(/^https?:\/\//)) {
      url = 'https://' + url;
    }
    
    // Remove URL from text and trim extra whitespace
    const originalUrl = match[0];
    const cleanText = text.substring(0, match.index) + text.substring(match.index + originalUrl.length);
    
    return { cleanText: cleanText.trim(), url };
  }

  async createLinkEmbed(url, ogData) {
    // This is handled on the background worker side for Bluesky API compatibility
    return { url, ...ogData };
  }

  async detectAndShowLinkPreview(text) {
    const preview = document.getElementById('bsky-link-preview');
    if (!preview) return;
    
    const { url } = this.detectLinks(text);
    
    console.log('[detectAndShowLinkPreview] text:', text);
    console.log('[detectAndShowLinkPreview] detected url:', url);
    console.log('[detectAndShowLinkPreview] pendingLinkPreview:', this.pendingLinkPreview);
    
    // If we have a pending custom preview, use it (even if URL isn't in text anymore)
    if (this.pendingLinkPreview) {
      console.log('[detectAndShowLinkPreview] Using pendingLinkPreview');
      let html = '<div style="background: white; border-radius: 6px; padding: 0.5rem; border: 1px solid #ddd;">';
      if (this.pendingLinkPreview.image) {
        html += `<img src="${this.pendingLinkPreview.image}" style="max-width: 100%; max-height: 80px; border-radius: 4px; margin-bottom: 0.5rem; display: block;">`;
      }
      html += `<div style="font-weight: 600; font-size: 0.85rem; color: #333; margin-bottom: 0.25rem;">${this.pendingLinkPreview.title || 'Link'}</div>`;
      html += `<div style="font-size: 0.75rem; color: #666; line-height: 1.3;">${this.pendingLinkPreview.description || ''}</div>`;
      html += '</div>';
      preview.innerHTML = html;
      preview.style.display = 'block';
      // IMPORTANT: Keep pendingLinkPreview available for posting - don't clear it!
      return;
    }
    
    if (!url) {
      preview.style.display = 'none';
      return;
    }
    
    // Show loading
    preview.innerHTML = '<div style="color: #1e40af; font-size: 0.85rem; text-align: center; padding: 0.5rem;">Loading preview...</div>';
    preview.style.display = 'block';
    
    try {
      const ogData = await this.fetchOGData(url);
      if (ogData) {
        let html = '<div style="background: white; border-radius: 6px; padding: 0.5rem; border: 1px solid #ddd;">';
        if (ogData.image) {
          html += `<img src="${ogData.image}" style="max-width: 100%; max-height: 80px; border-radius: 4px; margin-bottom: 0.5rem; display: block;">`;
        }
        html += `<div style="font-weight: 600; font-size: 0.85rem; color: #333; margin-bottom: 0.25rem;">${ogData.title || 'Link'}</div>`;
        html += `<div style="font-size: 0.75rem; color: #666; line-height: 1.3;">${ogData.description || ''}</div>`;
        html += '</div>';
        preview.innerHTML = html;
        // Store the fetched data so it can be edited
        this.customLinkPreview = { ...ogData, url };
      } else {
        preview.innerHTML = '<div style="color: #6b7280; font-size: 0.85rem; text-align: center; padding: 0.5rem;">Could not load preview</div>';
      }
    } catch (error) {
      console.error('[BlueskyIntegration] Error fetching link preview:', error);
      preview.innerHTML = '<div style="color: #dc2626; font-size: 0.85rem; text-align: center; padding: 0.5rem;">Error loading preview</div>';
    }
  }

  showMessage(text, type) {
    const msgEl = document.getElementById('bluesky-message');
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.className = `bluesky-message ${type}`;
    msgEl.style.display = 'block';
    setTimeout(() => {
      msgEl.style.display = 'none';
    }, 3000);
  }

  sendToComposer(text, imageData = null, customLinkPreview = null) {
    if (!this.session) {
      this.showMessage('❌ Please login first', 'error');
      return;
    }
    const textarea = document.getElementById('bsky-textarea');
    if (!textarea) {
      console.error('[BlueskyIntegration] textarea not found');
      return;
    }
    
    console.log('[sendToComposer] Received imageData:', imageData);
    console.log('[sendToComposer] Received customLinkPreview:', customLinkPreview);
    
    textarea.value = text;
    textarea.focus();
    
    // Store custom link preview BEFORE dispatching input event so detectAndShowLinkPreview can use it
    if (customLinkPreview) {
      this.pendingLinkPreview = customLinkPreview;
      console.log('[sendToComposer] Set pendingLinkPreview:', this.pendingLinkPreview);
    } else {
      console.log('[sendToComposer] customLinkPreview is null/falsy, not setting pendingLinkPreview');
    }
    
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    
    // If image data is provided, show image preview in Bluesky
    if (imageData) {
      const previewDiv = document.getElementById('bsky-image-preview');
      if (previewDiv) {
        // Handle both single image (string) and multiple images (array)
        let imageArray = Array.isArray(imageData) ? imageData : [imageData];
        imageArray = imageArray.filter(img => img); // Remove null/undefined
        
        console.log('[sendToComposer] Processed imageArray:', imageArray);
        
        if (imageArray.length === 1) {
          previewDiv.innerHTML = `<img src="${imageArray[0]}" style="max-width: 100%; height: auto; border-radius: 4px;">`;
        } else if (imageArray.length === 2) {
          previewDiv.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
              <img src="${imageArray[0]}" style="max-width: 100%; height: 150px; object-fit: cover; border-radius: 4px;">
              <img src="${imageArray[1]}" style="max-width: 100%; height: 150px; object-fit: cover; border-radius: 4px;">
            </div>
          `;
        } else if (imageArray.length === 3) {
          previewDiv.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
              <img src="${imageArray[0]}" style="max-width: 100%; height: 150px; object-fit: cover; border-radius: 4px;">
              <div style="display: grid; grid-template-rows: 1fr 1fr; gap: 0.5rem;">
                <img src="${imageArray[1]}" style="max-width: 100%; height: 72px; object-fit: cover; border-radius: 4px;">
                <img src="${imageArray[2]}" style="max-width: 100%; height: 72px; object-fit: cover; border-radius: 4px;">
              </div>
            </div>
          `;
        } else if (imageArray.length >= 4) {
          previewDiv.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
              <img src="${imageArray[0]}" style="max-width: 100%; height: 150px; object-fit: cover; border-radius: 4px;">
              <img src="${imageArray[1]}" style="max-width: 100%; height: 150px; object-fit: cover; border-radius: 4px;">
              <img src="${imageArray[2]}" style="max-width: 100%; height: 150px; object-fit: cover; border-radius: 4px;">
              <img src="${imageArray[3]}" style="max-width: 100%; height: 150px; object-fit: cover; border-radius: 4px;">
            </div>
          `;
        }
        
        previewDiv.style.display = 'block';
        console.log('[sendToComposer] Setting pendingImageData to:', imageArray);
        this.pendingImageData = imageArray; // Store all images for posting
      }
    }
  }

  async handlePost(e) {
    e.preventDefault();
    const textarea = document.getElementById('bsky-textarea');
    const postBtn = document.querySelector('button[type="submit"]');
    
    console.log('[handlePost] Session:', this.session ? 'exists' : 'null');
    console.log('[handlePost] Session details:', this.session ? { handle: this.session.handle, did: this.session.did, hasAccessJwt: !!this.session.accessJwt } : 'null');
    
    if (!this.session) {
      this.showMessage('❌ Please login first', 'error');
      return;
    }

    if (!textarea.value.trim()) {
      this.showMessage('❌ Post cannot be empty', 'error');
      return;
    }

    postBtn.disabled = true;

    try {
      // Get clean text (without URLs) and detect links
      const { cleanText, url } = this.detectLinks(textarea.value);
      let postText = url ? cleanText : textarea.value;

      // Add #Adblock hashtag if this is a YouTube video and hashtag isn't already present
      if (url) {
        const isYoutubeVideo = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/.test(url);
        if (isYoutubeVideo && !postText.includes('#Adblock')) {
          postText += ' #Adblock';
        }
      }

      // Build post record
      const postRecord = {
        $type: 'app.bsky.feed.post',
        text: postText,
        createdAt: new Date().toISOString(),
        facets: []
      };

      // Build image embed if present
      let imageEmbed = null;
      if (this.pendingImageData) {
        console.log('[handlePost] Processing pendingImageData:', this.pendingImageData);
        try {
          const imageArray = Array.isArray(this.pendingImageData) ? this.pendingImageData : [this.pendingImageData];
          const uploadedImages = [];
          
          console.log('[handlePost] Image count:', imageArray.length);
          
          // Upload each image
          for (const imageData of imageArray) {
            if (!imageData) continue;
            
            let imageBlob;
            
            // Convert data URL to blob (don't use fetch for data URLs)
            if (imageData.startsWith('data:')) {
              const parts = imageData.split(',');
              const mimeMatch = parts[0].match(/:(.*?);/);
              const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
              const bstr = atob(parts[1]);
              const n = bstr.length;
              const u8arr = new Uint8Array(n);
              for (let i = 0; i < n; i++) {
                u8arr[i] = bstr.charCodeAt(i);
              }
              imageBlob = new Blob([u8arr], { type: mimeType });
            } else {
              // For non-data URLs, use fetch
              const imageResponse = await fetch(imageData);
              imageBlob = await imageResponse.blob();
            }
            
            console.log('[handlePost] Uploading image, blob size:', imageBlob.size);
            
            // Upload blob to Bluesky
            const uploadResponse = await fetch('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${this.session.accessJwt}`,
                'Content-Type': imageBlob.type,
              },
              body: imageBlob
            });

            if (uploadResponse.ok) {
              const uploadData = await uploadResponse.json();
              uploadedImages.push({
                image: uploadData.blob,
                alt: 'User uploaded image'
              });
              console.log('[handlePost] Image uploaded successfully');
            } else {
              console.warn('[handlePost] Image upload failed:', uploadResponse.status);
            }
          }
          
          if (uploadedImages.length > 0) {
            imageEmbed = {
              $type: 'app.bsky.embed.images',
              images: uploadedImages.slice(0, 4) // Bluesky max is 4 images
            };
            postRecord.embed = imageEmbed;
            console.log('[handlePost] Added', uploadedImages.length, 'images to post');
          }
        } catch (error) {
          console.warn('Image upload failed, posting without image', error);
        }
      } else {
        console.log('[handlePost] No pendingImageData found');
      }

      // Add link preview if we have pendingLinkPreview OR if URL detected
      if ((this.pendingLinkPreview || url) && !imageEmbed) {
        try {
          // Use pendingLinkPreview if available, otherwise use detected URL
          let ogData = this.pendingLinkPreview;
          
          console.log('[handlePost] pendingLinkPreview:', this.pendingLinkPreview);
          console.log('[handlePost] Detected URL:', url);
          
          if (!ogData) {
            console.log('[handlePost] Fetching OG data for URL:', url);
            console.warn('[handlePost] NOTE: fetchOGData not available in BlueskyIntegration, OG data must come from pendingLinkPreview');
          }
          
          console.log('[handlePost] Using ogData:', ogData);
          
          if (ogData || url) {
            const embedUrl = (ogData && ogData.url) || url;

            let linkEmbed = {
              $type: 'app.bsky.embed.external',
              external: {
                uri: embedUrl,
                title: ogData.title || '',
                description: ogData.description || '',
              }
            };

            if (ogData.image) {
              try {
                let thumbBlob;
                
                // Handle data URLs (from local preview) vs HTTP URLs
                if (ogData.image.startsWith('data:')) {
                  // Convert data URL to blob
                  const dataUrl = ogData.image;
                  const [header, data] = dataUrl.split(',');
                  const mimeMatch = header.match(/data:([^;]+)/);
                  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
                  const binaryString = atob(data);
                  const bytes = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  thumbBlob = new Blob([bytes], { type: mimeType });
                } else {
                  // Fetch from HTTP URL using CORS proxy to bypass CORS restrictions
                  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(ogData.image)}`;
                  const thumbResponse = await fetch(proxyUrl);
                  thumbBlob = await thumbResponse.blob();
                }
                
                const thumbUploadResponse = await fetch('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${this.session.accessJwt}`,
                    'Content-Type': thumbBlob.type,
                  },
                  body: thumbBlob
                });

                if (thumbUploadResponse.ok) {
                  const thumbData = await thumbUploadResponse.json();
                  linkEmbed.external.thumb = thumbData.blob;
                  console.log('[handlePost] Thumbnail uploaded successfully');
                }
              } catch (error) {
                console.warn('[handlePost] Thumbnail upload failed:', error.message);
              }
            }

            postRecord.embed = linkEmbed;
            console.log('[handlePost] Added link embed to post');
          }
        } catch (error) {
          console.error('Link preview error:', error);
        }
      }

      // Post to Bluesky
      console.log('[handlePost] Posting to Bluesky with record:', postRecord);
      const postResponse = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.session.accessJwt}`,
        },
        body: JSON.stringify({
          repo: this.session.did,
          collection: 'app.bsky.feed.post',
          record: postRecord,
        }),
      });

      console.log('[handlePost] Response status:', postResponse.status);
      
      if (!postResponse.ok) {
        const error = await postResponse.json();
        console.error('[handlePost] API Error:', error);
        throw new Error(error.error_description || error.message || 'Post failed');
      }

      const responseData = await postResponse.json();
      console.log('[handlePost] Success! Posted URI:', responseData.uri);

      this.showMessage('✅ Posted to Bluesky!', 'success');
      textarea.value = '';
      document.getElementById('bsky-char-count').textContent = '0';
      this.pendingImageData = null;
      const preview = document.getElementById('bsky-image-preview');
      if (preview) preview.style.display = 'none';
      
      postBtn.disabled = false;
    } catch (error) {
      console.error('Post failed:', error);
      this.showMessage(`❌ ${error.message}`, 'error');
      postBtn.disabled = false;
    }
  }

  async fetchPostAnalytics(uri) {
    // Placeholder for future analytics
    return { likes: 0, reposts: 0, replies: 0, quotes: 0 };
  }

  async fetchUserLists() {
    // Placeholder for future lists functionality
    return [];
  }

  openLinkPreviewModal(url = null, preview = null) {
    const modal = document.getElementById('link-preview-modal');
    if (!modal) return;

    if (!url) {
      const textarea = document.getElementById('bsky-textarea');
      const { url: detectedUrl } = this.detectLinks(textarea.value);
      url = detectedUrl;
    }

    if (!url) {
      this.showMessage('No link found in post', 'error');
      return;
    }

    modal.style.display = 'flex';
    document.getElementById('link-preview-url').textContent = url;
    
    if (preview && preview.image) {
      document.getElementById('link-preview-image').src = preview.image;
      document.getElementById('link-preview-image').style.display = 'block';
    } else {
      document.getElementById('link-preview-image').style.display = 'none';
    }
    
    document.getElementById('link-preview-title-input').value = preview?.title || '';
    document.getElementById('link-preview-desc-input').value = preview?.description || '';
  }

  saveLinkPreview() {
    const title = document.getElementById('link-preview-title-input').value;
    const description = document.getElementById('link-preview-desc-input').value;
    const url = document.getElementById('link-preview-url').textContent;
    const image = document.getElementById('link-preview-image').src;

    this.customLinkPreview = {
      url,
      title,
      description,
      image: image || null
    };

    // Set pendingLinkPreview so detectAndShowLinkPreview uses it instead of fetching fresh data
    this.pendingLinkPreview = this.customLinkPreview;

    document.getElementById('link-preview-modal').style.display = 'none';
    this.detectAndShowLinkPreview(document.getElementById('bsky-textarea').value);
  }
}

// Storage class
class NotesDBStorage {
  constructor() {
    this.dbName = 'SkyPostDB';
    this.storeName = 'notes';
    this.version = 1;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onerror = () => {
        console.error('[Storage] IndexedDB open error:', request.error);
        reject(request.error);
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        console.log('[Storage] ✓ IndexedDB initialized');
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
          console.log('[Storage] Created object store:', this.storeName);
        }
      };
    });
  }

  async saveNote(note) {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(note);
      
      request.onerror = () => {
        console.error('[Storage] Save error:', request.error);
        reject(request.error);
      };
      
      request.onsuccess = () => {
        console.log('[Storage] ✓ Note saved:', note.id);
        // Sync to chrome.storage.sync for background worker access
        this.syncToStorage();
        resolve();
      };
      
      transaction.onerror = () => {
        console.error('[Storage] Transaction error:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  async getAllNotes() {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      
      request.onerror = () => {
        console.error('[Storage] Get all error:', request.error);
        reject(request.error);
      };
      
      request.onsuccess = () => {
        const notes = request.result || [];
        console.log('[Storage] ✓ Loaded', notes.length, 'notes from IndexedDB');
        resolve(notes);
      };
      
      transaction.onerror = () => {
        console.error('[Storage] Transaction error:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  async deleteNote(id) {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(id);
      
      request.onerror = () => {
        console.error('[Storage] Delete error:', request.error);
        reject(request.error);
      };
      
      request.onsuccess = () => {
        console.log('[Storage] ✓ Note deleted:', id);
        this.syncToStorage();
        resolve();
      };
      
      transaction.onerror = () => {
        console.error('[Storage] Transaction error:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  async syncToStorage() {
    // Sync IndexedDB to chrome.storage.sync for background worker access
    // Note: We exclude large data like imageData to stay within sync storage limits (4KB per item)
    try {
      const notes = await this.getAllNotes();
      if (chrome.storage && chrome.storage.sync) {
        // Create a stripped version of notes without large binary data
        const strippedNotes = notes.map(note => ({
          id: note.id,
          title: note.title,
          content: note.content,
          color: note.color,
          status: note.status,
          scheduledFor: note.scheduledFor,
          postedAt: note.postedAt,
          postUri: note.postUri,
          customLinkPreview: note.customLinkPreview,
          videoData: note.videoData,
          addAdblockHashtag: note.addAdblockHashtag,
          createdAt: note.createdAt,
          analytics: note.analytics,
          failureReason: note.failureReason,
          postHistory: note.postHistory,
          // Intentionally exclude: imageData (can be large base64)
        }));
        
        chrome.storage.sync.set({ floatingNotes: strippedNotes }, () => {
          if (!chrome.runtime.lastError) {
            console.log('[Storage] ✓ Synced', strippedNotes.length, 'notes to chrome.storage.sync');
          } else {
            console.warn('[Storage] Sync error:', chrome.runtime.lastError);
          }
        });
      }
    } catch (error) {
      console.error('[Storage] Sync failed:', error);
    }
  }
}

// Classes defined - initialization happens in workspace.html script tag

