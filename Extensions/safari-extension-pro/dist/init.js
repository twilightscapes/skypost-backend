// Initialize workspace and Bluesky after page load

// Global error handler to catch all errors
window.addEventListener('error', (event) => {
  console.error('[Global Error]', event.error?.message, event.error?.stack);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Promise Rejection]', event.reason);
});

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof NotesWorkspace !== 'undefined' && typeof BlueskyIntegration !== 'undefined') {
    window.licenseManager = new LicenseManager();
    await window.licenseManager.loadLicense();
    window.workspace = new NotesWorkspace();
    await window.workspace.init();
    window.bluesky = new BlueskyIntegration();
    
    // Setup Pro Settings modal
    setupProModal();
    
    // Show pro storage dashboard if user is pro (will be called after init)
    if (window.workspace && window.workspace.isPro) {
      console.log('[Init] User is pro, will show dashboard after workspace loads');
      // Dashboard will be shown by setupProStorageDashboard in workspace initialization
    }
  } else {
    console.error('[Init] Classes not defined yet - NotesWorkspace:', typeof NotesWorkspace, 'BlueskyIntegration:', typeof BlueskyIntegration);
  }
});

// Fallback if DOM already loaded
if (document.readyState !== 'loading') {
  console.log('[Init] DOM already loaded, using fallback');
  if (typeof NotesWorkspace !== 'undefined' && typeof BlueskyIntegration !== 'undefined') {
    console.log('[Init] Classes defined in fallback, creating instances...');
    window.licenseManager = new LicenseManager();
    window.licenseManager.loadLicense().then(() => {
      console.log('[Init] License loaded in fallback');
      window.workspace = new NotesWorkspace();
      console.log('[Init] Workspace created in fallback');
      window.bluesky = new BlueskyIntegration();
      console.log('[Init] Bluesky created in fallback');
      
      // Setup Pro Settings modal
      setupProModal();
      console.log('[Init] Setup complete in fallback');
      
      // Show pro storage dashboard if user is pro
      if (window.workspace && window.workspace.isPro) {
        console.log('[Init Fallback] User is pro, will show dashboard after workspace loads');
        // Dashboard will be shown by setupProStorageDashboard in workspace initialization
      }
    });
  } else {
    console.error('[Init] Classes not defined in fallback');
  }
}

function setupProModal() {
  const proBtn = document.getElementById('pro-settings-btn');
  const modal = document.getElementById('pro-modal');
  const closeBtn = document.getElementById('pro-modal-close');
  
  if (!proBtn || !modal) return;
  
  // Update button appearance on initial load
  updateProButton(window.licenseManager.isProUser());
  
  // Open modal on button click
  proBtn.addEventListener('click', () => {
    window.renderProModal();
    modal.classList.add('active');
  });
  
  // Close modal on close button
  closeBtn.addEventListener('click', () => {
    modal.classList.remove('active');
  });
  
  // Close modal on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
}

