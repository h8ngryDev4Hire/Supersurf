/**
 * Self-contained DOM capture function — injected via chrome.scripting.executeScript
 * No imports, no closures — required by executeScript({ func })
 */

export interface PageState {
  elementCount: number;
  textContent: string[];
  shadowRootCount: number;
  iframeCount: number;
  hiddenElementCount: number;
  pageElementCount: number;
}

export function capturePageState(): PageState {
  const allElements = document.querySelectorAll('*');
  const pageElementCount = allElements.length;

  let shadowRootCount = 0;
  let iframeCount = 0;
  let hiddenElementCount = 0;
  let elementCount = 0;
  const textSet = new Set<string>();

  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i];

    if (el.shadowRoot) shadowRootCount++;
    if (el.tagName === 'IFRAME') iframeCount++;

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      hiddenElementCount++;
      continue;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    elementCount++;

    // Extract visible text via innerText (captures nested changes)
    // Skip body/html — too expensive
    const tag = el.tagName;
    if (tag !== 'BODY' && tag !== 'HTML' && (el as HTMLElement).innerText) {
      const text = (el as HTMLElement).innerText.substring(0, 200).trim();
      if (text.length > 0) {
        textSet.add(text);
      }
    }
  }

  return {
    elementCount,
    textContent: Array.from(textSet),
    shadowRootCount,
    iframeCount,
    hiddenElementCount,
    pageElementCount,
  };
}
