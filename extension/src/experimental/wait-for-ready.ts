/**
 * DOM stability detection — injected via chrome.scripting.executeScript
 * No imports, no closures — required by executeScript({ func })
 */

export function waitForDOMStable(stabilityMs: number = 300): Promise<{ stable: boolean }> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;

    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        observer.disconnect();
        resolve({ stable: true });
      }, stabilityMs);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial timer — resolves if no mutations happen within stabilityMs
    timer = setTimeout(() => {
      observer.disconnect();
      resolve({ stable: true });
    }, stabilityMs);
  });
}
