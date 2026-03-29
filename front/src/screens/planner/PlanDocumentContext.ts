import { createContext, useContext } from 'react';
import type { PatchOp } from './hooks/usePlanDocument';

interface PlanDocumentContextValue {
    applyPatches: (patches: PatchOp[], bannerText?: string) => void;
}

export const PlanDocumentContext = createContext<PlanDocumentContextValue>({
    applyPatches: () => {},
});

export function usePlanDocumentContext() {
    return useContext(PlanDocumentContext);
}
