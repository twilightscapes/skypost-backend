// Floating Notes Workspace - Full Screen Editor
class NotesWorkspace {
  constructor() {
    this.db = new NotesDBStorage();
    this.currentNote = null;
    this.allNotes = [];
    this.colors = ['#ffffff', '#fef08a', '#fca5a5', '#bfdbfe', '#bbf7d0', '#e9d5ff', '#fed7aa', '#f3f3f3'];
    this.currentFilter = 'all'; // Track current filter
    // Don't auto-init - wait for db to be ready
  }

  async init() {
    try {
      console.log('[Workspace] Initializing...');
      
      // Initialize IndexedDB first
      await this.db.init();
      console.log('[Workspace] Database initialized');
      
      // Load notes from storage
      this.allNotes = await this.db.getAllNotes();
      console.log('[Workspace] Loaded notes:', this.allNotes.length);

      // Set up UI
      this.setupEventListeners();
      await this.renderNotesList();
      console.log('[Workspace] UI rendered');

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

    } catch (error) {
      console.error('[Workspace] INITIALIZATION FAILED:', error);
    }
  }

  setupEventListeners() {
    // Close button
    document.getElementById('close-workspace').addEventListener('click', () => {
      window.close();
    });

    // New note
    document.getElementById('new-note-btn').addEventListener('click', () => {
      this.createNewNote();
    });

    // Clear all
    document.getElementById('clear-all-btn').addEventListener('click', () => {
      this.clearAllNotes();
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
      document.getElementById('posts-tab-content').style.display = 'block';
      document.getElementById('calendar-tab-content').style.display = 'none';
      document.getElementById('analytics-tab-content').style.display = 'none';
      document.getElementById('lists-tab-content').style.display = 'none';
      document.getElementById('tab-posts').classList.add('active');
      document.getElementById('tab-calendar').classList.remove('active');
      document.getElementById('tab-analytics').classList.remove('active');
      document.getElementById('tab-lists').classList.remove('active');
    });

    document.getElementById('tab-calendar').addEventListener('click', () => {
      document.getElementById('posts-tab-content').style.display = 'none';
      document.getElementById('calendar-tab-content').style.display = 'block';
      document.getElementById('analytics-tab-content').style.display = 'none';
      document.getElementById('lists-tab-content').style.display = 'none';
      document.getElementById('tab-posts').classList.remove('active');
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

    // Analytics tab handler
    document.getElementById('tab-analytics').addEventListener('click', async () => {
      // Check Pro license
      if (!window.licenseManager.canUseFeature('analytics')) {
        console.log('[Analytics] Pro feature check - not pro');
        window.bluesky.showMessage('📊 Analytics is a Pro feature', 'info');
        console.log('[Analytics] renderProModal function exists?', typeof window.renderProModal);
        if (window.renderProModal) {
          console.log('[Analytics] Calling renderProModal...');
          await window.renderProModal();
        } else {
          console.log('[Analytics] renderProModal NOT FOUND on window!');
        }
        document.getElementById('pro-modal').classList.add('active');
        return;
      }

      document.getElementById('posts-tab-content').style.display = 'none';
      document.getElementById('calendar-tab-content').style.display = 'none';
      document.getElementById('analytics-tab-content').style.display = 'block';
      document.getElementById('lists-tab-content').style.display = 'none';
      document.getElementById('tab-posts').classList.remove('active');
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
      document.getElementById('calendar-tab-content').style.display = 'none';
      document.getElementById('analytics-tab-content').style.display = 'none';
      document.getElementById('lists-tab-content').style.display = 'block';
      document.getElementById('tab-posts').classList.remove('active');
      document.getElementById('tab-calendar').classList.remove('active');
      document.getElementById('tab-analytics').classList.remove('active');
      document.getElementById('tab-lists').classList.add('active');
      
      // Render lists on workspace instance
      if (window.workspace && window.workspace.renderLists) {
        window.workspace.renderLists();
      }
    });

    document.getElementById('btn-image').addEventListener('click', (e) => {
      e.preventDefault();
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
    document.getElementById('btn-save').addEventListener('click', () => {
      this.saveCurrentNote();
    });

    // Schedule button
    document.getElementById('btn-schedule').addEventListener('click', () => {
      if (!this.currentNote) {
        alert('Please create a post first');
        return;
      }
      // Save current note before scheduling
      this.currentNote.title = document.getElementById('note-title').value || 'Untitled Post';
      this.currentNote.content = document.getElementById('editor-content').value;
      this.showScheduleModal();
    });

    // Schedule form
    document.getElementById('schedule-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.scheduleCurrentNote();
    });

    document.getElementById('cancel-schedule').addEventListener('click', () => {
      this.hideScheduleModal();
    });

    // Schedule link preview edit button
    document.getElementById('schedule-link-edit-btn').addEventListener('click', () => {
      const editorEl = document.getElementById('editor-content');
      if (!editorEl) return;
      
      // Use textContent for contenteditable divs
      const content = editorEl.textContent || editorEl.innerHTML;
      let cleanContent = content;
      if (content.includes('<')) {
        const temp = document.createElement('div');
        temp.innerHTML = content;
        cleanContent = temp.textContent || temp.innerText || '';
      }
      
      const { url } = this.detectLinks(cleanContent);
      if (url) {
        // Open the link preview modal for editing
        const preview = this.currentNote && this.currentNote.customLinkPreview ? { ...this.currentNote.customLinkPreview } : {};
        this.openLinkPreviewModal(url, preview);
      }
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
      // Now that we use textarea, 'input' event will fire reliably
      editorContent.addEventListener('input', () => {
        this.updatePlaceholder();
        this.updateCharCounter();
        const text = editorContent.value;
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
            this.currentNote.content = document.getElementById('editor-content').value;
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
          
          window.bluesky.sendToComposer(text, imageData);
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
    // Textarea doesn't need placeholder management - handled by placeholder attribute
  }

  updateCharCounter() {
    const editor = document.getElementById('editor-content');
    const counter = document.getElementById('char-counter');
    const charCount = document.getElementById('char-count');
    const MAX_CHARS = 300;
    
    // Get text from textarea
    const text = editor.value || '';
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
    
    // Focus title for immediate editing
    document.getElementById('note-title').focus();
    document.getElementById('note-title').select();
  }

  selectNote(note) {
    this.currentNote = note;

    // Update UI
    document.getElementById('note-title').value = note.title;
    
    // Strip HTML tags from content for textarea display
    const textarea = document.getElementById('editor-content');
    const temp = document.createElement('div');
    temp.innerHTML = note.content;
    textarea.value = temp.textContent || temp.innerText || note.content;
    
    // Restore link preview if it exists
    const preview = document.getElementById('editor-link-preview');
    if (preview) {
      preview.style.display = 'none';
      preview.innerHTML = '';
      
      if (note.customLinkPreview) {
        this.displayEditorLinkPreview(
          note.customLinkPreview.url,
          note.customLinkPreview,
          preview
        );
      }
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
    this.currentNote.content = document.getElementById('editor-content').value;

    await this.db.saveNote(this.currentNote);
    
    // Refresh list to show updated content
    await this.renderNotesList();
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
    if (this.allNotes.length === 0 || !confirm(`Delete all ${this.allNotes.length} notes?`)) {
      return;
    }

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
    const colorFiltersContainer = document.getElementById('color-filters');
    if (colorFiltersContainer) {
      colorFiltersContainer.innerHTML = uniqueColors.map(color => `
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
                  <div class="note-card-title">${note.title}</div>
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

    // RIGHT PANEL: Show status dashboard with scheduled/failed/published
    this.renderPostSummary(groups.scheduled, groups.published, groups.failed);
  }

  renderPostSummary(scheduledNotes, publishedNotes, failedNotes) {
    const scheduledContainer = document.getElementById('scheduled-posts-container');
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
                  <div style="font-weight: 500; color: #1f2937; margin-bottom: 0.25rem;">${note.title}</div>
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

    // Render scheduled posts LAST - clickable to select from left
    if (scheduledNotes && scheduledNotes.length > 0) {
      scheduledContainer.innerHTML = `
        <div style="margin-bottom: 1.5rem;">
          <h4 style="font-size: 0.9rem; font-weight: 600; margin-bottom: 0.5rem; color: #0284c7;">📅 Scheduled (${scheduledNotes.length})</h4>
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            ${scheduledNotes.map(note => {
              const timeLeft = note.scheduledFor - Date.now();
              let timeInfo = '';
              if (timeLeft > 0) {
                timeInfo = this.formatTimeUntil(timeLeft);
              } else {
                timeInfo = 'Posting soon...';
              }
              return `
                <div class="scheduled-post-item" data-note-id="${note.id}" style="padding: 0.75rem; background: #dbeafe; border-left: 3px solid #0284c7; border-radius: 4px; font-size: 0.85rem; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='#bfdbfe';" onmouseout="this.style.background='#dbeafe';">
                  <div style="font-weight: 500; color: #1f2937; margin-bottom: 0.25rem;">${note.title}</div>
                  <div style="color: #0284c7; font-size: 0.8rem;">Posts in ${timeInfo}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
      
      // Add click handlers to select note from left
      scheduledContainer.querySelectorAll('.scheduled-post-item').forEach(item => {
        item.addEventListener('click', (e) => {
          const noteId = item.dataset.noteId;
          const note = this.allNotes.find(n => n.id === noteId);
          if (note) {
            this.selectNote(note);
          }
        });
      });
    } else {
      scheduledContainer.innerHTML = '';
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
    
    // Detect and show link preview if present
    this.detectAndShowSchedulePreview();
    
    modal.classList.add('visible');
    dateTimeInput.focus();
  }

  async detectAndShowSchedulePreview() {
    const editorEl = document.getElementById('editor-content');
    if (!editorEl) {
      return;
    }
    
    // Use textContent for contenteditable divs (innerText can be unreliable)
    const content = editorEl.textContent || editorEl.innerHTML;
    
    // Strip HTML if using innerHTML
    let cleanContent = content;
    if (content && content.includes('<')) {
      const temp = document.createElement('div');
      temp.innerHTML = content;
      cleanContent = temp.textContent || temp.innerText || '';
    }
    
    const { url } = this.detectLinks(cleanContent);
    
    const previewSection = document.getElementById('schedule-link-preview-section');
    const previewDiv = document.getElementById('schedule-link-preview');
    
    if (!url) {
      if (previewSection) previewSection.style.display = 'none';
      return;
    }
    
    if (previewSection) previewSection.style.display = 'block';
    if (previewDiv) previewDiv.innerHTML = '<p style="text-align: center; color: #9ca3af; font-size: 0.9rem;">Loading preview...</p>';
    
    // Check if there's already a custom preview
    let preview = this.currentNote && this.currentNote.customLinkPreview;
    
    // If no custom preview, fetch OG data
    if (!preview) {
      preview = await this.fetchOGData(url);
      if (preview && !preview.url) {
        preview.url = url;
      }
      // Save the fetched preview to currentNote so it's available for editing
      if (preview && this.currentNote) {
        this.currentNote.customLinkPreview = {
          url: preview.url || url,
          title: preview.title || '',
          description: preview.description || '',
          image: preview.image
        };
      }
    }
    
    if (!preview) {
      if (previewDiv) previewDiv.innerHTML = `<p style="text-align: center; color: #6b7280; font-size: 0.9rem;">Could not load preview for ${url}</p>`;
      return;
    }
    
    // Ensure URL is stored in preview for later use in background worker
    if (!preview.url) {
      preview.url = url;
    }
    
    if (previewDiv) {
      previewDiv.innerHTML = `
        <div style="padding: 0.75rem; background: white; border-radius: 4px;">
          ${preview.image ? `<img src="${preview.image}" style="width: 100%; height: 120px; object-fit: cover; border-radius: 4px; margin-bottom: 0.5rem;">` : ''}
          <div style="font-weight: 500; color: #333; margin-bottom: 0.25rem; font-size: 0.9rem;">${preview.title || 'No title'}</div>
          <div style="font-size: 0.8rem; color: #6b7280; line-height: 1.3;">${preview.description || 'No description'}</div>
        </div>
      `;
    }
  }

  hideScheduleModal() {
    document.getElementById('schedule-modal').classList.remove('visible');
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
        btn.style.background = '#667eea';
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

    // Check scheduling limit for free users
    if (!window.licenseManager.canUseFeature('scheduled')) {
      const scheduledCount = (this.allNotes || []).filter(n => n.status === 'scheduled').length;
      if (scheduledCount >= 3) {
        alert('Free plan limited to 3 scheduled posts. Please upgrade to Pro for unlimited scheduling.');
        this.hideScheduleModal();
        return;
      }
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
      this.currentNote.content = document.getElementById('editor-content').value;
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
    
    // Show loading
    preview.innerHTML = '<div style="color: #9ca3af; font-size: 0.85rem;">Loading preview...</div>';
    preview.style.display = 'block';
    
    // Fetch OG data
    try {
      const ogData = await this.fetchOGData(url);
      if (ogData) {
        this.displayEditorLinkPreview(url, ogData, preview);
      } else {
        preview.innerHTML = '<div style="color: #6b7280; font-size: 0.85rem;">Could not load preview</div>';
      }
    } catch (error) {
      preview.innerHTML = '<div style="color: #dc2626; font-size: 0.85rem;">Error loading preview</div>';
    }
  }

  displayEditorLinkPreview(url, ogData, previewEl) {
    // Store preview data in currentNote
    if (!this.currentNote) return;
    
    this.currentNote.customLinkPreview = {
      url,
      title: ogData?.title || '',
      description: ogData?.description || '',
      image: ogData?.image
    };

    // Display full preview with edit button
    let html = '';
    if (ogData.image) {
      html += `<img src="${ogData.image}" style="max-width: 100%; max-height: 100px; border-radius: 4px; margin-bottom: 0.5rem;">`;
    }
    html += `<div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 0.25rem; color: #333;" id="preview-title">${ogData.title || 'Link'}</div>`;
    html += `<div style="font-size: 0.8rem; color: #666; line-height: 1.3; margin-bottom: 0.5rem;" id="preview-desc">${ogData.description || url}</div>`;
    html += `<button id="editor-link-edit-btn" style="padding: 0.4rem 0.8rem; background: #0284c7; color: white; border: none; border-radius: 4px; font-size: 0.8rem; cursor: pointer;">✏️ Edit</button>`;
    previewEl.innerHTML = html;
    
    // Add edit button listener
    document.getElementById('editor-link-edit-btn').addEventListener('click', () => {
      this.togglePreviewEdit(previewEl, ogData);
    });
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
      }
      
      // Persist changes to database
      this.db.saveNote(this.currentNote);
      
      // Show preview mode again
      this.displayEditorLinkPreview(ogData.url, this.currentNote.customLinkPreview, previewEl);
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
}

// Storage class - use chrome.storage.local (extension-wide, not origin-specific)
class NotesDBStorage {
  constructor() {
    this.storageKey = 'floatingNotes';
    console.log('[DBStorage] Constructor - storageKey:', this.storageKey);
  }

  async init() {
    console.log('[DBStorage] init() - chrome.storage is extension-wide');
    console.log('[DBStorage] Current storageKey:', this.storageKey);
    return Promise.resolve();
  }

  async saveNote(note) {
    console.log('[DBStorage] saveNote() via message-passing - noteId:', note.id);
    
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'saveNote', note: note }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('[DBStorage] ✗ Message error:', chrome.runtime.lastError);
            resolve();
            return;
          }
          
          if (response?.success) {
            console.log('[DBStorage] ✓ saveNote successful, total notes:', response.count);
          } else {
            console.error('[DBStorage] ✗ saveNote failed');
          }
          resolve();
        });
      } catch (error) {
        console.error('[DBStorage] ✗ saveNote error:', error);
        resolve();
      }
    });
  }

  async getAllNotes() {
    console.log('[DBStorage] getAllNotes() via message-passing to background');
    
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'getAllNotes' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('[DBStorage] ✗ Message error:', chrome.runtime.lastError);
            resolve([]);
            return;
          }
          
          const notes = response?.notes || [];
          console.log('[DBStorage] ✓ getAllNotes returned', notes.length, 'notes from background');
          resolve(notes);
        });
      } catch (error) {
        console.error('[DBStorage] ✗ getAllNotes error:', error);
        resolve([]);
      }
    });
  }

