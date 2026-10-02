import { create } from "zustand";

interface CourseCueState {
  isSyncing: boolean;
  tokenExpired: boolean;
  /** Bumped on every complete/dismiss so data-dependent client widgets
   *  (e.g. StressAlert) refetch — router.refresh() alone never remounts
   *  already-mounted client components, leaving their numbers stale. */
  assignmentsVersion: number;
  setIsSyncing: (v: boolean) => void;
  setTokenExpired: (v: boolean) => void;
  bumpAssignmentsVersion: () => void;
}

export const useCourseCueStore = create<CourseCueState>()((set) => ({
  isSyncing: false,
  tokenExpired: false,
  assignmentsVersion: 0,
  setIsSyncing: (v) => set({ isSyncing: v }),
  setTokenExpired: (v) => set({ tokenExpired: v }),
  bumpAssignmentsVersion: () => set((s) => ({ assignmentsVersion: s.assignmentsVersion + 1 })),
}));
