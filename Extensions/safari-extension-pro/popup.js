// Popup script
(function() {
  console.log('[Popup] Script starting');
  
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