  async deleteNote(id) {
    console.log('[DBStorage] deleteNote() via message-passing - id:', id);
    
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'deleteNote', noteId: id }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('[DBStorage] ✗ Message error:', chrome.runtime.lastError);
            resolve();
            return;
          }
          
          if (response?.success) {
            console.log('[DBStorage] ✓ deleteNote successful, remaining notes:', response.count);
          } else {
            console.error('[DBStorage] ✗ deleteNote failed');
          }
          resolve();
        });
      } catch (error) {
        console.error('[DBStorage] ✗ deleteNote error:', error);
        resolve();
      }
    });
  }
}

// Bluesky Integration
class BlueskyIntegration {
  constructor() {
    this.pdsUrl = 'https://bsky.social';
    this.session = null;
    this.pendingImageData = null;
    this.pendingLinkUrl = null;
    this.customLinkPreview = null; // For Pro feature: custom link preview data
    this.init();
  }

  async init() {
    await this.loadSession();
    this.setupEventListeners();
    this.updateUI();
  }

  loadSession() {
    return new Promise((resolve) => {
      // Try chrome.storage first
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
        // If chrome.storage not available, use localStorage
        try {
          const sessionStr = localStorage.getItem('blueskySession');
          if (sessionStr) {
            this.session = JSON.parse(sessionStr);
          } else {
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
        console.log('[LinkEdit] Pro feature check - advancedPreviews');
        console.log('[LinkEdit] pro-modal element:', document.getElementById('pro-modal'));
        console.log('[LinkEdit] pro-modal-body element:', document.getElementById('pro-modal-body'));
        if (!window.licenseManager.canUseFeature('advancedPreviews')) {
          console.log('[LinkEdit] Not pro, showing modal');
          this.showMessage('Upgrade to Pro to edit link previews', 'info');
          console.log('[LinkEdit] renderProModal exists?', typeof window.renderProModal);
          if (window.renderProModal) {
            console.log('[LinkEdit] Calling renderProModal...');
            window.renderProModal();
          }
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

      // Save to both chrome.storage and localStorage
      try {
        chrome.storage.local.set({ blueskySession: sessionData });
      } catch (error) {
        console.warn('[Bluesky] chrome.storage failed:', error);
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
    // Use custom preview data if Pro user edited it
    const previewData = this.customLinkPreview || ogData;
    
    const embed = {
      $type: 'app.bsky.embed.external',
      external: {
        uri: url,
        title: previewData?.title || '',
        description: previewData?.description || ''
      }
    };

    // Use custom image if provided, otherwise use OG image
    const imageUrl = this.customLinkPreview?.customImage || ogData?.image;
    
    if (imageUrl) {
      try {
        // Use CORS proxy for the image as well
        const proxyImageUrl = 'https://corsproxy.io/?' + encodeURIComponent(imageUrl);
        const imgResponse = await fetch(proxyImageUrl);
        const blob = await imgResponse.blob();
        
        // Upload image as blob
        const uploadResponse = await fetch(`${this.pdsUrl}/xrpc/com.atproto.repo.uploadBlob`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.session.accessJwt}`,
            'Content-Type': blob.type
          },
          body: blob
        });

        if (uploadResponse.ok) {
          const blobData = await uploadResponse.json();
          embed.external.thumb = blobData.blob;
        }
      } catch (error) {
        console.error('[OG] Failed to upload OG image:', error);
      }
    }

    return embed;
  }

  showLinkPreview(url, ogData) {
    const preview = document.getElementById('bsky-link-preview');
    const display = document.getElementById('link-preview-display');
    
    if (!preview || !display) return;
    
    this.pendingLinkUrl = url;
    
    // Display preview
    let html = '';
    if (ogData?.image) {
      html += `<img id="link-preview-thumb" src="${ogData.image}" style="max-width: 100%; max-height: 100px; border-radius: 4px; margin-bottom: 0.5rem;">`;
    }
    html += `<div id="link-preview-title" style="font-weight: 600; font-size: 0.9rem; margin-bottom: 0.25rem; color: #333;">${ogData?.title || 'Link'}</div>`;
    html += `<div id="link-preview-desc" style="font-size: 0.8rem; color: #666; line-height: 1.3;">${ogData?.description || url}</div>`;
    
    display.innerHTML = html;
    preview.style.display = 'block';
    
    // Store OG data for potential editing (include url and image)
    this.customLinkPreview = { 
      url,
      title: ogData?.title || '',
      description: ogData?.description || '',
      image: ogData?.image
    };
  }

  // Generic version for different preview elements
  showLinkPreviewInElement(url, ogData, previewElementId) {
    const preview = document.getElementById(previewElementId);
    
    if (!preview) return;
    
    // Display preview
    let html = '';
    if (ogData?.image) {
      html += `<img src="${ogData.image}" style="max-width: 100%; max-height: 100px; border-radius: 4px; margin-bottom: 0.5rem;">`;
    }
    html += `<div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 0.25rem; color: #333;">${ogData?.title || 'Link'}</div>`;
    html += `<div style="font-size: 0.8rem; color: #666; line-height: 1.3;">${ogData?.description || url}</div>`;
    
    preview.innerHTML = html;
    preview.style.display = 'block';
  }

  async detectAndShowLinkPreview(text) {
    const { url } = this.detectLinks(text);
    const preview = document.getElementById('bsky-link-preview');
    
    if (!url) {
      if (preview) preview.style.display = 'none';
      this.customLinkPreview = null;
      return;
    }
    
    // Fetch OG data
    try {
      const ogData = await this.fetchOGData(url);
      if (ogData) {
        this.showLinkPreview(url, ogData);
      }
    } catch (error) {
      console.error('[Link] Failed to fetch preview:', error);
    }
  }

  openLinkPreviewModal(url = null, initialPreview = null) {
    // Support both direct post mode (no params) and schedule mode (url + preview)
    if (!url && !this.customLinkPreview) return;
    
    const preview = initialPreview || this.customLinkPreview || {};
    
    // Store context for saving (either direct post or scheduled)
    this.linkPreviewModalContext = {
      url: url,
      isScheduled: !!url,
      preview: preview
    };
    
    document.getElementById('link-preview-title-input').value = preview.title || '';
    document.getElementById('link-preview-desc-input').value = preview.description || '';
    document.getElementById('link-preview-modal').style.display = 'flex';
  }

  saveLinkPreview() {
    const context = this.linkPreviewModalContext || {};
    const preview = {
      title: document.getElementById('link-preview-title-input').value,
      description: document.getElementById('link-preview-desc-input').value
    };
    
    // Include URL and image if available (preserve from original preview)
    if (context.url) {
      preview.url = context.url;
    }
    if (context.preview && context.preview.image) {
      preview.image = context.preview.image;
    }
    
    if (context.isScheduled && this.currentNote) {
      // Saving for scheduled post
      this.currentNote.customLinkPreview = preview;
      // Update the schedule preview display
      this.updateSchedulePreviewDisplay(preview);
      this.showMessage('✅ Link preview updated', 'success');
    } else {
      // Saving for direct post
      this.customLinkPreview = preview;
      
      // Update display
      document.getElementById('link-preview-title').textContent = preview.title;
      document.getElementById('link-preview-desc').textContent = preview.description;
      
      this.showMessage('✅ Link preview updated', 'success');
    }
    
    document.getElementById('link-preview-modal').style.display = 'none';
  }

  updateSchedulePreviewDisplay(preview) {
    const previewDiv = document.getElementById('schedule-link-preview');
    if (!previewDiv) return;
    
    previewDiv.innerHTML = `
      <div style="padding: 0.75rem; background: white; border-radius: 4px;">
        ${preview.image ? `<img src="${preview.image}" style="width: 100%; height: 120px; object-fit: cover; border-radius: 4px; margin-bottom: 0.5rem;">` : ''}
        <div style="font-weight: 500; color: #333; margin-bottom: 0.25rem; font-size: 0.9rem;">${preview.title || 'No title'}</div>
        <div style="font-size: 0.8rem; color: #6b7280; line-height: 1.3;">${preview.description || 'No description'}</div>
      </div>
    `;
  }

  editEditorLinkPreview() {
    if (!this.currentNote || !this.currentNote.customLinkPreview) return;
    
    if (!window.licenseManager.canUseFeature('advancedPreviews')) {
      this.showMessage('Upgrade to Pro to edit link previews', 'info');
      window.renderProModal();
      document.getElementById('pro-modal').classList.add('active');
      return;
    }
    
    const preview = this.currentNote.customLinkPreview;
    this.openLinkPreviewModal(preview.url, preview);
  }

  handlePost(e) {
    e.preventDefault();
    const content = document.getElementById('bsky-textarea').value.trim();

    if (!content) {
      this.showMessage('❌ Please write something!', 'error');
      return;
    }

    const postBtn = document.getElementById('bsky-post-btn');
    postBtn.disabled = true;

    // Detect links first (so we can check length of actual post text, not including URL)
    const { cleanText, url } = this.detectLinks(content);

    // Use cleanText (URL removed). Don't include URL in text if we're making an embed
    const finalText = cleanText.trim();

    // Check character limit
    if (finalText.length > 300) {
      this.showMessage('❌ Post is too long!', 'error');
      postBtn.disabled = false;
      return;
    }

    // Either need text OR a link/image
    if (!finalText && !url && !this.pendingImageData) {
      this.showMessage('❌ Please write something or add a link/image!', 'error');
      postBtn.disabled = false;
      return;
    }

    const postRecord = {
      $type: 'app.bsky.feed.post',
      text: finalText,
      createdAt: new Date().toISOString()
    };

    // If there's a URL, fetch OG data and create embed
    const handlePostLogic = async () => {
      if (url && !this.pendingImageData) {
        try {
          // If we already have customLinkPreview (user edited it), use that directly
          let ogData = this.customLinkPreview;
          
          // If no custom preview exists, fetch OG data fresh
          if (!ogData) {
            ogData = await this.fetchOGData(url);
            if (ogData) {
              // Show link preview for user to potentially customize
              this.showLinkPreview(url, ogData);
            }
          }
          
          // Create embed using stored custom preview
          if (ogData) {
            const linkEmbed = await this.createLinkEmbed(url, ogData);
            postRecord.embed = linkEmbed;
          }
        } catch (error) {
          console.error('[Post] Error fetching OG data:', error);
        }
      }

      // If there's an image, upload it first
      if (this.pendingImageData) {
        this.uploadImageFromDataUrl(this.pendingImageData)
          .then(imageBlob => {
            if (imageBlob) {
              postRecord.embed = {
                $type: 'app.bsky.embed.images',
                images: [{ image: imageBlob, alt: '' }]
              };
            }
            return this.createPost(postRecord, postBtn);
          })
          .catch(error => {
            console.error('[Post] Image upload failed:', error);
            this.showMessage(`❌ Image upload failed: ${error.message}`, 'error');
            postBtn.disabled = false;
          });
      } else {
        this.createPost(postRecord, postBtn).catch(error => {
          console.error('[Post] Post failed:', error);
        });
      }
    };

    // Execute the post logic
    handlePostLogic();
  }

  uploadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      try {
        // Convert data URL to blob
        fetch(dataUrl)
          .then(res => res.blob())
          .then(blob => {
            
            // Upload to Bluesky
            fetch(`${this.pdsUrl}/xrpc/com.atproto.repo.uploadBlob`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${this.session.accessJwt}`,
                'Content-Type': blob.type || 'image/png'
              },
              body: blob
            }).then(response => {
              if (!response.ok) {
                return response.json().then(error => {
                  throw new Error(error.message || 'Upload failed');
                });
              }
              return response.json();
            }).then(data => {
              resolve(data.blob);
            }).catch(error => {
              console.error('[Post] Upload error:', error);
              reject(error);
            });
          })
          .catch(error => {
            console.error('[Post] Blob creation error:', error);
            reject(error);
          });
      } catch (error) {
        console.error('[Post] DataURL conversion error:', error);
        reject(error);
      }
    });
  }

  async createPost(postRecord, postBtn) {
    // Refresh token before posting
    if (this.session && this.session.refreshJwt) {
      try {
        const refreshResponse = await fetch('https://bsky.social/xrpc/com.atproto.server.refreshSession', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.session.refreshJwt}`,
          },
        });


        if (refreshResponse.ok) {
          const newSession = await refreshResponse.json();
          this.session = {
            did: this.session.did,
            handle: this.session.handle,
            accessJwt: newSession.accessJwt,
            refreshJwt: newSession.refreshJwt || this.session.refreshJwt,
          };
          
          // Save the refreshed session
          await new Promise((resolve) => {
            chrome.storage.local.set({ 'blueskySession': this.session }, () => {
              resolve();
            });
          });
        } else {
          const errorData = await refreshResponse.json().catch(() => ({}));
          console.warn('[Post] Token refresh failed:', refreshResponse.status, errorData);
        }
      } catch (refreshError) {
        console.error('[Post] Error refreshing token:', refreshError.message);
      }
    } else {
    }

    // Proceed with posting
    fetch(`${this.pdsUrl}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.session.accessJwt}`
      },
      body: JSON.stringify({
        repo: this.session.did,
        collection: 'app.bsky.feed.post',
        record: postRecord
      })
    }).then(response => {
      if (!response.ok) {
        return response.json().then(error => {
          throw new Error(error.message || 'Failed to post');
        });
      }
      return response.json();
    }).then(data => {
      // Capture the post URI for analytics
      if (data && data.uri && this.currentNote) {
        this.currentNote.postUri = data.uri;
        this.currentNote.postedAt = Date.now();
        this.db.saveNote(this.currentNote);
      }
      
      this.showMessage('✅ Posted!', 'success');
      document.getElementById('bsky-textarea').value = '';
      document.getElementById('bsky-char-count').textContent = '0';
      
      // Clear image
      this.pendingImageData = null;
      const preview = document.getElementById('bsky-image-preview');
      if (preview) preview.style.display = 'none';
      
      // Clear link preview
      const linkPreview = document.getElementById('bsky-link-preview');
      if (linkPreview) linkPreview.style.display = 'none';
      this.customLinkPreview = null;
      this.pendingLinkUrl = null;
      
      postBtn.disabled = false;
    }).catch(error => {
      console.error('Post failed:', error);
      this.showMessage(`❌ ${error.message}`, 'error');
      postBtn.disabled = false;
    });
  }

  showMessage(text, type) {
    const msgEl = document.getElementById('bluesky-message');
    msgEl.textContent = text;
    msgEl.className = `bluesky-message ${type}`;
    msgEl.style.display = 'block';
    setTimeout(() => {
      msgEl.style.display = 'none';
    }, 3000);
  }

  sendToComposer(text, imageData = null) {
    if (!this.session) {
      this.showMessage('❌ Please login first', 'error');
      return;
    }
    const textarea = document.getElementById('bsky-textarea');
    textarea.value = text;
    textarea.dispatchEvent(new Event('input'));
    
    // If image data is provided, show image preview in Bluesky
    if (imageData) {
      const previewDiv = document.getElementById('bsky-image-preview');
      const previewImg = document.getElementById('bsky-preview-img');
      
      if (previewDiv && previewImg) {
        previewImg.src = imageData;
        previewDiv.style.display = 'block';
        
        // Store the image data URL for posting
        this.pendingImageData = imageData;
      }
    }
  }

  async fetchPostAnalytics(postUri) {
    if (!this.session || !postUri) return null;
    
    try {
      // Extract the post author (DID) and rkey from the URI
      // URI format: at://did:plc:xxx/app.bsky.feed.post/xxx
      const parts = postUri.split('/');
      const rkey = parts[parts.length - 1];
      
      // Fetch the post to get engagement metrics from the feed
      const response = await fetch(`https://bsky.social/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(postUri)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.session.accessJwt}`
        }
      });
      
      if (!response.ok) {
        console.error('[Analytics] Failed to fetch post thread:', response.status);
        return null;
      }
      
      const data = await response.json();
      const post = data.thread?.post;
      
      if (!post) return null;
      
      // Extract engagement metrics
      return {
        likes: post.likeCount || 0,
        reposts: post.repostCount || 0,
        replies: post.replyCount || 0,
        quotes: post.quoteCount || 0
      };
    } catch (error) {
      console.error('[Analytics] Error fetching analytics:', error);
      return null;
    }
  }

  async fetchUserLists() {
    if (!this.session) return null;
    
    try {
      // Fetch all lists the user created
      const response = await fetch(`https://bsky.social/xrpc/app.bsky.graph.getLists?actor=${this.session.did}&limit=100`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.session.accessJwt}`
        }
      });
      
      if (!response.ok) {
        console.error('[Lists] Failed to fetch lists:', response.status);
        return null;
      }
      
      const data = await response.json();
      
      if (!data.lists) return null;
      
      // Return list info with URIs for opening
      return data.lists.map(list => ({
        uri: list.uri,
        name: list.name,
        description: list.description || '',
        avatar: list.avatar,
        creator: list.creator.handle,
        listItemCount: list.listItemCount || 0,
        indexedAt: list.indexedAt
      }));
    } catch (error) {
      console.error('[Lists] Error fetching lists:', error);
      return null;
    }
  }

  async fetchListMembers(listUri) {
    if (!this.session || !listUri) return null;
    
    try {
      // Fetch members of a specific list
      const response = await fetch(`https://bsky.social/xrpc/app.bsky.graph.getList?list=${encodeURIComponent(listUri)}&limit=100`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.session.accessJwt}`
        }
      });
      
      if (!response.ok) {
        console.error('[Lists] Failed to fetch list members:', response.status);
        return null;
      }
      
      const data = await response.json();
      
      if (!data.items) return null;
      
      // Return member DIDs for tracking
      return data.items.map(item => item.subject.did);
    } catch (error) {
      console.error('[Lists] Error fetching list members:', error);
      return null;
    }
  }
}

// Classes defined - initialization happens in workspace.html script tag

