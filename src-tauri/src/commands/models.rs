use crate::crdt::TransactionRow;
use serde::{Deserialize, Serialize};
// ============================================================================
// DTOs
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountView {
    pub id: String,
    pub name: String,
    pub account_type: String,
    pub initial_balance: i64,
    pub merged_into_id: Option<String>,
    pub root_id: String,
    pub is_deleted: i64,
    pub updated_hlc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsertAccountInput {
    pub id: Option<String>,
    pub name: String,
    pub account_type: String,
    pub initial_balance: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CategoryView {
    pub id: String,
    pub name: String,
    pub normalized_name: String,
    pub kind: String,
    pub merged_into_id: Option<String>,
    pub canonical_id: String,
    pub is_deleted: i64,
    pub updated_hlc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsertCategoryInput {
    pub id: Option<String>,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddTransactionInput {
    pub id: Option<String>,
    pub account_id: String,
    pub to_account_id: Option<String>,
    pub category_id: Option<String>,
    pub amount: i64,
    pub tx_type: String,
    pub note: Option<String>,
    pub tx_date: String,
    pub link_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTransactionInput {
    pub id: String,
    pub account_id: String,
    pub to_account_id: Option<String>,
    pub category_id: Option<String>,
    pub amount: i64,
    pub tx_type: String,
    pub note: Option<String>,
    pub tx_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransactionView {
    pub id: String,
    pub account_id: String,
    pub account_name: String,
    pub to_account_id: Option<String>,
    pub to_account_name: Option<String>,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub amount: i64,
    pub tx_type: String,
    pub note: Option<String>,
    pub tx_date: String,
    pub created_by_device: String,
    pub link_id: Option<String>,
    pub updated_hlc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TransactionFilter {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub account_id: Option<String>,
    pub category_id: Option<String>,
    pub tx_type: Option<String>,
    pub search: Option<String>,
    pub min_amount: Option<i64>,
    pub max_amount: Option<i64>,
    pub sort_by: Option<String>,
    pub sort_dir: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedTransactions {
    pub items: Vec<TransactionView>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferBetweenBooksInput {
    pub from_book_id: String,
    pub from_account_id: String,
    pub to_book_id: String,
    pub to_account_id: String,
    pub amount: i64,
    pub tx_date: String,
    pub note: Option<String>,
    pub link_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferBetweenBooksResult {
    pub link_id: String,
    pub expense_tx: TransactionRow,
    pub income_tx: TransactionRow,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountBalanceItem {
    pub account_id: String,
    pub name: String,
    pub account_type: String,
    pub initial_balance: i64,
    pub current_balance: i64,
    pub merged_member_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CashFlowMonthItem {
    pub month: String,
    pub income: i64,
    pub expense: i64,
    pub net: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsertBudgetInput {
    pub category_id: Option<String>,
    pub period: Option<String>,
    pub amount_limit: i64,
    pub alert_threshold_pct: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BudgetProgressItem {
    pub id: String,
    pub category_id: Option<String>,
    pub category_name: String,
    pub period: String,
    pub amount_limit: i64,
    pub alert_threshold_pct: i64,
    pub spent: i64,
    pub remaining: i64,
    pub pct: i64,
    pub status: String,
    pub updated_hlc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncStatusPayload {
    pub book_id: String,
    pub state: String,
    pub peers: usize,
    pub last_synced_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PeerInfo {
    pub node_id: String,
    pub device_id: Option<String>,
    pub last_seen_at: Option<String>,
    pub device_name: Option<String>,
    pub custom_alias: Option<String>,
    #[serde(default)]
    pub is_online: bool,
    #[serde(default)]
    pub is_preferred_hub: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceIdentity {
    pub device_id: String,
    pub device_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncTopologyInfo {
    pub book_id: String,
    pub local_node_id: Option<String>,
    pub preferred_hub_node_id: Option<String>,
    pub active_streams: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DailyCashFlowPoint {
    pub date: String,
    pub day: u32,
    pub income: i64,
    pub expense: i64,
    pub net: i64,
    pub cumulative_income: i64,
    pub cumulative_expense: i64,
    pub tx_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CategoryMonthlyBreakdownItem {
    pub category_id: String,
    pub category_name: String,
    pub kind: String,
    pub is_system: bool,
    pub current_amount: i64,
    pub prev_amount: i64,
    pub delta_amount: i64,
    pub delta_pct: Option<i64>,
    pub share_bps: i64,
    pub tx_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountReconciliationItem {
    pub account_id: String,
    pub account_name: String,
    pub account_type: String,
    pub opening_balance: i64,
    pub month_inflow: i64,
    pub month_outflow: i64,
    pub net_change: i64,
    pub closing_balance: i64,
    pub tx_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceContributionItem {
    pub device_id: String,
    pub tx_count: u32,
    pub total_income: i64,
    pub total_expense: i64,
    pub share_bps: i64,
    #[serde(default)]
    pub device_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MonthlyReportResponse {
    pub month: String,
    pub prev_month: String,
    pub days_in_month: u32,
    pub elapsed_days: u32,
    pub no_spend_days: u32,
    pub tx_count: u32,
    pub operational_income: i64,
    pub operational_expense: i64,
    pub operational_net: i64,
    pub prev_operational_income: i64,
    pub prev_operational_expense: i64,
    pub capital_injection: i64,
    pub capital_withdrawal: i64,
    pub savings_rate_bps: i64,
    pub daily_burn_rate: i64,
    pub projected_month_expense: i64,
    pub total_budget_limit: Option<i64>,
    pub daily_series: Vec<DailyCashFlowPoint>,
    pub category_breakdown: Vec<CategoryMonthlyBreakdownItem>,
    pub account_reconciliation: Vec<AccountReconciliationItem>,
    pub device_contributions: Vec<DeviceContributionItem>,
    pub top_expenses: Vec<TransactionView>,
}

