import { create } from "zustand";
import type { TransactionFilter } from "../lib/tauri-api";

export const DEFAULT_FILTER_DRAFT: TransactionFilter = {
  start_date: null,
  end_date: null,
  account_id: null,
  category_id: null,
  tx_type: null,
  search: null,
  min_amount: null,
  max_amount: null,
  sort_by: "tx_date",
  sort_dir: "desc",
  limit: 25,
  offset: 0,
};

export interface UiStoreState {
  isNewTransactionModalOpen: boolean;
  activeFilterDraft: TransactionFilter;
  activeDrawerId: string | null;
  setNewTransactionModalOpen: (open: boolean) => void;
  setActiveFilterDraft: (
    updater:
      | TransactionFilter
      | ((prev: TransactionFilter) => TransactionFilter)
  ) => void;
  resetActiveFilterDraft: () => void;
  setActiveDrawerId: (drawerId: string | null) => void;
}

export const useUiStore = create<UiStoreState>((set) => ({
  isNewTransactionModalOpen: false,
  activeFilterDraft: { ...DEFAULT_FILTER_DRAFT },
  activeDrawerId: null,

  setNewTransactionModalOpen: (open) =>
    set({ isNewTransactionModalOpen: open }),

  setActiveFilterDraft: (updater) =>
    set((state) => ({
      activeFilterDraft:
        typeof updater === "function"
          ? updater(state.activeFilterDraft)
          : updater,
    })),

  resetActiveFilterDraft: () =>
    set({ activeFilterDraft: { ...DEFAULT_FILTER_DRAFT } }),

  setActiveDrawerId: (drawerId) => set({ activeDrawerId: drawerId }),
}));

