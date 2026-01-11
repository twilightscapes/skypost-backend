// Popup script
(function() {
  console.log('[Popup] Script starting');
  
  // Note: Main note data is stored in IndexedDB in workspace.
  // Popup only manages extension settings via chrome.storage.sync
  
  // Update storage usage display
  async function updateStorageDisplay() {
    console.log('[Popup] updateStorageDisplay called');
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        const used = estimate.usage || 0;
        const quota = estimate.quota || 0;
        const percent = quota > 0 ? (used / quota) * 100 : 0;
        
        console.log('[Popup] Storage:', used, 'of', quota, '=', percent + '%');
        
        // Update bar
        const bar = document.getElementById('storageBar');
        if (bar) bar.style.width = percent + '%';
        
        // Format bytes to readable format
        const formatBytes = (bytes) => {
          if (bytes === 0) return '0 B';
          const k = 1024;
          const sizes = ['B', 'KB', 'MB', 'GB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
        };
        
        const stats = document.getElementById('storageStats');
        if (stats) {
          stats.textContent = `${formatBytes(used)} of ${formatBytes(quota)} (${Math.round(percent)}%)`;
          console.log('[Popup] Stats updated');
        }
        
        // Show request button (always visible for testing)
        const requestBtn = document.getElementById('requestStorageBtn');
        if (requestBtn) {
          requestBtn.style.display = 'block';
          console.log('[Popup] Request button shown');
        }
      } else {
        console.warn('[Popup] navigator.storage not available');
      }
    } catch (error) {
      console.error('[Popup] Storage error:', error);
    }
  }
  
  // Request persistent storage - opens workspace to request
  function requestPersistentStorage() {
    console.log('[Popup] Opening workspace to request persistent storage');
    chrome.runtime.sendMessage({ action: 'openWorkspace' }, (response) => {
      console.log('[Popup] Workspace opened');
    });
  }
  
  // Wait for DOM to be ready
  function init() {
    console.log('[Popup] Init called');
    
    const openNotesBtn = document.getElementById('openNotes');
    console.log('[Popup] openNotes button:', openNotesBtn);
    
    if (openNotesBtn) {
      console.log('[Popup] Adding click listener');
      openNotesBtn.onclick = function(e) {
        console.log('[Popup] Button clicked!');
        e.preventDefault();
        e.stopPropagation();
        
        console.log('[Popup] Sending message to background');
        chrome.runtime.sendMessage({ action: 'openWorkspace' }, (response) => {
          console.log('[Popup] Got response:', response);
        });
        return false;
      };
    } else {
      console.error('[Popup] Button not found!');
    }
    
    const enableExtensionCheckbox = document.getElementById('enableExtension');
    if (enableExtensionCheckbox) {
      enableExtensionCheckbox.onchange = function(e) {
        chrome.storage.sync.set({ extensionEnabled: e.target.checked });
      };
    }
    
    chrome.storage.sync.get('extensionEnabled', (data) => {
      if (enableExtensionCheckbox) {
        enableExtensionCheckbox.checked = data.extensionEnabled !== false;
      }
    });
    
    console.log('[Popup] Calling updateStorageDisplay');
    updateStorageDisplay();
    
    // Add request storage button listener
    const requestBtn = document.getElementById('requestStorageBtn');
    if (requestBtn) {
      requestBtn.onclick = requestPersistentStorage;
      console.log('[Popup] Request button listener added');
    }
    
    // Check if Pro user and show indicator
    try {
      if (typeof licenseManager !== 'undefined' && licenseManager.isProUser()) {
        const proIndicator = document.getElementById('proIndicator');
        if (proIndicator) {
          proIndicator.innerHTML = '<span class="pro-badge">PRO</span>';
          console.log('[Popup] Pro badge added');
        }
      }
    } catch (e) {
      console.warn('[Popup] Could not check license:', e);
    }
  }
  
  // Try init immediately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // Also try after a small delay
  setTimeout(init, 100);
})();
