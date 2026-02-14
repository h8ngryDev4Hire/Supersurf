/**
 * ExperimentalFeatures — registers all experimental command handlers on the WebSocket connection
 * Keeps experimental logic isolated from stable code
 */
import { capturePageState } from './capture-page-state.js';
import { waitForDOMStable } from './wait-for-ready.js';
export class ExperimentalFeatures {
    static registerHandlers(wsConnection, tabHandlers, networkTracker, sessionContext) {
        // capturePageState — injects DOM capture into the page, returns PageState
        wsConnection.registerCommandHandler('capturePageState', async () => {
            const tabId = tabHandlers.getAttachedTabId();
            if (!tabId)
                throw new Error('No tab attached');
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                func: capturePageState,
            });
            if (!results?.[0]?.result) {
                throw new Error('Failed to capture page state');
            }
            return results[0].result;
        });
        // waitForReady — DOM stability + network idle race with overall timeout
        wsConnection.registerCommandHandler('waitForReady', async (params) => {
            const tabId = tabHandlers.getAttachedTabId();
            if (!tabId)
                throw new Error('No tab attached');
            const timeout = params?.timeout || 10000;
            const start = Date.now();
            // DOM stability via injected script
            const domStablePromise = chrome.scripting.executeScript({
                target: { tabId },
                func: waitForDOMStable,
                args: [300],
            });
            // Network idle polling
            const networkIdlePromise = pollNetworkIdle(networkTracker, 500, timeout);
            // Race: both signals vs overall timeout
            await Promise.race([
                Promise.all([domStablePromise, networkIdlePromise]),
                new Promise(resolve => setTimeout(resolve, timeout)),
            ]);
            return { ready: true, elapsed: Date.now() - start };
        });
    }
}
/**
 * Poll networkTracker for 0 pending requests over idleMs.
 * A request is "pending" if it has no statusCode and no error.
 */
function pollNetworkIdle(tracker, idleMs, timeout) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        let idleSince = null;
        const interval = setInterval(() => {
            const requests = tracker.getRequests();
            const pending = requests.filter(r => !r.statusCode && !r.error);
            if (pending.length === 0) {
                if (idleSince === null) {
                    idleSince = Date.now();
                }
                else if (Date.now() - idleSince >= idleMs) {
                    clearInterval(interval);
                    resolve();
                }
            }
            else {
                idleSince = null;
            }
            if (Date.now() - startTime >= timeout) {
                clearInterval(interval);
                resolve(); // Resolve on timeout — don't block forever
            }
        }, 200);
    });
}
