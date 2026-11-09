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

const BALANCE_HIDDEN_STORAGE_KEY = "dmm-balance-hidden";

function getStoredBalanceHidden(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(BALANCE_HIDDEN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistBalanceHidden(hidden: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      BALANCE_HIDDEN_STORAGE_KEY,
      hidden ? "true" : "false"
    );
  } catch {
    // Ignore storage restriction errors in sandboxed/private modes
  }
}

export interface UiStoreState {
  isNewTransactionModalOpen: boolean;
  activeFilterDraft: TransactionFilter;
  activeDrawerId: string | null;
  isBalanceHidden: boolean;
  setNewTransactionModalOpen: (open: boolean) => void;
  setActiveFilterDraft: (
    updater:
      | TransactionFilter
      | ((prev: TransactionFilter) => TransactionFilter)
  ) => void;
  resetActiveFilterDraft: () => void;
  setActiveDrawerId: (drawerId: string | null) => void;
  setBalanceHidden: (hidden: boolean) => void;
  toggleBalanceHidden: () => void;
}

export const useUiStore = create<UiStoreState>((set) => ({
  isNewTransactionModalOpen: false,
  activeFilterDraft: { ...DEFAULT_FILTER_DRAFT },
  activeDrawerId: null,
  isBalanceHidden: getStoredBalanceHidden(),

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

  setBalanceHidden: (hidden) => {
    persistBalanceHidden(hidden);
    set({ isBalanceHidden: hidden });
  },

  toggleBalanceHidden: () =>
    set((state) => {
      const next = !state.isBalanceHidden;
      persistBalanceHidden(next);
      return { isBalanceHidden: next };
    }),
}));
