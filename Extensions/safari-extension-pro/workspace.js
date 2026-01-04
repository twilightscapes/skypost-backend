// Floating Notes Workspace - Full Screen Editor
class NotesWorkspace {
  constructor() {
    this.db = new NotesDBStorage();
    this.currentNote = null;
    this.allNotes = [];
    this.colors = ['#ffffff', '#fef08a', '#fca5a5', '#bfdbfe', '#bbf7d0', '#e9d5ff', '#fed7aa', '#f3f3f3'];
    this.currentFilter = 'all'; // Track current filter
    
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
    
    // Assign to window so it's available during init() and event listener setup
    window.workspace = this;
    
    this.init();
  }

  async init() {
    try {
      
      // Load notes from IndexedDB
      let dbNotes = await this.db.getAllNotes();
      
      // Also load from chrome.storage.sync to ensure we have all notes (including newly created ones)
      let storageNotes = await new Promise(resolve => {
        chrome.storage.sync.get(['floatingNotes'], (result) => {
          resolve(result.floatingNotes || []);
        });
      });
      
      // Merge both sources - keep notes from storage as primary, add any missing from db
      this.allNotes = Array.isArray(storageNotes) ? [...storageNotes] : [];
      if (Array.isArray(dbNotes)) {
        for (const dbNote of dbNotes) {
          if (!this.allNotes.find(n => n.id === dbNote.id)) {
            this.allNotes.push(dbNote);
          }
        }
      }
      
      console.log('[Workspace Init] Loaded', dbNotes.length, 'from IndexedDB,', storageNotes.length, 'from storage.sync, merged to', this.allNotes.length);

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
        
        if (message && message.action === 'getScheduledNotes') {
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
        } else if (message && message.action === 'updateScheduledNote') {
          console.log('[Workspace] Handling updateScheduledNote:', message.note?.id, 'status:', message.note?.status, 'postUri:', message.note?.postUri);
          // Background worker updated a note status - refresh the UI
          if (this.db && message.note) {
            // Save the updated note from background worker to ensure both storages are in sync
            this.db.saveNote(message.note).then(() => {
              // Also sync to chrome.storage.sync to keep both in sync
              return new Promise((resolve) => {
                chrome.storage.sync.get(['floatingNotes'], (result) => {
                  let notes = result.floatingNotes || [];
                  if (!Array.isArray(notes)) notes = [];
                  // Update or add the note
                  const existingIndex = notes.findIndex(n => n.id === message.note.id);
                  if (existingIndex >= 0) {
                    notes[existingIndex] = message.note;
                  } else {
                    notes.push(message.note);
                  }
                  chrome.storage.sync.set({ 'floatingNotes': notes }, () => {
                    resolve(notes);
                  });
                });
              });
            }).then(notes => {
              this.allNotes = notes;
              console.log('[Workspace] ✓ Updated both storages with note:', notes.find(n => n.id === message.note.id));
              // Refresh the notes list to show updated status
              this.renderNotesList();
              // If timeline is currently visible, re-render it to show the new postUri link
              const timelineContent = document.getElementById('timeline-view');
              if (timelineContent && timelineContent.style.display !== 'none') {
                console.log('[Workspace] Timeline visible, re-rendering with updated postUri');
                this.renderTimeline();
              }
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
    
    console.log('[Workspace] setupEventListeners called');

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

    // Tab switching for Posts/Calendar/Analytics
    document.getElementById('tab-posts').addEventListener('click', () => {
      document.getElementById('posts-tab-content').style.display = 'flex';
      document.getElementById('timeline-tab-content').style.display = 'none';
      document.getElementById('calendar-tab-content').style.display = 'none';
      document.getElementById('analytics-tab-content').style.display = 'none';
      document.getElementById('lists-tab-content').style.display = 'none';
      document.getElementById('tab-posts').classList.add('active');
      document.getElementById('tab-timeline').classList.remove('active');
      document.getElementById('tab-calendar').classList.remove('active');
      document.getElementById('tab-analytics').classList.remove('active');
      document.getElementById('tab-lists').classList.remove('active');
    });

    document.getElementById('tab-calendar').addEventListener('click', () => {
      document.getElementById('posts-tab-content').style.display = 'none';
      document.getElementById('timeline-tab-content').style.display = 'none';
      document.getElementById('calendar-tab-content').style.display = 'flex';
      document.getElementById('analytics-tab-content').style.display = 'none';
      document.getElementById('lists-tab-content').style.display = 'none';
      document.getElementById('tab-posts').classList.remove('active');
      document.getElementById('tab-timeline').classList.remove('active');
      document.getElementById('tab-calendar').classList.add('active');
      document.getElementById('tab-analytics').classList.remove('active');
      document.getElementById('tab-lists').classList.remove('active');
      
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
              document.getElementById('posts-tab-content').classList.add('active');
              document.getElementById('calendar-tab-content').classList.remove('active');
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

    // Analytics tab handler
    document.getElementById('tab-analytics').addEventListener('click', () => {
      // Check Pro license
      if (!window.licenseManager.canUseFeature('analytics')) {
        window.bluesky.showMessage('📊 Analytics is a Pro feature', 'info');
        window.renderProModal();
        document.getElementById('pro-modal').classList.add('active');
        return;
      }

      document.getElementById('posts-tab-content').style.display = 'none';
      document.getElementById('timeline-tab-content').style.display = 'none';
      document.getElementById('calendar-tab-content').style.display = 'none';
      document.getElementById('analytics-tab-content').style.display = 'flex';
      document.getElementById('lists-tab-content').style.display = 'none';
      document.getElementById('tab-posts').classList.remove('active');
      document.getElementById('tab-timeline').classList.remove('active');
      document.getElementById('tab-calendar').classList.remove('active');
      document.getElementById('tab-analytics').classList.add('active');
      document.getElementById('tab-lists').classList.remove('active');
      
      // Render analytics on workspace instance (which has allNotes)
      if (window.workspace && window.workspace.renderAnalytics) {
        window.workspace.renderAnalytics();
      }
    });

    // Lists tab handler
    document.getElementById('tab-lists').addEventListener('click', () => {
      document.getElementById('posts-tab-content').style.display = 'none';
      document.getElementById('timeline-tab-content').style.display = 'none';
      document.getElementById('calendar-tab-content').style.display = 'none';
      document.getElementById('analytics-tab-content').style.display = 'none';
      document.getElementById('lists-tab-content').style.display = 'flex';
      document.getElementById('tab-posts').classList.remove('active');
      document.getElementById('tab-timeline').classList.remove('active');
      document.getElementById('tab-calendar').classList.remove('active');
      document.getElementById('tab-analytics').classList.remove('active');
      document.getElementById('tab-lists').classList.add('active');
      
      // Render lists on workspace instance
      if (window.workspace && window.workspace.renderLists) {
        window.workspace.renderLists();
      }
    });

    // Timeline tab handler
    const timelineTabEl = document.getElementById('tab-timeline');
    console.log('[Workspace] Timeline tab element found:', !!timelineTabEl);
    
    if (!timelineTabEl) {
      console.error('[Workspace] CRITICAL: tab-timeline element not found in DOM!');
    } else {
      timelineTabEl.addEventListener('click', () => {
        console.log('[Tab Click] Timeline tab clicked');
        console.log('[Tab Click] window.workspace type:', typeof window.workspace);
        console.log('[Tab Click] window.workspace value:', window.workspace);
        console.log('[Tab Click] this:', this);
        console.log('[Tab Click] this.renderTimeline type:', typeof this.renderTimeline);
        
        document.getElementById('posts-tab-content').style.display = 'none';
        document.getElementById('timeline-tab-content').style.display = 'flex';
        document.getElementById('calendar-tab-content').style.display = 'none';
        document.getElementById('analytics-tab-content').style.display = 'none';
        document.getElementById('lists-tab-content').style.display = 'none';
        document.getElementById('tab-posts').classList.remove('active');
        document.getElementById('tab-timeline').classList.add('active');
        document.getElementById('tab-calendar').classList.remove('active');
        document.getElementById('tab-analytics').classList.remove('active');
        document.getElementById('tab-lists').classList.remove('active');
        
        // Render timeline on workspace instance - use this since window.workspace may not exist yet
        if (typeof this.renderTimeline === 'function') {
          console.log('[Tab Click] Calling renderTimeline() via this');
          this.renderTimeline();
        } else if (window.workspace && typeof window.workspace.renderTimeline === 'function') {
          console.log('[Tab Click] Calling renderTimeline() via window.workspace');
          window.workspace.renderTimeline();
        } else {
          console.error('[Tab Click] renderTimeline not found!', {
            this_type: typeof this,
            this_renderTimeline: typeof this.renderTimeline,
            window_workspace_type: typeof window.workspace,
            window_workspace_renderTimeline: window.workspace ? typeof window.workspace.renderTimeline : 'n/a'
          });
        }
      });
    }

    document.getElementById('btn-image').addEventListener('click', (e) => {
      e.preventDefault();
      
      // Check if there's already a custom link preview (which creates an embed)
      if (this.currentNote && this.currentNote.customLinkPreview) {
        const confirmed = confirm('This post already has a link preview card. Bluesky only allows one embed per post.\n\nRemove the link preview and add the image?');
        if (!confirmed) return;
        
        // Remove the custom link preview
        this.currentNote.customLinkPreview = null;
        const preview = document.getElementById('editor-link-preview');
        if (preview) preview.style.display = 'none';
      }
      
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (readerEvent) => {
            const editor = document.getElementById('editor-content');
            const html = `<img src="${readerEvent.target.result}" style="max-width: 100%; height: auto; border-radius: 4px; margin: 0.5rem 0;" />`;
            
            // Try insertHTML first
            try {
              document.execCommand('insertHTML', false, html);
            } catch (error) {
              // Fallback: directly append to innerHTML
              editor.innerHTML += html;
            }
            
            editor.focus();
          };
          reader.readAsDataURL(file);
        }
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
          // Decode HTML entities and strip tags
          const textarea = document.createElement('textarea');
          textarea.innerHTML = note.content.replace(/<img[^>]*>/g, '').replace(/<[^>]*>/g, '');
          const cleanContent = textarea.value.trim();
          const text = cleanContent;
          
          // Extract image from note
          let imageData = null;
          const imgMatch = note.content.match(/<img[^>]+src="([^"]+)"/);
          if (imgMatch && imgMatch[1]) {
            imageData = imgMatch[1];
          }
          
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

    // Update UI - extract first line of content as title for display
    const firstLine = (note.content || '').split('\n')[0].substring(0, 50) || 'Untitled Post';
    note.title = firstLine;
    document.getElementById('note-title').value = note.title;
    
    // Set content in contenteditable div - preserve HTML (images, etc)
    const editor = document.getElementById('editor-content');
    editor.innerHTML = note.content || '';
    
    // Restore link preview if it exists
    const preview = document.getElementById('editor-link-preview');
    if (preview) {
      // Only update if there's a custom preview to show
      if (note.customLinkPreview) {
        preview.style.display = 'block';
        this.displayEditorLinkPreview(
          note.customLinkPreview.url,
          note.customLinkPreview,
          preview
        );
      } else {
        preview.style.display = 'none';
      }
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

    // Add #Adblock hashtag if this is a YouTube video and hashtag isn't already present
    if (this.currentNote.customLinkPreview && this.currentNote.customLinkPreview.url) {
      const isYoutubeVideo = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/.test(this.currentNote.customLinkPreview.url);
      
      if (isYoutubeVideo && !this.currentNote.content.includes('#Adblock')) {
        // Just append the hashtag to the content
        this.currentNote.content = (this.currentNote.content.trim() ? this.currentNote.content.trim() + ' ' : '') + '#Adblock';
      }
    }

    // DEBUG: Log what we're saving
    console.log('[Workspace] Saving note with customLinkPreview:', this.currentNote.customLinkPreview);
    
    await this.db.saveNote(this.currentNote);
    
    // Also sync to chrome.storage.sync to keep both storages in sync
    await new Promise(resolve => {
      chrome.storage.sync.get(['floatingNotes'], (result) => {
        let notes = result.floatingNotes || [];
        if (!Array.isArray(notes)) notes = [];
        const existingIndex = notes.findIndex(n => n.id === this.currentNote.id);
        if (existingIndex >= 0) {
          notes[existingIndex] = this.currentNote;
        } else {
          notes.push(this.currentNote);
        }
        chrome.storage.sync.set({ 'floatingNotes': notes }, () => {
          console.log('[Storage] ✓ Synced', notes.length, 'notes to chrome.storage.sync from saveCurrentNote');
          resolve();
        });
      });
    });
    
    // Refresh the UI to show updated title in the list
    await this.renderNotesList();
    
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
    if (this.allNotes.length > 0) {
      this.selectNote(this.allNotes[0]);
    }
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
          filteredNotes = this.allNotes.filter(n => n.content.includes('<img'));
          break;
        case 'has-video':
          filteredNotes = this.allNotes.filter(n => 
            n.content.includes('<video') || 
            n.content.match(/\.(mp4|webm|mov|mkv|avi|flv)/i) ||
            n.content.match(/(youtu\.be|youtube\.com|vimeo\.com|twitch\.tv|dailymotion\.com)/i)
          );
          break;
        case 'text-only':
          filteredNotes = this.allNotes.filter(n => !n.content.includes('<img'));
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
      // Check if it's a YouTube link - use oEmbed API instead of OG scraping
      const youtubeMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (youtubeMatch) {
        const videoId = youtubeMatch[1];
        
        try {
          // Use YouTube oEmbed API (no authentication needed)
          const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
          const oembedResponse = await fetch(oembedUrl);
          
          if (oembedResponse.ok) {
            const oembedData = await oembedResponse.json();
            
            return {
              title: (oembedData.title || 'Video').substring(0, 100),
              description: (oembedData.author_name || 'YouTube').substring(0, 256),
              image: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
            };
          }
        } catch (e) {
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeout);
      
      if (!response.ok) return null;
      
      const html = await response.text();
      
      // Simple extraction - allow any chars between property and content
      const extractMeta = (property) => {
        // Allow anything between property/name and content
        const pattern1 = new RegExp(`og:${property}[^>]*content=["\']([^"']+)["\']`, 'i');
        let match = html.match(pattern1);
        if (match && match[1]) {
          return match[1];
        }
        
        const pattern2 = new RegExp(`content=["\']([^"']+)["\'][^>]*property=["\']og:${property}["\']`, 'i');
        match = html.match(pattern2);
        if (match && match[1]) {
          return match[1];
        }
        
        // Try without og: prefix (for name attribute)
        const pattern3 = new RegExp(`name=["\']${property}["\'][^>]*content=["\']([^"']+)["\']`, 'i');
        match = html.match(pattern3);
        if (match && match[1]) {
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
      }
      
      return { 
        title: (title || 'Link').substring(0, 100), 
        description: (description || '').substring(0, 256), 
        image 
      };
    } catch (error) {
      return null;
    }
  }

  async detectAndShowEditorLinkPreview(text) {
    const preview = document.getElementById('editor-link-preview');
    if (!preview) return;
    
    const { url } = this.detectLinks(text);
    
    if (!url) {
      preview.style.display = 'none';
      return;
    }
    
    // Check if already have a preview for this URL
    if (this.currentNote && this.currentNote.customLinkPreview && this.currentNote.customLinkPreview.url === url) {
      // Already have a preview, show it
      preview.style.display = 'block';
      return;
    }
    
    // Show option to create preview (don't auto-create)
    preview.innerHTML = `
      <div style="padding: 0.75rem; background: #f0f9ff; border: 1px solid #bfdbfe; border-radius: 4px; display: flex; gap: 0.5rem; align-items: center;">
        <span style="font-size: 0.85rem; color: #1e40af;">Link detected</span>
        <button type="button" id="editor-link-preview-btn" style="padding: 0.4rem 0.8rem; background: #0284c7; color: white; border: none; border-radius: 4px; font-size: 0.8rem; cursor: pointer;">Add Preview</button>
      </div>
    `;
    preview.style.display = 'block';
    
    // Add click handler - use setTimeout to ensure button exists
    setTimeout(() => {
      const btn = document.getElementById('editor-link-preview-btn');
      if (btn) {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          preview.innerHTML = '<div style="color: #9ca3af; font-size: 0.85rem;">Loading preview...</div>';
          
          try {
            // Use the BlueskyIntegration's fetchOGData if available
            let ogData;
            if (window.bluesky && window.bluesky.fetchOGData) {
              ogData = await window.bluesky.fetchOGData(url);
            } else {
              ogData = await this.fetchOGData(url);
            }
            
            if (ogData) {
              this.displayEditorLinkPreview(url, ogData, preview);
            } else {
              preview.innerHTML = '<div style="color: #6b7280; font-size: 0.85rem;">Could not load preview</div>';
            }
          } catch (error) {
            console.error('[Editor] Error fetching preview:', error);
            preview.innerHTML = '<div style="color: #dc2626; font-size: 0.85rem;">Error loading preview</div>';
          }
        });
      }
    }, 0);
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
      };
      this.currentNote = newNote;
    }
    
    this.currentNote.customLinkPreview = {
      url,
      title: ogData?.title || '',
      description: ogData?.description || '',
      image: ogData?.image
    };

    // Display full preview with edit and remove buttons
    let html = '';
    if (ogData.image) {
      html += `<img src="${ogData.image}" style="max-width: 100%; max-height: 100px; border-radius: 4px; margin-bottom: 0.5rem;">`;
    }
    html += `<div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 0.25rem; color: #333;" id="preview-title">${ogData.title || 'Link'}</div>`;
    html += `<div style="font-size: 0.8rem; color: #666; line-height: 1.3; margin-bottom: 0.5rem;" id="preview-desc">${ogData.description || url}</div>`;
    html += `<div style="display: flex; gap: 0.5rem;">`;
    html += `<button type="button" id="editor-link-edit-btn" style="padding: 0.4rem 0.8rem; background: #0284c7; color: white; border: none; border-radius: 4px; font-size: 0.8rem; cursor: pointer;">✏️ Edit</button>`;
    html += `<button type="button" id="editor-link-remove-btn" style="padding: 0.4rem 0.8rem; background: #dc2626; color: white; border: none; border-radius: 4px; font-size: 0.8rem; cursor: pointer;">✕ Remove</button>`;
    html += `</div>`;
    previewEl.innerHTML = html;
    
    // Add edit button listener
    setTimeout(() => {
      const editBtn = document.getElementById('editor-link-edit-btn');
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!window.licenseManager.canUseFeature('advancedPreviews')) {
            this.showMessage('Upgrade to Pro to edit link previews', 'info');
            window.renderProModal();
            document.getElementById('pro-modal').classList.add('active');
            return;
          }
          this.togglePreviewEdit(previewEl, ogData);
        });
      }
      
      const removeBtn = document.getElementById('editor-link-remove-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.currentNote.customLinkPreview = null;
          previewEl.style.display = 'none';
        });
      }
    }, 0);
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
      
