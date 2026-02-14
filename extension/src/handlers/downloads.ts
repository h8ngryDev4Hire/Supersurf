/**
 * Download handler using chrome.downloads API
 */

import { Logger } from '../utils/logger.js';

interface DownloadResult {
  success: boolean;
  downloadId?: number;
  filePath?: string;
  fileSize?: number;
  mimeType?: string;
  error?: string;
}

export class DownloadHandler {
  private browser: typeof chrome;
  private logger: Logger;

  constructor(browserAPI: typeof chrome, logger: Logger) {
    this.browser = browserAPI;
    this.logger = logger;
  }

  async download(params: { url: string; filename?: string }): Promise<DownloadResult> {
    const { url, filename } = params;

    if (!url) {
      return { success: false, error: 'URL is required' };
    }

    return new Promise<DownloadResult>((resolve) => {
      const opts: chrome.downloads.DownloadOptions = { url, saveAs: false };
      if (filename) {
        opts.filename = filename;
      }

      this.browser.downloads.download(opts, (downloadId) => {
        if (this.browser.runtime.lastError) {
          resolve({
            success: false,
            error: this.browser.runtime.lastError.message || 'Download failed to start',
          });
          return;
        }

        if (downloadId === undefined) {
          resolve({ success: false, error: 'Download failed to start' });
          return;
        }

        this.logger.log(`[Downloads] Started download ${downloadId} for ${url}`);

        // Monitor for completion
        const onChange = (delta: chrome.downloads.DownloadDelta) => {
          if (delta.id !== downloadId) return;
          if (!delta.state) return;

          if (delta.state.current === 'complete') {
            this.browser.downloads.onChanged.removeListener(onChange);
            // Fetch final item info
            this.browser.downloads.search({ id: downloadId }, (items) => {
              const item = items?.[0];
              if (item) {
                this.logger.log(`[Downloads] Complete: ${item.filename} (${item.fileSize} bytes)`);
                resolve({
                  success: true,
                  downloadId,
                  filePath: item.filename,
                  fileSize: item.fileSize,
                  mimeType: item.mime,
                });
              } else {
                resolve({ success: true, downloadId });
              }
            });
          } else if (delta.state.current === 'interrupted') {
            this.browser.downloads.onChanged.removeListener(onChange);
            // Get error info
            this.browser.downloads.search({ id: downloadId }, (items) => {
              const item = items?.[0];
              const error = item?.error || 'Download interrupted';
              this.logger.log(`[Downloads] Interrupted: ${error}`);
              resolve({ success: false, downloadId, error: String(error) });
            });
          }
        };

        this.browser.downloads.onChanged.addListener(onChange);

        // Timeout after 5 minutes
        setTimeout(() => {
          this.browser.downloads.onChanged.removeListener(onChange);
          resolve({ success: false, downloadId, error: 'Download timed out (5m)' });
        }, 5 * 60 * 1000);
      });
    });
  }
}
