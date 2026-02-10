/**
 * Page diffing utilities — compares DOM snapshots before/after interactions
 * Part of SuperSurf experimental features
 */

export interface PageState {
  elementCount: number;
  textContent: string[];
  shadowRootCount: number;
  iframeCount: number;
  hiddenElementCount: number;
  pageElementCount: number;
}

export interface DiffResult {
  added: string[];
  removed: string[];
  countDelta: number;
}

export function diffSnapshots(before: PageState, after: PageState): DiffResult {
  const beforeSet = new Set(before.textContent);
  const afterSet = new Set(after.textContent);

  const added = after.textContent.filter(t => !beforeSet.has(t));
  const removed = before.textContent.filter(t => !afterSet.has(t));
  const countDelta = after.elementCount - before.elementCount;

  return { added, removed, countDelta };
}

export function calculateConfidence(state: PageState): number {
  let confidence = 1.0;

  if (state.shadowRootCount > 10) confidence -= 0.35;
  else if (state.shadowRootCount > 0) confidence -= 0.15;

  if (state.iframeCount > 5) confidence -= 0.20;
  else if (state.iframeCount > 0) confidence -= 0.10;

  if (state.pageElementCount > 5000) confidence -= 0.15;

  if (state.hiddenElementCount > 0) confidence -= 0.10;

  return Math.max(0, confidence);
}

export function formatDiffSection(diff: DiffResult, confidence: number): string {
  const parts: string[] = ['\n\n---', `**Page diff** (confidence: ${Math.round(confidence * 100)}%)`];

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