      // Show preview mode again - use the stored URL from customLinkPreview
      const previewUrl = this.currentNote.customLinkPreview?.url || ogData?.url;
      this.displayEditorLinkPreview(previewUrl, this.currentNote.customLinkPreview, previewEl);
    } else {
      // Edit mode
      let html = '';
      if (ogData.image) {
        html += `<img src="${ogData.image}" style="max-width: 100%; max-height: 100px; border-radius: 4px; margin-bottom: 0.5rem;">`;
      }
      html += `<input type="text" data-field="title" value="${ogData.title}" style="width: 100%; padding: 0.4rem; margin-bottom: 0.5rem; border: 1px solid #ccc; border-radius: 4px;">`;
      html += `<textarea data-field="desc" style="width: 100%; padding: 0.4rem; margin-bottom: 0.5rem; border: 1px solid #ccc; border-radius: 4px; min-height: 60px; font-size: 0.8rem;">${ogData.description}</textarea>`;
      html += `<button id="editor-link-save-btn" style="padding: 0.4rem 0.8rem; background: #10b981; color: white; border: none; border-radius: 4px; font-size: 0.8rem; cursor: pointer;">✅ Done</button>`;
      previewEl.innerHTML = html;
      
      // Add save button listener
      document.getElementById('editor-link-save-btn').addEventListener('click', () => {
        this.togglePreviewEdit(previewEl, ogData);
      });
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
        // Count image data if present
        if (note.image) {
          totalBytes += new Blob([note.image]).size;
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

  selectTimelinePost(postUri, noteId) {
    if (noteId) {
      // If this post came from a note, switch to Posts tab and select it
      document.getElementById('posts-tab-content').style.display = 'flex';
      document.getElementById('timeline-tab-content').style.display = 'none';
      document.getElementById('tab-posts').classList.add('active');
      document.getElementById('tab-timeline').classList.remove('active');
      
      const note = this.allNotes.find(n => n.id === noteId);
      if (note) {
        setTimeout(() => {
          this.selectNote(note);
          const noteCard = document.getElementById(`note-${noteId}`);
          if (noteCard) {
            noteCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 100);
      }
    } else {
      console.log('[Timeline] Post not linked to a local note:', postUri);
      this.showMessage('This post isn\'t linked to a local note', 'info');
    }
  }

  async fetchUserTimeline(limit = 50) {
    // Get session from BlueskyIntegration
    const session = window.bluesky ? window.bluesky.session : null;
    
    if (!session) {
      console.warn('[Timeline] Not logged in');
      return [];
    }

    try {
      console.log('[Timeline] Fetching posts for:', session.did);
      console.log('[Timeline] Access token exists:', !!session.accessJwt);
      
      // Use query parameters for GET request
      const url = new URL('https://bsky.social/xrpc/app.bsky.feed.getAuthorFeed');
      url.searchParams.append('actor', session.did);
      url.searchParams.append('limit', limit);
      url.searchParams.append('filter', 'posts_no_replies'); // Only get posts, not replies
      
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.accessJwt}`,
        },
      });

      console.log('[Timeline] API Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Timeline] API Error:', response.status, response.statusText, errorText);
        return [];
      }

      const data = await response.json();
      console.log('[Timeline] Fetched posts:', data.feed ? data.feed.length : 0, data);
      return data.feed || [];
    } catch (error) {
      console.error('[Timeline] Fetch error:', error);
      return [];
    }
  }

  renderTimeline() {
    const timelineView = document.getElementById('timeline-view');
    const timelineLoading = document.getElementById('timeline-loading');
    const timelineEmpty = document.getElementById('timeline-empty');

    if (!timelineView) {
      console.error('[Timeline] timelineView element not found');
      return;
    }

    // CRITICAL: Reload from storage FIRST to ensure we have latest notes
    chrome.storage.sync.get(['floatingNotes'], (result) => {
      if (result.floatingNotes && Array.isArray(result.floatingNotes)) {
        this.allNotes = result.floatingNotes;
        console.log('[Timeline] Reloaded from storage.sync:', this.allNotes.length, 'notes');
      }
      
      // Get session from BlueskyIntegration
      const session = window.bluesky ? window.bluesky.session : null;
      console.log('[Timeline] Session available:', !!session, session);
      
      if (!session) {
        console.log('[Timeline] No session, showing login message');
        timelineLoading.style.display = 'none';
        timelineView.style.display = 'none';
        timelineEmpty.style.display = 'block';
        timelineEmpty.innerHTML = '<p>Please log in to Bluesky to see your timeline</p>';
        return;
      }

      // Show loading
      timelineLoading.style.display = 'block';
      timelineView.style.display = 'none';
      timelineEmpty.style.display = 'none';

      console.log('[Timeline] Starting render...');

      this.fetchUserTimeline(30).then(posts => {
        console.log('[Timeline] Posts received:', posts.length);
        timelineLoading.style.display = 'none';

        if (!posts || posts.length === 0) {
          console.log('[Timeline] No posts to display');
          timelineEmpty.style.display = 'block';
          timelineEmpty.innerHTML = '<p>No posts yet. Start posting to see them here!</p>';
          return;
        }

        timelineView.style.display = 'block';
        timelineView.innerHTML = `<div style="overflow: hidden; width: 100%;">` + posts.map((item, index) => {
          const post = item.post;
          const author = post.author;
          const likeCount = post.likeCount || 0;
          const repostCount = post.repostCount || 0;
          const replyCount = post.replyCount || 0;
          
          // Log the first item to see structure
          if (index === 0) {
            console.log('[Timeline] Sample post structure:', post, 'record:', post.record);
          }
          
          // Try different date fields
          let createdAt = null;
          if (post.record && post.record.createdAt) {
            createdAt = new Date(post.record.createdAt);
          } else if (post.createdAt) {
            createdAt = new Date(post.createdAt);
          } else if (post.indexedAt) {
            createdAt = new Date(post.indexedAt);
          }
          
          const isValidDate = createdAt && !isNaN(createdAt.getTime());
          const dateStr = isValidDate 
            ? createdAt.toLocaleDateString() + ' ' + createdAt.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
            : 'Unknown date';

          // Check if this post came from a note
          const linkedNote = this.allNotes.find(n => n.postUri === post.uri);
          const noteInfo = this.allNotes.map(n => `[id:${n.id}|uri:${n.postUri || 'NONE'}|status:${n.status}]`).join(', ');
          console.log('[Timeline] Post:', post.uri.substring(post.uri.lastIndexOf('/') + 1), 'Notes:', noteInfo, 'Match:', !!linkedNote);
          const linkedIndicator = linkedNote ? `<span style="color: #00a8e8; font-weight: 600; margin-left: 0.5rem;">✓ SkyPost</span>` : '';

          return `
            <div style="padding: 1rem; border-bottom: 1px solid #e5e7eb; cursor: pointer; transition: background 0.2s;" 
                 data-post-uri="${post.uri}"
                 data-note-id="${linkedNote?.id || ''}"
                 class="timeline-post">
              <div style="display: flex; gap: 0.75rem; margin-bottom: 0.75rem;">
                <img src="${author.avatar || ''}" alt="${author.displayName}" 
                     style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">
                <div style="flex: 1;">
                  <div style="display: flex; gap: 0.5rem; align-items: center;">
                    <strong style="color: #1f2937;">${author.displayName || author.handle}</strong>
                    <span style="color: #9ca3af; font-size: 0.9rem;">@${author.handle}</span>
                    ${linkedIndicator}
                  </div>
                  <div style="color: #9ca3af; font-size: 0.85rem;">${dateStr}</div>
                </div>
              </div>
              <div style="color: #374151; line-height: 1.5; margin-bottom: 0.75rem; word-wrap: break-word;">
                ${post.record.text}
              </div>
              <div style="display: flex; gap: 1.5rem; color: #9ca3af; font-size: 0.85rem;">
                <span>💬 ${replyCount}</span>
                <span>🔄 ${repostCount}</span>
                <span>❤️ ${likeCount}</span>
              </div>
            </div>
          `;
        }).join('') + `</div>`;
      }).catch(error => {
        console.error('[Timeline] Render error:', error);
        timelineLoading.style.display = 'none';
        timelineEmpty.style.display = 'block';
        timelineEmpty.innerHTML = '<p>Error loading timeline. Check console for details.</p>';
      });

      // Add event delegation for timeline post clicks and hover
      const timelineViewEl = document.getElementById('timeline-view');
      if (timelineViewEl) {
        timelineViewEl.addEventListener('click', (e) => {
          const postElement = e.target.closest('.timeline-post');
          if (postElement) {
            const postUri = postElement.dataset.postUri;
            const noteId = postElement.dataset.noteId;
            console.log('[Timeline] Post clicked:', postUri, noteId);
            this.selectTimelinePost(postUri, noteId);
          }
        });
        
        timelineViewEl.addEventListener('mouseover', (e) => {
          const postElement = e.target.closest('.timeline-post');
          if (postElement) {
            postElement.style.background = '#f9fafb';
          }
        });
        
        timelineViewEl.addEventListener('mouseout', (e) => {
          const postElement = e.target.closest('.timeline-post');
          if (postElement) {
            postElement.style.background = 'transparent';
          }
        });
      }
    });
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
        this.openLinkPreviewModal();
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
      const initials = this.session.handle.charAt(0).toUpperCase();
      document.getElementById('bsky-avatar').textContent = initials;
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

      this.showMessage('✅ Logged in!', 'success');
      this.updateUI();
    } catch (error) {
      this.showMessage(`❌ ${error.message}`, 'error');
    }
  }

  detectLinks(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const match = urlRegex.exec(text);
    
    if (!match) return { cleanText: text, url: null };
    
    const url = match[1];
    // Remove URL from text and trim extra whitespace
    const cleanText = text.substring(0, match.index) + text.substring(match.index + url.length);
    
    return { cleanText: cleanText.trim(), url };
  }

  async fetchOGData(url) {
    try {
      // Check if it's a YouTube link - use oEmbed API instead of OG scraping
      const youtubeMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (youtubeMatch) {
        const videoId = youtubeMatch[1];
        
        try {
          // Use YouTube oEmbed API (no authentication needed)
          const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
          const oembedResponse = await fetch(oembedUrl);
          
          if (oembedResponse.ok) {
            const oembedData = await oembedResponse.json();
            
            return {
              title: (oembedData.title || 'Video').substring(0, 100),
              description: (oembedData.author_name || 'YouTube').substring(0, 256),
              image: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
            };
          }
        } catch (e) {
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeout);
      
      if (!response.ok) return null;
      
      const html = await response.text();
      
      // Simple extraction - just look for og:property content=value
      const extractMeta = (property) => {
        // Match: og:title" content="value" or content="value" property="og:title
        const pattern1 = new RegExp(`og:${property}["\']\\s+content=["\']([^"']+)["\']`, 'i');
        let match = html.match(pattern1);
        if (match) return match[1];
        
        const pattern2 = new RegExp(`content=["\']([^"']+)["\']\\s+property=["\']og:${property}["\']`, 'i');
        match = html.match(pattern2);
        if (match) return match[1];
        
        // Also try without og: prefix (for name attribute)
        const pattern3 = new RegExp(`name=["\']${property}["\']\\s+content=["\']([^"']+)["\']`, 'i');
        match = html.match(pattern3);
        if (match) return match[1];
        
        return null;
      };
      
      let title = extractMeta('title');
      let description = extractMeta('description');
      let image = extractMeta('image');
      
      // Fallback to title tag
      if (!title) {
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        title = titleMatch ? titleMatch[1] : '';
      }
      
      return { 
        title: (title || 'Link').substring(0, 100), 
        description: (description || '').substring(0, 256), 
        image 
      };
    } catch (error) {
      console.error('[OG] Error:', error.message);
      return null;
    }
  }

  async createLinkEmbed(url, ogData) {
    // This is handled on the background worker side for Bluesky API compatibility
    return { url, ...ogData };
  }

  async detectAndShowLinkPreview(text) {
    const preview = document.getElementById('bsky-link-preview');
    if (!preview) return;
    
    const { url } = this.detectLinks(text);
    
    if (!url) {
      preview.style.display = 'none';
      return;
    }
    
    // If we have a pending custom preview for this URL, use it instead of fetching
    if (this.pendingLinkPreview && this.pendingLinkPreview.url === url) {
      let html = '<div style="background: white; border-radius: 6px; padding: 0.5rem; border: 1px solid #ddd;">';
      if (this.pendingLinkPreview.image) {
        html += `<img src="${this.pendingLinkPreview.image}" style="max-width: 100%; max-height: 80px; border-radius: 4px; margin-bottom: 0.5rem; display: block;">`;
      }
      html += `<div style="font-weight: 600; font-size: 0.85rem; color: #333; margin-bottom: 0.25rem;">${this.pendingLinkPreview.title || 'Link'}</div>`;
      html += `<div style="font-size: 0.75rem; color: #666; line-height: 1.3;">${this.pendingLinkPreview.description || ''}</div>`;
      html += '</div>';
      preview.innerHTML = html;
      preview.style.display = 'block';
      this.pendingLinkPreview = null; // Clear after using
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
    
    textarea.value = text;
    textarea.focus();
    
    // Store custom link preview BEFORE dispatching input event so detectAndShowLinkPreview can use it
    if (customLinkPreview) {
      this.pendingLinkPreview = customLinkPreview;
    }
    
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    
    // If image data is provided, show image preview in Bluesky
    if (imageData) {
      const previewDiv = document.getElementById('bsky-image-preview');
      if (previewDiv) {
        previewDiv.innerHTML = `<img src="${imageData}" style="max-width: 100%; height: auto; border-radius: 4px;">`;
        previewDiv.style.display = 'block';
        this.pendingImageData = imageData;
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
        try {
          // Fetch the image and convert to blob
          const imageResponse = await fetch(this.pendingImageData);
          const imageBlob = await imageResponse.blob();
          
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
            imageEmbed = {
              $type: 'app.bsky.embed.images',
              images: [{
                image: uploadData.blob,
                alt: 'User uploaded image'
              }]
            };
            postRecord.embed = imageEmbed;
          }
        } catch (error) {
          console.warn('Image upload failed, posting without image');
        }
      }

      // Add link preview if URL detected
      if (url && !imageEmbed) {
        try {
          // If customLinkPreview doesn't exist but we have a URL, fetch the OG data
          let ogData = this.customLinkPreview;
          
          if (!ogData) {
            console.log('[handlePost] Fetching OG data for URL:', url);
            ogData = await this.fetchOGData(url);
          }
          
          if (ogData) {
            const embedUrl = ogData.url || url;

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
                const thumbResponse = await fetch(ogData.image);
                const thumbBlob = await thumbResponse.blob();
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
                }
              } catch (error) {
                console.warn('Thumbnail upload failed, posting without thumb');
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
      console.log('[handlePost] currentNote exists:', !!this.currentNote);
      console.log('[handlePost] currentNote id:', this.currentNote?.id);

      // Save the note with the post URI for timeline linking
      if (responseData.uri) {
        if (this.currentNote) {
          // If a note is loaded, update it
          console.log('[handlePost] Saving postUri to existing note:', this.currentNote.id);
          this.currentNote.postUri = responseData.uri;
          this.currentNote.postedAt = new Date().toISOString();
          this.currentNote.status = 'published';
          await this.saveCurrentNote();
          console.log('[handlePost] ✓ Note saved with postUri');
        } else {
          // If no note is loaded, create a new note with the posted content
          console.log('[handlePost] No currentNote - creating new note for posted content');
          
          const newNote = {
            id: Date.now().toString(),
            text: postText,
            content: postText,
            postUri: responseData.uri,
            postedAt: new Date().toISOString(),
            status: 'published',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            color: (this.colors && this.colors.length > 0) ? this.colors[0] : '#3b82f6', // Default blue color
            postHistory: [Date.now()],
          };
          
          
          // First, load existing notes from storage if this.allNotes is empty/undefined
          if (!this.allNotes || this.allNotes.length === 0) {
            await new Promise(resolve => {
              chrome.storage.sync.get(['floatingNotes'], (result) => {
                if (result.floatingNotes && Array.isArray(result.floatingNotes)) {
                  this.allNotes = result.floatingNotes;
                } else {
                  this.allNotes = [];
                }
                resolve();
              });
            });
          }
          
          // Now add the new note to the existing notes
          this.allNotes.push(newNote);
          
          // If db is available, save to database too
          if (this.db && this.db.saveNote) {
            try {
              await this.db.saveNote(newNote);
            } catch (dbError) {
              console.warn('[handlePost] DB save failed, continuing with storage.sync only:', dbError);
            }
          }
          
          // Sync ALL notes to storage
          console.log('[handlePost] Syncing', this.allNotes.length, 'notes to storage');
          await new Promise(resolve => {
            chrome.storage.sync.set({ 'floatingNotes': this.allNotes }, () => {
              console.log('[Storage] ✓ Synced', this.allNotes.length, 'notes to chrome.storage.sync');
              resolve();
            });
          });
          
          console.log('[handlePost] ✓ New note created with postUri');
        }
      } else {
        console.warn('[handlePost] No URI in response - post not linked to note!');
      }

      // Reload allNotes from storage to reflect any new notes created
      await new Promise(resolve => {
        chrome.storage.sync.get(['floatingNotes'], (result) => {
          if (result.floatingNotes) {
            this.allNotes = result.floatingNotes;
            console.log('[handlePost] Reloaded allNotes from storage, now have:', this.allNotes.length, 'notes');
          }
          resolve();
        });
      });

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
    
    document.getElementById('link-preview-title').value = preview?.title || '';
    document.getElementById('link-preview-desc').value = preview?.description || '';
  }

  saveLinkPreview() {
    const title = document.getElementById('link-preview-title').value;
    const description = document.getElementById('link-preview-desc').value;
    const url = document.getElementById('link-preview-url').textContent;
    const image = document.getElementById('link-preview-image').src;

    this.customLinkPreview = {
      url,
      title,
      description,
      image: image || null
    };

    document.getElementById('link-preview-modal').style.display = 'none';
    this.detectAndShowLinkPreview(document.getElementById('bsky-textarea').value);
  }
}

// Storage class
class NotesDBStorage {
  constructor() {
    this.storageKey = 'floatingNotes';
  }

  async init() {
    return Promise.resolve();
  }

  async saveNote(note) {
    
    return new Promise((resolve, reject) => {
      // Try chrome.storage first
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([this.storageKey], (result) => {
          if (chrome.runtime.lastError) {
            console.warn('[Storage] chrome.storage error, falling back to localStorage');
            this.saveToLocalStorage(note);
            resolve();
            return;
          }

          const notes = result[this.storageKey] || [];
          const index = notes.findIndex(n => n.id === note.id);
          
          if (index >= 0) {
            notes[index] = note;
          } else {
            notes.push(note);
          }

          chrome.storage.local.set({ [this.storageKey]: notes }, () => {
            if (chrome.runtime.lastError) {
              console.warn('[Storage] chrome.storage.set failed, falling back to localStorage');
              this.saveToLocalStorage(note);
            } else {
              // Also sync to chrome.storage.sync for background worker scheduling
              if (chrome.storage.sync) {
                chrome.storage.sync.set({ floatingNotes: notes }, () => {
                  if (!chrome.runtime.lastError) {
                    console.log('[Storage] ✓ Synced', notes.length, 'notes to chrome.storage.sync');
                  }
                });
              }
            }
            resolve();
          });
        });
      } else {
        console.warn('[Storage] chrome.storage not available, using localStorage');
        this.saveToLocalStorage(note);
        resolve();
      }
    });
  }

  saveToLocalStorage(note) {
    try {
      const notes = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
      const index = notes.findIndex(n => n.id === note.id);
      if (index >= 0) {
        notes[index] = note;
      } else {
        notes.push(note);
      }
      localStorage.setItem(this.storageKey, JSON.stringify(notes));
    } catch (error) {
      console.error('[Storage] localStorage error:', error);
    }
  }

  async getAllNotes() {
    
    return new Promise((resolve) => {
      // Try chrome.storage first
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([this.storageKey], (result) => {
          if (chrome.runtime.lastError) {
            console.warn('[Storage] chrome.storage error, falling back to localStorage');
            const notes = this.getFromLocalStorage();
            resolve(notes);
            return;
          }

          const notes = result[this.storageKey] || [];
          resolve(notes);
        });
      } else {
        console.warn('[Storage] chrome.storage not available, using localStorage');
        const notes = this.getFromLocalStorage();
        resolve(notes);
      }
    });
  }

  getFromLocalStorage() {
    try {
      const notes = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
      return notes;
    } catch (error) {
      console.error('[Storage] localStorage error:', error);
      return [];
    }
  }

  async deleteNote(id) {
    return new Promise((resolve) => {
      // Try chrome.storage first
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([this.storageKey], (result) => {
          if (chrome.runtime.lastError) {
            console.warn('[Storage] chrome.storage error, falling back to localStorage');
            this.deleteFromLocalStorage(id);
            resolve();
            return;
          }

          const notes = result[this.storageKey] || [];
          const filtered = notes.filter(n => n.id !== id);
          
          chrome.storage.local.set({ [this.storageKey]: filtered }, () => {
            if (chrome.runtime.lastError) {
              console.warn('[Storage] chrome.storage.set failed, falling back to localStorage');
              this.deleteFromLocalStorage(id);
            } else {
            }
            resolve();
          });
        });
      } else {
        console.warn('[Storage] chrome.storage not available, using localStorage');
        this.deleteFromLocalStorage(id);
        resolve();
      }
    });
  }

  deleteFromLocalStorage(id) {
    try {
      const notes = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
      const filtered = notes.filter(n => n.id !== id);
      localStorage.setItem(this.storageKey, JSON.stringify(filtered));
    } catch (error) {
      console.error('[Storage] localStorage error:', error);
    }
  }
}

// Classes defined - initialization happens in workspace.html script tag

