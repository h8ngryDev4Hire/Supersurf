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
export declare function diffSnapshots(before: PageState, after: PageState): DiffResult;
export declare function calculateConfidence(state: PageState): number;
export declare function formatDiffSection(diff: DiffResult, confidence: number): string;
//# sourceMappingURL=page-diffing.d.ts.map