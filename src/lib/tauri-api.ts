import { invoke } from "@tauri-apps/api/core";

export interface AppErrorPayload {
  code: string;
  message: string;
}

export class TauriCommandError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TauriCommandError";
    this.code = code;
  }
}

export type BookKind = "PERSONAL" | "BUSINESS" | "OFFICE" | "OTHER";
export type AccountType = "BANK" | "CASH" | "EWALLET";
export type CategoryKind = "EXPENSE" | "INCOME";
export type TransactionType = "EXPENSE" | "INCOME" | "TRANSFER";
export type BudgetPeriod = "MONTHLY";
export type BudgetStatus = "OK" | "WARNING" | "OVER";
export type SyncState = "idle" | "connecting" | "syncing" | "error";

export interface BookMetadata {
  id: string;
  name: string;
  kind: string;
  created_at: string;
  last_opened_at: string;
  file_exists: boolean;
}

export interface AccountRow {
  id: string;
  name: string;
  account_type: AccountType;
  initial_balance: number;
  merged_into_id: string | null;
  is_deleted: number;
  updated_hlc: string;
}

export interface AccountView {
  id: string;
  name: string;
  account_type: AccountType;
  initial_balance: number;
  merged_into_id: string | null;
  root_id: string;
  is_deleted: number;
  updated_hlc: string;
}

export interface UpsertAccountInput {
  id?: string | null;
  name: string;
  account_type: AccountType;
  initial_balance: number;
}

export interface CategoryView {
  id: string;
  name: string;
  normalized_name: string;
  kind: CategoryKind;
  merged_into_id: string | null;
  canonical_id: string;
  is_deleted: number;
  updated_hlc: string;
}

export interface UpsertCategoryInput {
  id?: string | null;
  name: string;
  kind: CategoryKind;
}

export interface TransactionRow {
  id: string;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  amount: number;
  tx_type: TransactionType;
  note: string | null;
  tx_date: string;
  created_by_device: string;
  link_id: string | null;
  is_deleted: number;
  updated_hlc: string;
}

export interface TransactionView {
  id: string;
  account_id: string;
  account_name: string;
  to_account_id: string | null;
  to_account_name: string | null;
  category_id: string | null;
  category_name: string | null;
  amount: number;
  tx_type: TransactionType;
  note: string | null;
  tx_date: string;
  created_by_device: string;
  link_id: string | null;
  updated_hlc: string;
}

export interface AddTransactionInput {
  id?: string | null;
  account_id: string;
  to_account_id?: string | null;
  category_id?: string | null;
  amount: number;
  tx_type: TransactionType;
  note?: string | null;
  tx_date: string;
  link_id?: string | null;
}

export interface UpdateTransactionInput {
  id: string;
  account_id: string;
  to_account_id?: string | null;
  category_id?: string | null;
  amount: number;
  tx_type: TransactionType;
  note?: string | null;
  tx_date: string;
}

export interface TransactionFilter {
  start_date?: string | null;
  end_date?: string | null;
  account_id?: string | null;
  category_id?: string | null;
  tx_type?: TransactionType | "" | null;
  search?: string | null;
  min_amount?: number | null;
  max_amount?: number | null;
  sort_by?: "tx_date" | "amount" | "updated_hlc" | null;
  sort_dir?: "asc" | "desc" | null;
  limit?: number | null;
  offset?: number | null;
}

export interface PaginatedTransactions {
  items: TransactionView[];
  total: number;
  limit: number;
  offset: number;
}

export interface TransferBetweenBooksInput {
  from_book_id: string;
  from_account_id: string;
  to_book_id: string;
  to_account_id: string;
  amount: number;
  tx_date: string;
  note?: string | null;
  link_id?: string | null;
}

export interface TransferBetweenBooksResult {
  link_id: string;
  expense_tx: TransactionRow;
  income_tx: TransactionRow;
}

export interface AccountBalanceItem {
  account_id: string;
  name: string;
  account_type: AccountType;
  initial_balance: number;
  current_balance: number;
  merged_member_ids: string[];
}

export interface CashFlowMonthItem {
  month: string;
  income: number;
  expense: number;
  net: number;
}

export interface BudgetRow {
  id: string;
  category_id: string | null;
  period: BudgetPeriod;
  amount_limit: number;
  alert_threshold_pct: number;
  is_deleted: number;
  updated_hlc: string;
}