function updateProButton(isPro) {
  const btn = document.getElementById('pro-settings-btn');
  if (!btn) return;
  
  if (isPro) {
    // Show gear icon for pro users - small button
    btn.textContent = '⚙️';
    btn.title = 'Pro Settings';
    btn.setAttribute('style', 'background: #667eea !important; border: none !important; padding: 4px 8px !important; font-size: 18px !important; cursor: pointer !important; border-radius: 4px !important;');
  } else {
    // Show "Upgrade" text for non-pro users - larger button
    btn.textContent = 'Upgrade';
    btn.title = 'Upgrade to Pro';
    btn.setAttribute('style', 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important; color: white !important; padding: 12px 28px !important; font-size: 14px !important; font-weight: 600 !important; border: none !important; border-radius: 4px !important; cursor: pointer !important; white-space: nowrap !important; min-width: 100px !important;');
  }
}

window.renderProModal = async function() {
  console.log('[ProModal] Rendering pro modal...');
  const body = document.getElementById('pro-modal-body');
  console.log('[ProModal] Body element:', body);
  
  const isPro = window.licenseManager.isProUser();
  const features = window.licenseManager.getFeatureList();
  
  // Update button appearance based on pro status
  updateProButton(isPro);
  
  let html = `
    <div style="margin-bottom: 24px;">
      <div style="background: #f5f5f5; border-radius: 8px; padding: 24px; text-align: center;">
        <div style="display: inline-block; padding: 12px 24px; border-radius: 20px; font-size: 18px; font-weight: 600; ${isPro ? 'background: #d4edda; color: #155724;' : 'background: #f8d7da; color: #721c24;'}">
          ${isPro ? '✓ PRO ACTIVE' : '✗ FREE PLAN'}
        </div>
      </div>
    </div>
  `;
  
  // Upgrade box
  if (!isPro) {
    html += `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 24px;">
        <h2 style="margin: 0 0 10px 0;">Upgrade to Pro</h2>
        <div style="font-size: 32px; font-weight: bold; margin: 10px 0;">$9.99/month</div>
        <div style="font-size: 13px; margin: 15px 0; line-height: 1.6;">
          ✓ Unlimited scheduled posts<br>
          ✓ Post analytics & engagement tracking<br>
          ✓ Custom link & video cards<br>
          ✓ Priority support
        </div>
        <button id="pricing-page-btn" style="margin-top: 15px; width: 100%; padding: 12px 24px; background: white; color: #667eea; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer;">
          Get Pro Access
        </button>
      </div>
    `;
  }
  
  // Features grid
  html += `<div style="margin-bottom: 24px;"><div style="font-weight: 600; color: #333; margin-bottom: 12px; font-size: 16px;">Available Features</div>`;
  html += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">`;
  
  features.free.forEach(f => {
    html += `
      <div style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px; text-align: center;">
        <div style="font-size: 16px; margin-bottom: 4px;">✓</div>
        <div style="font-weight: 600; font-size: 13px; color: #333;">${f.name}</div>
        ${f.limit ? `<div style="font-size: 11px; color: #999;">${f.limit}</div>` : ''}
      </div>
    `;
  });
  
  features.pro.forEach(f => {
    html += `
      <div style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px; text-align: center; ${!isPro ? 'opacity: 0.6; background: #f9f9f9;' : ''}">
        <div style="font-size: 16px; margin-bottom: 4px;">${!isPro ? '🔒' : '⭐'}</div>
        <div style="font-weight: 600; font-size: 13px; color: #333;">${f.name}</div>
      </div>
    `;
  });
  
  html += '</div></div>';
  
  // License activation section (for free users)
  if (!isPro) {
    html += `
      <div style="margin-top: 24px; border-top: 1px solid #e0e0e0; padding-top: 24px;">
        <div style="font-weight: 600; color: #333; margin-bottom: 16px; font-size: 16px;">🔑 Already have a license?</div>
        <div style="display: flex; gap: 8px; margin-bottom: 16px;">
          <input type="text" id="license-key-input" placeholder="Paste your license key here..." style="flex: 1; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; font-family: monospace;">
          <button id="license-activate-btn" style="padding: 10px 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 14px;">
            Activate
          </button>
        </div>
        <div id="license-message" style="display: none; padding: 12px; border-radius: 6px; font-size: 13px; margin-bottom: 16px;"></div>
      </div>
    `;
  }
  
  // Pro user management section
  if (isPro) {
    html += `
      <div style="margin-top: 24px; border-top: 1px solid #e0e0e0; padding-top: 24px;">
        <div style="font-weight: 600; color: #333; margin-bottom: 16px; font-size: 16px;">📋 Account Management</div>
        
        <div style="display: grid; gap: 12px;">
          <button id="backup-btn" style="padding: 12px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 14px;">
            💾 Backup All Data
          </button>
          <button id="restore-btn" style="padding: 12px; background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 14px;">
            📥 Restore from Backup
          </button>
          <button id="clear-data-btn" style="padding: 12px; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 14px;">
            🗑️ Delete All Data & Remove License
          </button>
        </div>
      </div>
    `;
  }
  
  html += '</div></div>';
  
  // Close button
  html += `
    <div style="display: flex; gap: 12px; margin-top: 20px;">
      <button id="close-modal-btn" style="flex: 1; padding: 12px; background: #f0f0f0; color: #333; border: none; border-radius: 6px; font-weight: 600; cursor: pointer;">
        Close
      </button>
    </div>
  `;
  
  console.log('[ProModal] Setting innerHTML, length:', html.length);
  body.innerHTML = html;
  console.log('[ProModal] innerHTML set, body content:', body.innerHTML.substring(0, 100));
  
  // Setup button listeners
  const closeBtn = document.getElementById('close-modal-btn');
  const pricingBtn = document.getElementById('pricing-page-btn');
  
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      document.getElementById('pro-modal').classList.remove('active');
    });
  }
  
  if (pricingBtn) {
    pricingBtn.addEventListener('click', async () => {
      try {
        // Create checkout session
        const response = await fetch('https://skypost-backend-production.up.railway.app/api/subscriptions/create-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });

        const data = await response.json();
        console.log('[Checkout] Response:', { status: response.status, data });
        
        if (!response.ok) {
          throw new Error(`Backend error: ${data.error || data.message || 'Unknown error'}`);
        }
        
        if (data.sessionUrl) {
          // Just open Stripe, success page will show the key after payment
          chrome.tabs.create({ url: data.sessionUrl });
        } else {
          alert('Failed to create checkout session');
        }
      } catch (err) {
        console.error('[Checkout] Error:', err);
        alert('Checkout error: ' + err.message);
      }
    });
  }
  
  // License activation handler
  const licenseActivateBtn = document.getElementById('license-activate-btn');
  const licenseKeyInput = document.getElementById('license-key-input');
  const licenseMessage = document.getElementById('license-message');
  
  if (licenseActivateBtn) {
    licenseActivateBtn.addEventListener('click', async () => {
      const key = licenseKeyInput.value.trim();
      if (!key) {
        licenseMessage.style.display = 'block';
        licenseMessage.style.background = '#f8d7da';
        licenseMessage.style.color = '#721c24';
        licenseMessage.style.border = '1px solid #f5c6cb';
        licenseMessage.textContent = 'Please enter a license key';
        return;
      }
      
      try {
        licenseActivateBtn.disabled = true;
        licenseActivateBtn.textContent = 'Activating...';
        
        const result = await window.licenseManager.activateLicense(key);
        
        if (result.success) {
          licenseMessage.style.display = 'block';
          licenseMessage.style.background = '#d4edda';
          licenseMessage.style.color = '#155724';
          licenseMessage.style.border = '1px solid #c3e6cb';
          licenseMessage.textContent = '✅ ' + result.message;
          licenseKeyInput.value = '';
          
          // Reload workspace's Pro tab state
          if (window.workspace) {
            console.log('[License] window.workspace exists:', !!window.workspace);
            window.workspace.isPro = true;
            console.log('[License] ✅ isPro flag set to true');
            
            // Now show the pro storage dashboard
            if (window.workspace && typeof window.workspace.setupProStorageDashboard === 'function') {
              try {
                console.log('[License] Calling setupProStorageDashboard()...');
                window.workspace.setupProStorageDashboard();
                console.log('[License] ✅ setupProStorageDashboard() executed');
              } catch (err) {
                console.error('[License] Error in setupProStorageDashboard:', err);
              }
            } else {
              console.warn('[License] setupProStorageDashboard not available');
            }
          } else {
            console.warn('[License] window.workspace is not available');
          }
          
          // Reload modal to show pro features
          setTimeout(() => {
            window.renderProModal();
            // Reload page after 2 seconds to fully initialize pro features
            setTimeout(() => {
              location.reload();
            }, 2000);
          }, 1500);
        } else {
          licenseMessage.style.display = 'block';
          licenseMessage.style.background = '#f8d7da';
          licenseMessage.style.color = '#721c24';
          licenseMessage.style.border = '1px solid #f5c6cb';
          licenseMessage.textContent = '❌ ' + (result.error || 'Activation failed');
        }
      } catch (err) {
        licenseMessage.style.display = 'block';
        licenseMessage.style.background = '#f8d7da';
        licenseMessage.style.color = '#721c24';
        licenseMessage.style.border = '1px solid #f5c6cb';
        licenseMessage.textContent = '❌ ' + err.message;
      } finally {
        licenseActivateBtn.disabled = false;
        licenseActivateBtn.textContent = 'Activate';
      }
    });
  }
  
  // Pro user management handlers - setup inside renderProModal so they attach to dynamically created elements
  if (isPro) {
    const backupBtn = document.getElementById('backup-btn');
    const restoreBtn = document.getElementById('restore-btn');
    const clearDataBtn = document.getElementById('clear-data-btn');
    
    if (backupBtn && window.workspace && window.workspace.backupManager) {
      backupBtn.addEventListener('click', async () => {
        try {
          const result = await window.workspace.backupManager.createBackup();
          if (result.success) {
            alert(`✅ Backup created successfully!\n${result.count} notes backed up`);
          } else {
            alert(`❌ Backup failed: ${result.error}`);
          }
        } catch (error) {
          alert('❌ Backup error: ' + error.message);
        }
      });
    }
    
    if (restoreBtn) {
      restoreBtn.addEventListener('click', () => {
        // Create hidden file input
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.onchange = async (e) => {
          const file = e.target.files[0];
          if (file && window.workspace && window.workspace.backupManager) {
            try {
              const preview = await window.workspace.backupManager.previewBackup(file);
              if (preview.success) {
                const confirmMsg = `Restore backup from ${preview.date}?\n\nThis will restore:\n• ${preview.noteCount} notes\n• ${preview.settingCount} settings\n\nCurrent data will be replaced.`;
                if (confirm(confirmMsg)) {
                  const progressDiv = document.createElement('div');
                  progressDiv.innerHTML = `<div style="padding: 16px; background: #d1ecf1; color: #0c5460; border-radius: 6px; margin-top: 12px;">Restoring data...</div>`;
                  document.getElementById('pro-modal-body').appendChild(progressDiv);
                  
                  const result = await window.workspace.backupManager.restoreBackup(file, (msg) => {
                    progressDiv.innerHTML = `<div style="padding: 16px; background: #d1ecf1; color: #0c5460; border-radius: 6px; margin-top: 12px;">${msg}</div>`;
                  });
                  
                  if (result.success) {
                    alert('✅ Data restored successfully! Reloading...');
                    setTimeout(() => window.location.reload(), 1000);
                  } else {
                    alert('❌ Restore failed: ' + result.error);
                    progressDiv.remove();
                  }
                }
              } else {
                alert('❌ Invalid backup file: ' + preview.error);
              }
            } catch (error) {
              alert('❌ Restore error: ' + error.message);
            }
          }
        };
        fileInput.click();
      });
    }
    
    if (clearDataBtn) {
      clearDataBtn.addEventListener('click', async () => {
        const confirmMsg = 'This will PERMANENTLY delete:\n\n• All notes\n• All settings\n• Your Pro license\n\nThis CANNOT be undone. Are you absolutely sure?';
        if (confirm(confirmMsg)) {
          const secondConfirm = 'Type YES to confirm deletion:';
          const response = prompt(secondConfirm);
          if (response === 'YES') {
            // Clear all data
            if (window.workspace && window.workspace.backupManager) {
              await window.workspace.backupManager.clearAllData(false);
              // Clear license
              if (window.licenseManager) {
                await window.licenseManager.deactivateLicense();
              }
              alert('✅ All data and license removed. Reloading extension...');
              setTimeout(() => window.location.reload(), 1000);
            }
          }
        }
      });
    }
  }
}
  
