import type { PatchOp } from './hooks/usePlanDocument';

let _applyPatches: ((patches: PatchOp[], bannerText?: string) => void) | null = null;

export function registerApplyPatches(fn: (patches: PatchOp[], bannerText?: string) => void) {
    _applyPatches = fn;
}

export function unregisterApplyPatches() {
    _applyPatches = null;
}

export function callApplyPatches(patches: PatchOp[], bannerText?: string) {
    _applyPatches?.(patches, bannerText);
}