export interface UpsertBudgetInput {
  category_id: string | null;
  period?: BudgetPeriod;
  amount_limit: number;
  alert_threshold_pct?: number;
}

export interface BudgetProgressItem {
  id: string;
  category_id: string | null;
  category_name: string;
  period: BudgetPeriod;
  amount_limit: number;
  alert_threshold_pct: number;
  spent: number;
  remaining: number;
  pct: number;
  status: BudgetStatus;
  updated_hlc: string;
}

export interface SyncStatusPayload {
  book_id: string;
  state: SyncState;
  peers: number;
  last_synced_at: string | null;
}

export interface CrdtSyncedPayload {
  book_id: string;
  tables: string[];
}

export interface PeerInfo {
  node_id: string;
  device_id: string | null;
  last_seen_at: string | null;
}

export interface InviteResponse {
  qr_json: string;
  expires_at: string;
  node_id: string;
}

export interface DailyCashFlowPoint {
  date: string;
  day: number;
  income: number;
  expense: number;
  net: number;
  cumulative_income: number;
  cumulative_expense: number;
  tx_count: number;
}

export interface CategoryMonthlyBreakdownItem {
  category_id: string;
  category_name: string;
  kind: CategoryKind;
  is_system: boolean;
  current_amount: number;
  prev_amount: number;
  delta_amount: number;
  delta_pct: number | null;
  share_bps: number;
  tx_count: number;
}

export interface AccountReconciliationItem {
  account_id: string;
  account_name: string;
  account_type: AccountType;
  opening_balance: number;
  month_inflow: number;
  month_outflow: number;
  net_change: number;
  closing_balance: number;
  tx_count: number;
}

export interface DeviceContributionItem {
  device_id: string;
  tx_count: number;
  total_income: number;
  total_expense: number;
  share_bps: number;
}

export interface MonthlyReportResponse {
  month: string;
  prev_month: string;
  days_in_month: number;
  elapsed_days: number;
  no_spend_days: number;
  tx_count: number;
  operational_income: number;
  operational_expense: number;
  operational_net: number;
  prev_operational_income: number;
  prev_operational_expense: number;
  capital_injection: number;
  capital_withdrawal: number;
  savings_rate_bps: number;
  daily_burn_rate: number;
  projected_month_expense: number;
  total_budget_limit: number | null;
  daily_series: DailyCashFlowPoint[];
  category_breakdown: CategoryMonthlyBreakdownItem[];
  account_reconciliation: AccountReconciliationItem[];
  device_contributions: DeviceContributionItem[];
  top_expenses: TransactionView[];
}

export function assertSafeRupiahInteger(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new TauriCommandError(
      "VALIDATION_ERROR",
      `${fieldName} harus berupa bilangan bulat aman (Number.isSafeInteger)`
    );
  }
}

function normalizeError(err: unknown): TauriCommandError {
  if (err instanceof TauriCommandError) {
    return err;
  }
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    "message" in err &&
    typeof (err as AppErrorPayload).code === "string" &&
    typeof (err as AppErrorPayload).message === "string"
  ) {
    const payload = err as AppErrorPayload;
    return new TauriCommandError(payload.code, payload.message);
  }
  if (err instanceof Error) {
    return new TauriCommandError("UNKNOWN_ERROR", err.message);
  }
  return new TauriCommandError("UNKNOWN_ERROR", String(err));
}

async function callCommand<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err: unknown) {
    throw normalizeError(err);
  }
}

