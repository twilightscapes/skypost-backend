class NotesApp {
  constructor() {
    this.db = new NotesDBStorage();
    this.notes = [];
    this.editingId = null;
    this.colors = ['#ffffff', '#fef08a', '#fca5a5', '#bfdbfe', '#bbf7d0', '#e9d5ff', '#fed7aa'];
    this.currentFilter = '';
    this.init();
  }

  async init() {
    try {
      await this.loadNotes();
      this.setupEventListeners();
      this.loadBackground();
      this.renderColorPicker();
      this.renderNotes();
    } catch (error) {
      console.error('❌ Error initializing app:', error);
    }
  }

  async loadNotes() {
    this.notes = await this.db.getAllNotes();
  }

  setupEventListeners() {
    try {
      document.getElementById('add-note-btn').addEventListener('click', () => {
        this.openModal();
      });
      document.getElementById('clear-all-btn').addEventListener('click', () => this.clearAllNotes());
      document.getElementById('settings-btn').addEventListener('click', (e) => this.toggleSettings(e));
      document.getElementById('search-input').addEventListener('input', (e) => this.searchNotes(e.target.value));
      document.getElementById('sort-select').addEventListener('change', (e) => this.filterNotes(e.target.value));
      document.getElementById('bg-upload').addEventListener('change', (e) => this.uploadBackground(e));
      document.getElementById('opacity-slider').addEventListener('input', (e) => this.updateOpacity(e.target.value));
      document.getElementById('upload-btn').addEventListener('click', () => document.getElementById('bg-upload').click());
      
      // Image upload handler for notes
      document.getElementById('note-image').addEventListener('change', (e) => this.handleImageUpload(e));

      // Modal button handlers using event delegation
      document.getElementById('edit-modal').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        
        const action = btn.dataset.action;
        
        if (action === 'save') {
          e.preventDefault();
          e.stopPropagation();
          this.saveNote();
        } else if (action === 'cancel' || action === 'close') {
          e.preventDefault();
          e.stopPropagation();
          closeModal();
        } else if (action === 'delete') {
          e.preventDefault();
          e.stopPropagation();
          if (confirm('Delete this note?')) {
            this.deleteNote(this.editingId);
            closeModal();
          }
        }
      });

      // Note click to edit - entire note is clickable
      const container = document.getElementById('notes-container');
      container.addEventListener('click', (e) => {
        const note = e.target.closest('.sticky-note');
        if (note) {
          const noteId = note.dataset.noteId;
          this.openModal(noteId);
        }
      });

      // Close settings when clicking outside
      document.addEventListener('click', (e) => {
        const panel = document.getElementById('settings-panel');
        const btn = document.getElementById('settings-btn');
        if (!panel.contains(e.target) && !btn.contains(e.target)) {
          panel.classList.remove('visible');
        }
      });
    } catch (error) {
      console.error('Error setting up event listeners:', error);
    }
  }

  renderColorPicker() {
    const picker = document.getElementById('color-picker');
    picker.innerHTML = '';
    this.colors.forEach(color => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'color-option';
      dot.style.backgroundColor = color;
      if (this.editingId) {
        const note = this.notes.find(n => n.id === this.editingId);
        if (note && note.color === color) {
          dot.classList.add('selected');
        }
      }
      dot.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.color-option').forEach(d => d.classList.remove('selected'));
        dot.classList.add('selected');
        document.getElementById('note-color').value = color;
      });
      picker.appendChild(dot);
    });
  }

  openModal(noteId = null) {
    try {
      this.editingId = noteId;
      const modal = document.getElementById('edit-modal');
      const deleteBtn = document.getElementById('modal-delete-btn');
      
      if (noteId) {
        const note = this.notes.find(n => n.id === noteId);
        document.getElementById('edit-title').value = note.title;
        
        // Extract image from content if present
        const imgMatch = note.content.match(/<img[^>]+src="([^">]+)"/);
        const plainContent = note.content.replace(/<img[^>]*>/g, '').trim();
        document.getElementById('edit-content').value = plainContent;
        
        if (imgMatch && imgMatch[1]) {
          // Restore the image data
          document.getElementById('note-image-data').value = imgMatch[1];
          const preview = document.getElementById('image-preview');
          preview.innerHTML = `<img src="${imgMatch[1]}">`;
        } else {
          document.getElementById('note-image-data').value = '';
          document.getElementById('image-preview').innerHTML = '';
        }
        
        document.getElementById('note-color').value = note.color;
        document.querySelector('.modal-title').textContent = 'Edit Note';
        deleteBtn.style.display = 'block';  // Show delete button when editing
      } else {
        document.getElementById('edit-title').value = '';
        document.getElementById('edit-content').value = '';
        document.getElementById('note-color').value = '#ffffff';
        document.getElementById('note-image-data').value = '';
        document.getElementById('image-preview').innerHTML = '';
        document.querySelector('.modal-title').textContent = 'New Note';
        deleteBtn.style.display = 'none';  // Hide delete button when creating
      }
      
      this.renderColorPicker();
      modal.classList.add('visible');
    } catch (error) {
      console.error('❌ Error opening modal:', error);
    }
  }

  async saveNote() {
    try {
      const title = document.getElementById('edit-title').value.trim();
      const content = document.getElementById('edit-content').value.trim();
      const color = document.getElementById('note-color').value || '#ffffff';
      const imageData = document.getElementById('note-image-data').value;

      if (!title && !content) {
        alert('Please add a title or content');
        return;
      }

      // Combine content with image if present
      let fullContent = content;
      if (imageData) {
        fullContent = `${content}<img src="${imageData}" class="note-image" style="max-width: 100%; border-radius: 8px; margin-top: 10px;">`;
      }

      if (this.editingId) {
        const note = this.notes.find(n => n.id === this.editingId);
        note.title = title || 'Untitled';
        note.content = fullContent;
        note.color = color;
        await this.db.saveNote(note);
      } else {
        const newNote = {
          id: Date.now().toString(),
          title: title || 'Untitled',
          content: fullContent,
          color: color,
          createdAt: Date.now()
        };
        this.notes.unshift(newNote);
        await this.db.saveNote(newNote);
      }

      this.editingId = null;
      this.renderNotes();
      closeModal();
    } catch (error) {
      alert('Error saving note: ' + error.message);
      console.error('❌ Error saving note:', error);
    }
  }

  handleImageUpload(e) {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const imageData = event.target.result;
        // Store in hidden field
        document.getElementById('note-image-data').value = imageData;
        // Show preview
        const preview = document.getElementById('image-preview');
        if (preview) {
          preview.innerHTML = `<img src="${imageData}">`;
        }
      };
      reader.readAsDataURL(file);
    }
  }

  renderNotes() {
    const container = document.getElementById('notes-container');
    let notesToShow = [...this.notes];

    // Apply filter
    if (this.currentFilter) {
      const colorMap = {
        'color-white': '#ffffff',
        'color-yellow': '#fef08a',
        'color-red': '#fca5a5',
        'color-blue': '#bfdbfe',
        'color-green': '#bbf7d0',
        'color-purple': '#e9d5ff',
        'color-orange': '#fed7aa',
      };

      switch (this.currentFilter) {
        case 'date':
          notesToShow.sort((a, b) => b.createdAt - a.createdAt);
          break;
        case 'images':
          notesToShow = notesToShow.filter(n => n.content.includes('<img'));
          break;
        case 'text':
          notesToShow = notesToShow.filter(n => n.content && !n.content.includes('<img'));
          break;
        case 'empty':
          notesToShow = notesToShow.filter(n => !n.content);
          break;
        default:
          if (this.currentFilter.startsWith('color-')) {
            const color = colorMap[this.currentFilter];
            if (color) {
              notesToShow = notesToShow.filter(n => n.color === color);
            }
          }
      }
    }

    if (notesToShow.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📝</div>
          <p>No notes${this.currentFilter ? ' matching this filter' : ''}. Click ➕ to create one!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = notesToShow.map((note, i) => `
      <div class="sticky-note" style="background-color: ${note.color};" data-note-id="${note.id}" ${i % 2 === 1 ? 'class="sticky-note rotated"' : ''}>
        <div class="sticky-note-title">${note.title}</div>
        <div class="sticky-note-content">${note.content}</div>
        <div class="sticky-note-footer">
          <button class="note-share-btn" data-note-id="${note.id}" title="Share this note">🔗 Share</button>
        </div>
      </div>
    `).join('');

    // Add share button event listeners
    container.querySelectorAll('.note-share-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const noteId = btn.dataset.noteId;
        const note = this.notes.find(n => n.id === noteId);
        if (note) {
          this.shareNote(note);
        }
      });
    });
  }

  async deleteNote(noteId) {
    if (confirm('Delete this note?')) {
      this.notes = this.notes.filter(n => n.id !== noteId);
      await this.db.deleteNote(noteId);
      this.renderNotes();
    }
  }

  shareNote(note) {
    // Extract clean text content (remove all HTML tags)
    const cleanContent = note.content
      .replace(/<img[^>]*>/g, '') // Remove img tags
      .replace(/<[^>]*>/g, '') // Remove all HTML tags
      .trim();
    
    const shareText = `${note.title}${cleanContent ? '\n\n' + cleanContent : ''}`;
    
    const shareDialog = document.getElementById('share-dialog');
    const shareUrlInput = document.getElementById('share-url-input');
    
    // Create shareable text
    if (shareUrlInput) {
      shareUrlInput.value = shareText;
      shareUrlInput.select();
    }
    
    // Extract and copy image to clipboard if it exists
    const imgMatch = note.content.match(/<img[^>]+src="([^">]+)"/);
    if (imgMatch && imgMatch[1]) {
      const imageData = imgMatch[1];
      // Convert base64 to blob and copy to clipboard
      fetch(imageData)
        .then(res => res.blob())
        .then(blob => {
          navigator.clipboard.write([
            new ClipboardItem({
              'image/png': blob
            })
          ]).then(() => {
            // Show notification with instructions
            const infoBox = document.querySelector('.share-info');
            if (infoBox) {
              const originalText = infoBox.innerHTML;
              infoBox.innerHTML = '<strong>✅ Image copied!</strong> After opening the social post window, paste your image with Cmd+V';
              setTimeout(() => {
                infoBox.innerHTML = originalText;
              }, 5000);
            }
          }).catch(err => {
            console.warn('Could not copy image:', err);
          });
        })
        .catch(err => console.warn('Image blob conversion failed:', err));
    } else {
      // Show note about no image
      const infoBox = document.querySelector('.share-info');
      if (infoBox) {
        const originalText = infoBox.innerHTML;
        infoBox.innerHTML = '<strong>📝 Note:</strong> This note has no image attached.';
        setTimeout(() => {
          infoBox.innerHTML = originalText;
        }, 3000);
      }
    }
    
    if (shareDialog) {
      shareDialog.classList.add('visible');
    }
  }

  async clearAllNotes() {
    if (confirm('Delete all notes? This cannot be undone.')) {
      for (const note of this.notes) {
        await this.db.deleteNote(note.id);
      }
      this.notes = [];
      this.renderNotes();
    }
  }

  searchNotes(query) {
    if (!query) {
      this.renderNotes();
      return;
    }

    const filtered = this.notes.filter(n =>
      n.title.toLowerCase().includes(query.toLowerCase()) ||
      n.content.toLowerCase().includes(query.toLowerCase())
    );

    const container = document.getElementById('notes-container');
    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <p>No notes found</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map((note, i) => `
      <div class="sticky-note" style="background-color: ${note.color};" data-note-id="${note.id}" ${i % 2 === 1 ? 'class="sticky-note rotated"' : ''}>
        <div class="sticky-note-title">${note.title}</div>
        <div class="sticky-note-content">${note.content}</div>
      </div>
    `).join('');
  }

  filterNotes(filter) {
    this.currentFilter = filter;
    this.renderNotes();
  }

  loadBackground() {
    const bg = localStorage.getItem('notesBackground');
    const opacity = localStorage.getItem('notesOpacity') || '30';
    
    if (bg) {
      const overlay = document.querySelector('.background-overlay');
      overlay.style.backgroundImage = `url(${bg})`;
      overlay.style.opacity = (parseInt(opacity) / 100).toString();
    }

    document.getElementById('opacity-slider').value = opacity;
    document.getElementById('opacity-value').textContent = opacity + '%';
  }

  uploadBackground(e) {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const data = event.target.result;
        localStorage.setItem('notesBackground', data);
        const overlay = document.querySelector('.background-overlay');
        overlay.style.backgroundImage = `url(${data})`;
        overlay.style.opacity = (parseInt(document.getElementById('opacity-slider').value) / 100).toString();
      };
      reader.readAsDataURL(file);
    }
  }

  updateOpacity(value) {
    localStorage.setItem('notesOpacity', value);
    document.getElementById('opacity-value').textContent = value + '%';
    const overlay = document.querySelector('.background-overlay');
    overlay.style.opacity = (parseInt(value) / 100).toString();
  }

  toggleSettings(e) {
    e.stopPropagation();
    const panel = document.getElementById('settings-panel');
    panel.classList.toggle('visible');
  }
}

