/**
 * SuperSurf popup UI — simplified from Blueprint MCP
 * Enable/disable toggle, port config, status display
 */

const browserAPI = chrome;

const state = {
  enabled: true,
  anyConnected: false,
  currentTabConnected: false,
  stealthMode: null,
  connecting: false,
  showSettings: false,
  debugMode: false,
  port: '5555',
  version: '0.1.0',
  projectName: null,
};

async function loadState() {
  const result = await browserAPI.storage.local.get([
    'extensionEnabled', 'mcpPort', 'debugMode',
  ]);
  state.enabled = result.extensionEnabled !== false;
  state.port = result.mcpPort || '5555';
  state.debugMode = result.debugMode === true;

  const manifest = browserAPI.runtime.getManifest();
  state.version = manifest.version;
}

async function updateStatus() {
  try {
    const response = await browserAPI.runtime.sendMessage({ type: 'getStatus' });
    if (response) {
      state.anyConnected = response.connected || false;
      state.currentTabConnected = response.currentTabConnected || false;
      state.stealthMode = response.stealthMode ?? null;
      state.projectName = response.projectName || null;
    }
  } catch {
    // Background may not be ready
  }
  render();
}

async function toggleEnabled() {
  state.enabled = !state.enabled;
  await browserAPI.storage.local.set({ extensionEnabled: state.enabled });
  render();

  // Notify background
  browserAPI.runtime.sendMessage({
    type: state.enabled ? 'enableExtension' : 'disableExtension',
  }).catch(() => {});
}

async function saveSettings() {
  await browserAPI.storage.local.set({
    mcpPort: state.port,
    debugMode: state.debugMode,
  });
  state.showSettings = false;
  render();
}

function cancelSettings() {
  state.showSettings = false;
  render();
}

function render() {
  const root = document.getElementById('root');
  if (!root) return;

  root.innerHTML = state.showSettings ? renderSettings() : renderMain();
  attachEventListeners();
}

function renderMain() {
  const statusClass = state.connecting ? 'connecting' : state.anyConnected ? 'connected' : 'disconnected';
  const statusText = state.connecting ? 'Connecting' : state.anyConnected ? 'Connected' : 'Disconnected';

  return `
    <div class="popup-container">
      <div class="popup-header">
        <h1>SuperSurf<span class="version-label">v${state.version}</span></h1>
      </div>

      <div class="popup-content">
        <div class="status-row">
          <span class="status-label">Status:</span>
          <div class="status-indicator">
            <span class="status-dot ${statusClass}"></span>
            <span class="status-text">${statusText}</span>
          </div>
        </div>

        <div class="status-row">
          <span class="status-label">This tab:</span>
          <span class="status-text">${state.currentTabConnected ? '✓ Automated' : 'Not automated'}</span>
        </div>

        ${state.currentTabConnected && state.projectName ? `
          <div class="status-row">
            <span class="status-label"></span>
            <span class="status-text" style="font-size: 0.9em; color: #666">
              ${state.projectName}
            </span>
          </div>
        ` : ''}

        ${state.currentTabConnected ? `
          <div class="status-row">
            <span class="status-label">Stealth:</span>
            <span class="status-text">
              ${state.stealthMode === null ? 'N/A' : state.stealthMode ? 'On' : 'Off'}
            </span>
          </div>
        ` : ''}

        <div class="toggle-row">
          <button
            class="toggle-button ${state.enabled ? 'enabled' : 'disabled'}"
            id="toggleButton"
          >
            ${state.enabled ? 'Disable' : 'Enable'}
          </button>
        </div>

        <div class="links-section">
          <button class="settings-link" id="settingsButton">
            Settings
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderSettings() {
  return `
    <div class="popup-container">
      <div class="popup-header">
        <h1>SuperSurf<span class="version-label">Settings</span></h1>
      </div>

      <div class="popup-content">
        <div class="settings-form">
          <label class="settings-label">
            MCP Server Port:
            <input
              type="number"
              class="settings-input"
              id="portInput"
              value="${state.port}"
              min="1"
              max="65535"
              placeholder="5555"
            />
          </label>
          <p class="settings-help">
            Default: 5555. Change if your MCP server uses a different port.
          </p>

          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e0e0e0">
            <label class="settings-label" style="flex-direction: row; align-items: center; cursor: pointer">
              <input
                type="checkbox"
                id="debugModeCheckbox"
                ${state.debugMode ? 'checked' : ''}
                style="width: 16px; height: 16px; margin-right: 8px; cursor: pointer"
              />
              <span>Debug Mode</span>
            </label>
            <p class="settings-help" style="margin-top: 4px; margin-left: 24px">
              Enable detailed logging for troubleshooting
            </p>
          </div>
        </div>

        <div class="settings-actions">
          <button class="settings-button save" id="saveButton">Save</button>
          <button class="settings-button cancel" id="cancelButton">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function attachEventListeners() {
  if (state.showSettings) {
    document.getElementById('saveButton')?.addEventListener('click', saveSettings);
    document.getElementById('cancelButton')?.addEventListener('click', cancelSettings);

    document.getElementById('portInput')?.addEventListener('input', (e) => {
      state.port = e.target.value;
    });

    document.getElementById('debugModeCheckbox')?.addEventListener('change', (e) => {
      state.debugMode = e.target.checked;
    });
  } else {
    document.getElementById('toggleButton')?.addEventListener('click', toggleEnabled);
    document.getElementById('settingsButton')?.addEventListener('click', () => {
      state.showSettings = true;
      render();
    });
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadState();
    await updateStatus();

    browserAPI.runtime.onMessage.addListener((message) => {
      if (message.type === 'statusChanged') updateStatus();
    });

    browserAPI.tabs.onActivated.addListener(() => updateStatus());

    browserAPI.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        if (changes.extensionEnabled) {
          state.enabled = changes.extensionEnabled.newValue !== false;
          render();
        }
      }
    });
  } catch (error) {
    const root = document.getElementById('root');
    if (root) {
      root.innerHTML = `<div class="popup-container"><p style="color:red">Error: ${error}</p></div>`;
    }
  }
});
