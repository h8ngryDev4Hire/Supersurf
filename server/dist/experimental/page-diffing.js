"use strict";
/**
 * Page diffing utilities — compares DOM snapshots before/after interactions
 * Part of SuperSurf experimental features
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.diffSnapshots = diffSnapshots;
exports.calculateConfidence = calculateConfidence;
exports.formatDiffSection = formatDiffSection;
function diffSnapshots(before, after) {
    const beforeSet = new Set(before.textContent);
    const afterSet = new Set(after.textContent);
    const added = after.textContent.filter(t => !beforeSet.has(t));
    const removed = before.textContent.filter(t => !afterSet.has(t));
    const countDelta = after.elementCount - before.elementCount;
    return { added, removed, countDelta };
}
function calculateConfidence(state) {
    let confidence = 1.0;
    // Flat penalties — shadow DOM and iframes reduce visibility but don't invalidate the diff
    if (state.shadowRootCount > 0)
        confidence -= 0.05;
    if (state.iframeCount > 0)
        confidence -= 0.05;
    if (state.pageElementCount > 5000)
        confidence -= 0.05;
    // Hidden elements: no penalty (every page has them)
    return Math.max(0, confidence);
}
function formatDiffSection(diff, confidence, state) {
    let label = `**Page diff** (confidence: ${Math.round(confidence * 100)}%)`;
    if (state && (state.shadowRootCount > 0 || state.iframeCount > 0)) {
        label += ' (partial — shadow DOM/iframes present)';
    }
    const parts = ['\n\n---', label];
    if (diff.countDelta !== 0) {
        parts.push(`Elements: ${diff.countDelta > 0 ? '+' : ''}${diff.countDelta}`);
    }
    if (diff.added.length > 0) {
        const shown = diff.added.slice(0, 5);
        parts.push(`Added text: ${shown.map(t => `"${t.length > 60 ? t.slice(0, 57) + '...' : t}"`).join(', ')}${diff.added.length > 5 ? ` (+${diff.added.length - 5} more)` : ''}`);
    }
    if (diff.removed.length > 0) {
        const shown = diff.removed.slice(0, 5);
        parts.push(`Removed text: ${shown.map(t => `"${t.length > 60 ? t.slice(0, 57) + '...' : t}"`).join(', ')}${diff.removed.length > 5 ? ` (+${diff.removed.length - 5} more)` : ''}`);
    }
    if (diff.added.length === 0 && diff.removed.length === 0 && diff.countDelta === 0) {
        parts.push('No visible changes detected.');
    }
    return parts.join('\n');
}
//# sourceMappingURL=page-diffing.js.map