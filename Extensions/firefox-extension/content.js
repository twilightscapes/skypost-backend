// Content script - Injects workspace as floating overlay
(function() {
  
  if (window.__floatingNotesInitialized) {
    return;
  }
  window.__floatingNotesInitialized = true;

  // Listen for messages from background script or popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'showOverlay' || request.action === 'togglePanel') {
      try {
        injectOverlay();
        sendResponse({ message: 'Overlay shown' });
      } catch (error) {
        console.error('[FloatingNotes] Error injecting overlay:', error);
        sendResponse({ error: error.message });
      }
    }
  });

  // Function to inject the notes overlay
  function injectOverlay() {
    
    // Check if overlay already exists
    if (document.getElementById('floating-notes-overlay')) {
      document.getElementById('floating-notes-overlay').classList.add('visible');
      return;
    }

    // Create overlay container
    const overlay = document.createElement('div');
    overlay.id = 'floating-notes-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.4);
      z-index: 9998;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    overlay.classList.add('visible');

    // Create iframe to host the workspace
    const iframe = document.createElement('iframe');
    iframe.id = 'floating-notes-iframe';
    iframe.src = chrome.runtime.getURL('workspace.html');
    iframe.style.cssText = `
      position: relative;
      width: 90%;
      height: 90%;
      max-width: 1400px;
      max-height: 800px;
      border: none;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      background: white;
    `;
    
    iframe.onload = () => {
    };
    
    iframe.onerror = (error) => {
      console.error('[FloatingNotes] Iframe load error:', error);
    };

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = `
      position: fixed;
      top: 30px;
      right: 30px;
      width: 40px;
      height: 40px;
      border: none;
      background: white;
      border-radius: 50%;
      font-size: 24px;
      cursor: pointer;
      z-index: 10000;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    
    closeBtn.onmouseover = () => {
      closeBtn.style.background = '#f0f0f0';
      closeBtn.style.transform = 'scale(1.1)';
    };
    closeBtn.onmouseout = () => {
      closeBtn.style.background = 'white';
      closeBtn.style.transform = 'scale(1)';
    };
    
    closeBtn.onclick = () => {
      overlay.remove();
      closeBtn.remove();
    };

    overlay.appendChild(iframe);
    document.body.appendChild(overlay);
    document.body.appendChild(closeBtn);
    

    // Close on background click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        closeBtn.remove();
      }
    });

    // Close on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.parentElement) {
        overlay.remove();
        closeBtn.remove();
      }
    });
  }

  // Keyboard shortcut to open workspace (Cmd+Shift+M on Mac, Ctrl+Shift+M on Windows/Linux)
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      injectOverlay();
    }
  });
})();