export const tauriApi = {
  // Books
  listBooks: (): Promise<BookMetadata[]> => callCommand("list_books"),

  createBook: (name: string, kind: BookKind): Promise<BookMetadata> =>
    callCommand("create_book", { name, kind }),

  renameBook: (bookId: string, newName: string): Promise<BookMetadata> =>
    callCommand("rename_book", { bookId, newName }),

  deleteBook: (bookId: string): Promise<void> =>
    callCommand("delete_book", { bookId }),

  openBook: (bookId: string): Promise<BookMetadata> =>
    callCommand("open_book", { bookId }),

  closeBook: (bookId: string): Promise<void> =>
    callCommand("close_book", { bookId }),

  exportBookEncrypted: (
    bookId: string,
    passphrase: string,
    destinationPath: string
  ): Promise<string> =>
    callCommand("export_book_encrypted", {
      bookId,
      passphrase,
      destinationPath,
    }),

  // Accounts
  listAccounts: (bookId: string): Promise<AccountView[]> =>
    callCommand("list_accounts", { bookId }),

  upsertAccount: (
    bookId: string,
    input: UpsertAccountInput
  ): Promise<AccountRow> => {
    assertSafeRupiahInteger(input.initial_balance, "Saldo awal");
    return callCommand("upsert_account", { bookId, input });
  },

  deleteAccount: (bookId: string, accountId: string): Promise<void> =>
    callCommand("delete_account", { bookId, accountId }),

  mergeAccounts: (
    bookId: string,
    sourceId: string,
    targetId: string
  ): Promise<AccountRow> =>
    callCommand("merge_accounts", { bookId, sourceId, targetId }),

  // Categories
  listCategories: (bookId: string): Promise<CategoryView[]> =>
    callCommand("list_categories", { bookId }),

  upsertCategory: (
    bookId: string,
    input: UpsertCategoryInput
  ): Promise<CategoryView> =>
    callCommand("upsert_category", { bookId, input }),

  deleteCategory: (bookId: string, categoryId: string): Promise<void> =>
    callCommand("delete_category", { bookId, categoryId }),

  // Transactions
  addTransaction: (
    bookId: string,
    input: AddTransactionInput
  ): Promise<TransactionRow> => {
    assertSafeRupiahInteger(input.amount, "Nominal transaksi");
    return callCommand("add_transaction", { bookId, input });
  },

  updateTransaction: (
    bookId: string,
    input: UpdateTransactionInput
  ): Promise<TransactionRow> => {
    assertSafeRupiahInteger(input.amount, "Nominal transaksi");
    return callCommand("update_transaction", { bookId, input });
  },

  deleteTransaction: (bookId: string, txId: string): Promise<void> =>
    callCommand("delete_transaction", { bookId, txId }),

  listTransactions: (
    bookId: string,
    filter: TransactionFilter
  ): Promise<PaginatedTransactions> =>
    callCommand("list_transactions", { bookId, filter }),

  transferBetweenBooks: (
    input: TransferBetweenBooksInput
  ): Promise<TransferBetweenBooksResult> => {
    assertSafeRupiahInteger(input.amount, "Nominal transfer antar-buku");
    return callCommand("transfer_between_books", { input });
  },

  // Balances & Summary
  getAccountBalances: (bookId: string): Promise<AccountBalanceItem[]> =>
    callCommand("get_account_balances", { bookId }),

  getCashFlowSummary: (
    bookId: string,
    monthsLimit?: number
  ): Promise<CashFlowMonthItem[]> =>
    callCommand("get_cash_flow_summary", { bookId, monthsLimit }),

  // Budgets
  listBudgets: (bookId: string): Promise<BudgetRow[]> =>
    callCommand("list_budgets", { bookId }),

  upsertBudget: (
    bookId: string,
    input: UpsertBudgetInput
  ): Promise<BudgetRow> => {
    assertSafeRupiahInteger(input.amount_limit, "Batas anggaran");
    return callCommand("upsert_budget", { bookId, input });
  },

  deleteBudget: (bookId: string, budgetId: string): Promise<void> =>
    callCommand("delete_budget", { bookId, budgetId }),

  getBudgetProgress: (
    bookId: string,
    month: string
  ): Promise<BudgetProgressItem[]> =>
    callCommand("get_budget_progress", { bookId, month }),

  getMonthlyReport: (
    bookId: string,
    month: string
  ): Promise<MonthlyReportResponse> =>
    callCommand("get_monthly_report", { bookId, month }),

  // Sync
  getSyncStatus: (bookId: string): Promise<SyncStatusPayload> =>
    callCommand("get_sync_status", { bookId }),

  createInvite: (bookId: string, ttlSecs?: number): Promise<InviteResponse> =>
    callCommand("create_invite", { bookId, ttlSecs }),

  joinBookFromInvite: (
    inviteQr: string,
    kind?: BookKind
  ): Promise<BookMetadata> =>
    callCommand("join_book_from_invite", { inviteQr, kind }),

  listPeers: (bookId: string): Promise<PeerInfo[]> =>
    callCommand("list_peers", { bookId }),

  setAppForeground: (isForeground: boolean): Promise<void> =>
    callCommand("set_app_foreground", { isForeground }),
};

