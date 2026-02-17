/**
 * SuperSurf popup UI — state management, event handling, lifecycle.
 * Templates live in popup.templates.ts.
 */

import { renderMain, renderSettings } from './popup.templates.js';
import type { PopupState } from './popup.templates.js';

const browserAPI = chrome;

const state: PopupState = {
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
  domainWhitelistEnabled: false,
};

async function loadState(): Promise<void> {
  const result = await browserAPI.storage.local.get([
    'extensionEnabled', 'mcpPort', 'debugMode', 'domainWhitelistEnabled',
  ]);
  state.enabled = result.extensionEnabled !== false;
  state.port = result.mcpPort || '5555';
  state.debugMode = result.debugMode === true;
  state.domainWhitelistEnabled = result.domainWhitelistEnabled === true;

  const manifest = browserAPI.runtime.getManifest();
  state.version = manifest.version;
}

async function updateStatus(): Promise<void> {
  try {
    const response: any = await browserAPI.runtime.sendMessage({ type: 'getStatus' });
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

async function toggleEnabled(): Promise<void> {
  state.enabled = !state.enabled;
  await browserAPI.storage.local.set({ extensionEnabled: state.enabled });
  render();

  (browserAPI.runtime.sendMessage({
    type: state.enabled ? 'enableExtension' : 'disableExtension',
  }) as unknown as Promise<any>).catch(() => {});
}

async function saveSettings(): Promise<void> {
  await browserAPI.storage.local.set({
    mcpPort: state.port,
    debugMode: state.debugMode,
    domainWhitelistEnabled: state.domainWhitelistEnabled,
  });

  // Notify background to enable/disable whitelist
  (browserAPI.runtime.sendMessage({
    type: state.domainWhitelistEnabled ? 'enableWhitelist' : 'disableWhitelist',
  }) as unknown as Promise<any>).catch(() => {});

  state.showSettings = false;
  render();
}

function cancelSettings(): void {
  state.showSettings = false;
  render();
}

function render(): void {
  const root = document.getElementById('root');
  if (!root) return;

  root.innerHTML = state.showSettings ? renderSettings(state) : renderMain(state);
  attachEventListeners();
}

function attachEventListeners(): void {
  if (state.showSettings) {
    document.getElementById('saveButton')?.addEventListener('click', saveSettings);
    document.getElementById('cancelButton')?.addEventListener('click', cancelSettings);

    document.getElementById('portInput')?.addEventListener('input', (e) => {
      state.port = (e.target as HTMLInputElement).value;
    });

    document.getElementById('debugModeCheckbox')?.addEventListener('change', (e) => {
      state.debugMode = (e.target as HTMLInputElement).checked;
    });

    document.getElementById('domainWhitelistCheckbox')?.addEventListener('change', (e) => {
      state.domainWhitelistEnabled = (e.target as HTMLInputElement).checked;
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

    browserAPI.runtime.onMessage.addListener((message: { type: string }) => {
      if (message.type === 'statusChanged') updateStatus();
    });

    browserAPI.tabs.onActivated.addListener(() => updateStatus());

    browserAPI.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        if (changes.extensionEnabled) {
          state.enabled = changes.extensionEnabled.newValue !== false;
          render();
        }
        if (changes.domainWhitelistEnabled) {
          state.domainWhitelistEnabled = changes.domainWhitelistEnabled.newValue === true;
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
