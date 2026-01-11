// Backup and Restore Manager for SkyPost Extension
// Handles backing up notes, settings, and other extension data to a downloadable file
// and restoring from previously downloaded backup files

class BackupManager {
  constructor() {
    this.storageKey = 'floatingNotes';
    this.settingsStorageKeys = [
      'extensionEnabled',
      'notesBackground',
      'customColors',
      'defaultNoteColor',
      'notesSortOrder',
      'blueskySession'
    ];
  }

  /**
   * Get all data that should be included in backup
   * @returns {Promise<Object>} Object containing all backup data
   */
  async getAllBackupData() {
    return new Promise((resolve) => {
      const backupData = {
        version: '1.0',
        extensionName: 'SkyPost',
        timestamp: Date.now(),
        date: new Date().toISOString(),
        data: {
          notes: [],
          settings: {},
          metadata: {
            noteCount: 0,
            imageCount: 0,
            backupVersion: '1.0'
          }
        }
      };

      // Try to get notes from IndexedDB first (new storage method)
      const request = indexedDB.open('SkyPostDB');
      request.onerror = () => {
        console.warn('[BackupManager] IndexedDB not available, falling back to chrome.storage');
        this.getAllBackupDataFromChrome(backupData, resolve);
      };
      
      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(['notes'], 'readonly');
        const store = transaction.objectStore('notes');
        const getAllRequest = store.getAll();
        
        getAllRequest.onsuccess = () => {
          const notes = getAllRequest.result || [];
          console.log('[BackupManager] Got', notes.length, 'notes from IndexedDB');
          backupData.data.notes = notes;
          backupData.data.metadata.noteCount = notes.length;
          backupData.data.metadata.imageCount = this.countImagesInNotes(notes);
          
          // Get settings from chrome.storage
          chrome.storage.local.get(this.settingsStorageKeys, (settingsResult) => {
            backupData.data.settings = settingsResult || {};
            resolve(backupData);
          });
        };
        
        getAllRequest.onerror = () => {
          console.warn('[BackupManager] Error reading IndexedDB, falling back to chrome.storage');
          this.getAllBackupDataFromChrome(backupData, resolve);
        };
      };
    });
  }

  /**
   * Fallback method to get backup data from chrome.storage
   * @private
   */
  getAllBackupDataFromChrome(backupData, resolve) {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([this.storageKey], (notesResult) => {
        const notes = notesResult[this.storageKey] || [];
        backupData.data.notes = notes;
        backupData.data.metadata.noteCount = notes.length;
        backupData.data.metadata.imageCount = this.countImagesInNotes(notes);

        // Get settings from storage
        chrome.storage.local.get(this.settingsStorageKeys, (settingsResult) => {
          backupData.data.settings = settingsResult || {};
          resolve(backupData);
        });
      });
    } else {
      // Fallback to localStorage
      const notes = this.getNotesFromLocalStorage();
      backupData.data.notes = notes;
      backupData.data.metadata.noteCount = notes.length;
      backupData.data.metadata.imageCount = this.countImagesInNotes(notes);

      const settings = {};
      this.settingsStorageKeys.forEach(key => {
        const value = localStorage.getItem(key);
        if (value) {
          try {
            settings[key] = JSON.parse(value);
          } catch {
            settings[key] = value;
          }
        }
      });
      backupData.data.settings = settings;
      resolve(backupData);
    }
  }

  /**
   * Count images in notes by checking for imageData arrays (new format) and old image formats
   * @private
   */
  countImagesInNotes(notes) {
    let imageCount = 0;
    notes.forEach(note => {
      // Count images in new imageData array format (up to 4 per note)
      if (note.imageData && Array.isArray(note.imageData)) {
        imageCount += note.imageData.length;
      }
      
      // Fallback: count old single image format
      if (note.image && !note.imageData) {
        imageCount += 1;
      }
      
      // Also count images in content HTML for old format compatibility
      if (note.content && typeof note.content === 'string') {
        const imgMatches = note.content.match(/<img[^>]+src="data:image\/[^"]+"/g);
        if (imgMatches) {
          // Only count if not already counted in imageData or image fields
          if (!note.imageData && !note.image) {
            imageCount += imgMatches.length;
          }
        }
      }
    });
    return imageCount;
  }

  /**
   * Create a backup and initiate download
   * @returns {Promise<void>}
   */
  async createBackup() {
    try {
      const backupData = await this.getAllBackupData();
      
      // Create blob and download
      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `skypost-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Save backup timestamp
      this.saveBackupTimestamp();
      
      return {
        success: true,
        message: 'Backup created successfully!',
        count: backupData.data.metadata.noteCount
      };
    } catch (error) {
      console.error('[BackupManager] Error creating backup:', error);
      return {
        success: false,
        error: 'Failed to create backup',
        details: error.message
      };
    }
  }

  /**
   * Preview a backup file without restoring
   * @param {File} file - The backup file to preview
   * @returns {Promise<Object>} Preview data
   */
  async previewBackup(file) {
    try {
      const text = await file.text();
      const backupData = JSON.parse(text);

      if (!backupData.version || !backupData.data) {
        throw new Error('Invalid backup file format');
      }

      return {
        success: true,
        version: backupData.version,
        date: new Date(backupData.timestamp).toLocaleDateString(),
        time: new Date(backupData.timestamp).toLocaleTimeString(),
        noteCount: backupData.data.metadata?.noteCount || backupData.data.notes?.length || 0,
        imageCount: backupData.data.metadata?.imageCount || this.countImagesInNotes(backupData.data.notes || []),
        settingCount: Object.keys(backupData.data.settings || {}).length,
        backupData: backupData
      };
    } catch (error) {
      console.error('[BackupManager] Error previewing backup:', error);
      return {
        success: false,
        error: 'Invalid backup file format',
        details: error.message
      };
    }
  }

  /**
   * Restore data from a backup file
   * @param {File} file - The backup file to restore
   * @param {Function} onProgress - Callback for progress updates
   * @returns {Promise<Object>} Result of restore operation
   */
  async restoreBackup(file, onProgress = null) {
    try {
      const preview = await this.previewBackup(file);
      
      if (!preview.success) {
        throw new Error(preview.error);
      }

      const backupData = preview.backupData;
      
      // Show confirmation
      const imageInfo = preview.imageCount > 0 ? `\n• ${preview.imageCount} images` : '';
      const confirmMsg = `Restore backup from ${preview.date}?\n\n` +
        `This will restore:\n` +
        `• ${preview.noteCount} notes${imageInfo}\n` +
        `• ${preview.settingCount} settings\n\n` +
        `Current data will be replaced. This cannot be undone.`;
      
      if (!confirm(confirmMsg)) {
        return { success: false, cancelled: true };
      }

      onProgress && onProgress('Clearing existing data...');

      // Preserve license before clearing
      const licenseData = await new Promise((resolve) => {
        chrome.storage.local.get(['proLicenseKey', 'proLicenseExpiry'], (result) => {
          resolve(result);
        });
      });

      // Clear existing data
      await this.clearAllData(false);

      // Restore license
      if (licenseData.proLicenseKey) {
        await new Promise((resolve) => {
          chrome.storage.local.set(licenseData, resolve);
        });
      }

      onProgress && onProgress('Restoring notes...');

      // Restore notes
      if (backupData.data.notes && backupData.data.notes.length > 0) {
        await this.restoreNotes(backupData.data.notes);
      }

      onProgress && onProgress('Restoring settings...');

      // Restore settings
      if (backupData.data.settings && Object.keys(backupData.data.settings).length > 0) {
        await this.restoreSettings(backupData.data.settings);
      }

      // Save restore timestamp
      this.saveRestoreTimestamp();

      onProgress && onProgress('Restore complete! Reloading...');

      return {
        success: true,
        message: 'Data restored successfully!',
        notesRestored: preview.noteCount,
        imagesRestored: preview.imageCount,
        settingsRestored: preview.settingCount
      };
    } catch (error) {
      console.error('[BackupManager] Error restoring backup:', error);
      return {
        success: false,
        error: 'Failed to restore backup',
        details: error.message
      };
    }
  }

  /**
   * Restore notes from backup data
   * @private
   */
  restoreNotes(notes) {
    return new Promise((resolve, reject) => {
      // Try to restore to IndexedDB first (new storage method)
      const request = indexedDB.open('SkyPostDB');
      
      request.onerror = () => {
        console.warn('[BackupManager] IndexedDB not available, falling back to chrome.storage');
        this.restoreNotesToChrome(notes, resolve);
      };
      
      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(['notes'], 'readwrite');
        const store = transaction.objectStore('notes');
        
        // Clear existing notes
        store.clear();
        
        // Add all restored notes
        let addedCount = 0;
        notes.forEach(note => {
          store.add(note);
          addedCount++;
        });
        
        transaction.oncomplete = () => {
          console.log('[BackupManager] Restored', addedCount, 'notes to IndexedDB');
          resolve();
        };
        
        transaction.onerror = () => {
          console.warn('[BackupManager] Error restoring to IndexedDB, falling back to chrome.storage');
          this.restoreNotesToChrome(notes, resolve);
        };
      };
    });
  }

  /**
   * Fallback: Restore notes to chrome.storage
   * @private
   */
  restoreNotesToChrome(notes, resolve) {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [this.storageKey]: notes }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[BackupManager] Error restoring to chrome.storage, trying localStorage');
          this.restoreNotesToLocalStorage(notes);
        }
        resolve();
      });
    } else {
      this.restoreNotesToLocalStorage(notes);
      resolve();
    }
  }

  /**
   * Restore notes to localStorage
   * @private
   */
  restoreNotesToLocalStorage(notes) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(notes));
      console.log('[BackupManager] Restored notes to localStorage');
    } catch (error) {
      console.error('[BackupManager] Error restoring to localStorage:', error);
    }
  }

  /**
   * Restore settings from backup data
   * @private
   */
  restoreSettings(settings) {
    return new Promise((resolve) => {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set(settings, () => {
          if (chrome.runtime.lastError) {
            this.restoreSettingsToLocalStorage(settings);
          }
          resolve();
        });
      } else {
        this.restoreSettingsToLocalStorage(settings);
        resolve();
      }
    });
  }

  /**
   * Restore settings to localStorage
   * @private
   */
  restoreSettingsToLocalStorage(settings) {
    try {
      Object.entries(settings).forEach(([key, value]) => {
        if (typeof value === 'object') {
          localStorage.setItem(key, JSON.stringify(value));
        } else {
          localStorage.setItem(key, value);
        }
      });
    } catch (error) {
      console.error('[BackupManager] Error restoring settings to localStorage:', error);
    }
  }

  /**
   * Clear all data
   * @param {Boolean} showConfirmation - Whether to show user confirmation
   * @returns {Promise<void>}
   */
  async clearAllData(showConfirmation = true) {
    if (showConfirmation) {
      const confirm_msg = 'Delete ALL data?\n\n' +
        '• All notes\n' +
        '• All settings\n' +
        '• All preferences\n\n' +
        'This cannot be undone.';
      
      if (!confirm(confirm_msg)) {
        return;
      }
    }

    return new Promise((resolve) => {
      // Clear IndexedDB first
      const idbRequest = indexedDB.open('SkyPostDB');
      idbRequest.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(['notes'], 'readwrite');
        const store = transaction.objectStore('notes');
        store.clear();
        
        transaction.oncomplete = () => {
          console.log('[BackupManager] Cleared IndexedDB');
          this.clearChromeStorage(resolve);
        };
        
        transaction.onerror = () => {
          console.warn('[BackupManager] Error clearing IndexedDB, continuing...');
          this.clearChromeStorage(resolve);
        };
      };
      
      idbRequest.onerror = () => {
        console.warn('[BackupManager] Cannot open IndexedDB, clearing chrome.storage only');
        this.clearChromeStorage(resolve);
      };
    });
  }

  /**
   * Clear chrome.storage and localStorage
   * @private
   */
  clearChromeStorage(resolve) {
    if (chrome.storage && chrome.storage.local) {
      // Include all settings, plus license keys and backup timestamps
      const keysToDelete = [
        this.storageKey,
        ...this.settingsStorageKeys,
        'proLicenseKey',
        'proLicenseExpiry',
        'lastBackupDate',
        'lastRestoreDate'
      ];
      chrome.storage.local.remove(keysToDelete, () => {
        console.log('[BackupManager] Cleared chrome.storage');
        resolve();
      });
    } else {
      // Clear localStorage
      const allKeys = [
        this.storageKey,
        ...this.settingsStorageKeys,
        'proLicenseKey',
        'proLicenseExpiry',
        'lastBackupDate',
        'lastRestoreDate'
      ];
      allKeys.forEach(key => {
        localStorage.removeItem(key);
      });
      console.log('[BackupManager] Cleared localStorage');
      resolve();
    }
  }

  /**
   * Get notes from localStorage (fallback)
   * @private
   */
  getNotesFromLocalStorage() {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey) || '[]');
    } catch {
      return [];
    }
  }

  /**
   * Save timestamp of last backup
   * @private
   */
  saveBackupTimestamp() {
    const timestamp = Date.now().toString();
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ 'lastBackupDate': timestamp });
    }
    localStorage.setItem('lastBackupDate', timestamp);
  }

  /**
   * Save timestamp of last restore
   * @private
   */
  saveRestoreTimestamp() {
    const timestamp = Date.now().toString();
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ 'lastRestoreDate': timestamp });
    }
    localStorage.setItem('lastRestoreDate', timestamp);
  }

  /**
   * Get information about last backup
   * @returns {Promise<Object|null>} Last backup info or null if no backup exists
   */
  async getLastBackupInfo() {
    return new Promise((resolve) => {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['lastBackupDate'], (result) => {
          if (chrome.runtime.lastError || !result.lastBackupDate) {
            const localBackup = localStorage.getItem('lastBackupDate');
            if (localBackup) {
              resolve({ timestamp: parseInt(localBackup) });
            } else {
              resolve(null);
            }
          } else {
            resolve({ timestamp: parseInt(result.lastBackupDate) });
          }
        });
      } else {
        const timestamp = localStorage.getItem('lastBackupDate');
        resolve(timestamp ? { timestamp: parseInt(timestamp) } : null);
      }
    });
  }
}

// Make BackupManager globally available
if (typeof window !== 'undefined') {
  window.BackupManager = BackupManager;
}