class NotesDBStorage {
  constructor() {
    this.key = 'floatingNotes';
  }

  async getAllNotes() {
    return new Promise((resolve) => {
      chrome.storage.local.get([this.key], (result) => {
        resolve(result[this.key] || []);
      });
    });
  }

  async saveNote(note) {
    return new Promise((resolve) => {
      this.getAllNotes().then((notes) => {
        const index = notes.findIndex(n => n.id === note.id);
        if (index >= 0) {
          notes[index] = note;
        } else {
          notes.push(note);
        }
        chrome.storage.local.set({ [this.key]: notes }, resolve);
      });
    });
  }

  async deleteNote(id) {
    return new Promise((resolve) => {
      this.getAllNotes().then((notes) => {
        const filtered = notes.filter(n => n.id !== id);
        chrome.storage.local.set({ [this.key]: filtered }, resolve);
      });
    });
  }
}

// Initialize app
let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new NotesApp();
});

// Helper functions
function closeModal() {
  if (document.getElementById('edit-modal')) {
    document.getElementById('edit-modal').classList.remove('visible');
  }
}

function saveNote() {
  if (app) {
    app.saveNote();
  } else {
    alert('ERROR: app instance not found');
  }
}
// Share functionality
function initializeShareDialog() {
  const shareBtn = document.getElementById('share-btn');
  const shareDialog = document.getElementById('share-dialog');
  const shareCloseBtn = document.getElementById('share-close-btn');
  const shareDialogCloseBtn = document.getElementById('share-dialog-close-btn');
  const shareCopyBtn = document.getElementById('share-copy-btn');
  const shareUrlInput = document.getElementById('share-url-input');

  if (!shareBtn || !shareDialog) return;

  // Open share dialog
  shareBtn.addEventListener('click', () => {
    const currentUrl = window.location.href;
    shareUrlInput.value = currentUrl;
    shareUrlInput.select();
    shareDialog.classList.add('visible');
  });

  // Close share dialog
  const closeDialog = () => {
    shareDialog.classList.remove('visible');
  };

  shareCloseBtn.addEventListener('click', closeDialog);
  shareDialogCloseBtn.addEventListener('click', closeDialog);

  // Close when clicking outside
  shareDialog.addEventListener('click', (e) => {
    if (e.target === shareDialog) {
      closeDialog();
    }
  });

  // Close with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && shareDialog.classList.contains('visible')) {
      closeDialog();
    }
  });

  // Copy URL
  shareCopyBtn.addEventListener('click', () => {
    const text = shareUrlInput.value;
    navigator.clipboard.writeText(text).then(() => {
      const originalText = shareCopyBtn.textContent;
      shareCopyBtn.textContent = '✅ Copied!';
      shareCopyBtn.style.background = '#22c55e';
      
      setTimeout(() => {
        shareCopyBtn.textContent = originalText;
        shareCopyBtn.style.background = '#4CAF50';
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  });

  // Share platform buttons
  document.querySelectorAll('.share-platform-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const platform = btn.dataset.platform;
      const noteText = shareUrlInput.value;
      
      let shareUrl = '';
      
      switch (platform) {
        case 'twitter':
          shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(noteText)}`;
          break;
        case 'facebook':
          shareUrl = `https://www.facebook.com/sharer/sharer.php?quote=${encodeURIComponent(noteText)}`;
          break;
        case 'reddit':
          shareUrl = `https://reddit.com/submit?title=${encodeURIComponent(noteText)}`;
          break;
        case 'bluesky':
          // Bluesky compose intent - opens compose window with text
          shareUrl = `https://bsky.app/intent/compose?text=${encodeURIComponent(noteText)}`;
          break;
        case 'email':
          shareUrl = `mailto:?subject=${encodeURIComponent('Check out my note')}&body=${encodeURIComponent(noteText)}`;
          break;
      }
      
      if (shareUrl) {
        if (platform === 'email') {
          // Email opens directly
          window.location.href = shareUrl;
        } else {
          // Open social platforms in new window
          window.open(shareUrl, '_blank', 'width=600,height=700,scrollbars=yes');
        }
      }
    });
  });
}

// Initialize share dialog when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initializeShareDialog, 500);
});