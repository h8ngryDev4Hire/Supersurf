/**
 * Self-contained DOM capture function — injected via chrome.scripting.executeScript
 * No imports, no closures — required by executeScript({ func })
 */
export function capturePageState() {
    const allElements = document.querySelectorAll('*');
    const pageElementCount = allElements.length;
    let shadowRootCount = 0;
    let iframeCount = 0;
    let hiddenElementCount = 0;
    let elementCount = 0;
    const textSet = new Set();
    for (let i = 0; i < allElements.length; i++) {
        const el = allElements[i];
        if (el.shadowRoot)
            shadowRootCount++;
        if (el.tagName === 'IFRAME')
            iframeCount++;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            hiddenElementCount++;
            continue;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0)
            continue;
        elementCount++;
        // Extract direct text nodes only (not children's text)
        for (let j = 0; j < el.childNodes.length; j++) {
            const node = el.childNodes[j];
            if (node.nodeType === Node.TEXT_NODE) {
                const text = (node.textContent || '').trim();
                if (text.length > 0 && text.length < 500) {
                    textSet.add(text);
                }
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
