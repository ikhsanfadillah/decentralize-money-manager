use super::budgets::{get_budget_progress_in_conn, parse_month_bounds};
use super::models::{
    AccountReconciliationItem, CashFlowMonthItem, CategoryMonthlyBreakdownItem, DailyCashFlowPoint,
    DeviceContributionItem, MonthlyReportResponse, TransactionFilter,
};
use super::transactions::list_transactions_in_conn;
use crate::crdt::resolve_account_roots_map;
use crate::db::{
    normalize_category_name, now_iso8601, AppState, SYSTEM_CATEGORY_MODAL_ID,
    SYSTEM_CATEGORY_MODAL_NAME, SYSTEM_CATEGORY_PRIVE_ID, SYSTEM_CATEGORY_PRIVE_NAME,
};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use tauri::State;
pub fn get_cash_flow_summary_in_conn(
    conn: &Connection,
    months_limit: usize,
) -> AppResult<Vec<CashFlowMonthItem>> {
    let limit = months_limit.clamp(1, 36) as i64;
    let mut stmt = conn.prepare(
        "SELECT
            substr(tx_date, 1, 7) AS month,
            COALESCE(SUM(CASE WHEN tx_type = 'INCOME' THEN amount ELSE 0 END), 0) AS income,
            COALESCE(SUM(CASE WHEN tx_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS expense
         FROM transactions
         WHERE is_deleted = 0
           AND tx_type IN ('INCOME', 'EXPENSE')
         GROUP BY substr(tx_date, 1, 7)
         ORDER BY month DESC
         LIMIT ?1",
    )?;

    let rows = stmt.query_map(params![limit], |r| {
        let month: String = r.get(0)?;
        let income: i64 = r.get(1)?;
        let expense: i64 = r.get(2)?;
        let net = income.saturating_sub(expense);
        Ok(CashFlowMonthItem {
            month,
            income,
            expense,
            net,
        })
    })?;

    let mut items = Vec::new();
    for r in rows {
        items.push(r?);
    }
    items.reverse();
    Ok(items)
}

pub fn days_in_year_month(year: i32, month_num: u32) -> u32 {
    match month_num {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

pub fn previous_year_month(month: &str) -> AppResult<String> {
    let trimmed = month.trim();
    if trimmed.len() != 7 || trimmed.as_bytes()[4] != b'-' {
        return Err(AppError::Validation(format!(
            "Invalid month format '{}', expected YYYY-MM",
            month
        )));
    }
    let year: i32 = trimmed[0..4]
        .parse()
        .map_err(|_| AppError::Validation(format!("Invalid year in month '{}'", month)))?;
    let month_num: u32 = trimmed[5..7]
        .parse()
        .map_err(|_| AppError::Validation(format!("Invalid month number in '{}'", month)))?;
    if !(1..=12).contains(&month_num) {
        return Err(AppError::Validation(format!(
            "Month number must be between 01 and 12 in '{}'",
            month
        )));
    }
    if month_num == 1 {
        Ok(format!("{:04}-12", year - 1))
    } else {
        Ok(format!("{:04}-{:02}", year, month_num - 1))
    }
}

pub fn get_monthly_report_in_conn(
    conn: &Connection,
    month: &str,
) -> AppResult<MonthlyReportResponse> {
    let trimmed_month = month.trim().to_string();
    let (start_date, end_date) = parse_month_bounds(&trimmed_month)?;
    let prev_month = previous_year_month(&trimmed_month)?;
    let (prev_start_date, prev_end_date) = parse_month_bounds(&prev_month)?;

    let year: i32 = trimmed_month[0..4]
        .parse()
        .map_err(|_| AppError::Validation("Invalid year".into()))?;
    let month_num: u32 = trimmed_month[5..7]
        .parse()
        .map_err(|_| AppError::Validation("Invalid month".into()))?;
    let days_in_month = days_in_year_month(year, month_num);

    let prive_norm = normalize_category_name(SYSTEM_CATEGORY_PRIVE_NAME);
    let modal_norm = normalize_category_name(SYSTEM_CATEGORY_MODAL_NAME);

    // 1. Resolve canonical category metadata
    let mut cat_meta: HashMap<String, (String, String, String)> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT
                c.id,
                COALESCE(c_canon.id, c.id) AS canonical_id,
                COALESCE(c_canon.name, c.name) AS canonical_name,
                COALESCE(c_canon.normalized_name, c.normalized_name) AS canonical_norm,
                COALESCE(c_canon.kind, c.kind) AS canonical_kind
             FROM categories c
             LEFT JOIN categories c_canon ON c_canon.id = COALESCE(c.merged_into_id, c.id)",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?;
        for r in rows {
            let (raw_id, canon_id, canon_name, canon_norm, canon_kind) = r?;
            cat_meta.insert(
                raw_id,
                (canon_id.clone(), canon_name.clone(), canon_norm.clone()),
            );
            cat_meta
                .entry(canon_id.clone())
                .or_insert((canon_id, canon_name, canon_norm));
            let _ = canon_kind;
        }
    }

    // 2. Scan previous month transactions for MoM comparison
    let mut prev_operational_income: i64 = 0;
    let mut prev_operational_expense: i64 = 0;
    let mut prev_cat_totals: HashMap<(String, String), i64> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT category_id, amount, tx_type
             FROM transactions
             WHERE is_deleted = 0
               AND tx_date >= ?1
               AND tx_date < ?2
               AND tx_type IN ('INCOME', 'EXPENSE')",
        )?;
        let rows = stmt.query_map(params![prev_start_date, prev_end_date], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        for r in rows {
            let (cat_id_opt, amount, tx_type) = r?;
            let (canon_id, _canon_name, canon_norm) = cat_id_opt
                .as_deref()
                .and_then(|cid| cat_meta.get(cid).cloned())
                .unwrap_or_else(|| {
                    (
                        "__UNCATEGORIZED__".to_string(),
                        "Tanpa Kategori".to_string(),
                        String::new(),
                    )
                });
            let abs_amt = amount.unsigned_abs() as i64;
            let is_sys = canon_id == SYSTEM_CATEGORY_PRIVE_ID
                || canon_id == SYSTEM_CATEGORY_MODAL_ID
                || canon_norm == prive_norm
                || canon_norm == modal_norm;

            if tx_type == "INCOME" && !is_sys {
                prev_operational_income = prev_operational_income.saturating_add(abs_amt);
            } else if tx_type == "EXPENSE" && !is_sys {
                prev_operational_expense = prev_operational_expense.saturating_add(abs_amt);
            }
            let entry = prev_cat_totals
                .entry((canon_id, tx_type))
                .or_insert(0);
            *entry = entry.saturating_add(abs_amt);
        }
    }

    // 3. Scan current month transactions for KPIs, Daily Series, Category Breakdown, Device Breakdown
    let mut daily_income = vec![0i64; days_in_month as usize];
    let mut daily_expense = vec![0i64; days_in_month as usize];
    let mut daily_tx_count = vec![0u32; days_in_month as usize];

    let mut operational_income: i64 = 0;
    let mut operational_expense: i64 = 0;
    let mut capital_injection: i64 = 0;
    let mut capital_withdrawal: i64 = 0;
    let mut tx_count: u32 = 0;
    let mut max_active_day: u32 = 1;

    // Key: (canon_cat_id, tx_type) -> (canon_name, is_system, current_amount, tx_count)
    let mut curr_cat_map: HashMap<(String, String), (String, bool, i64, u32)> = HashMap::new();
    // Key: device_id -> (tx_count, income, expense)
    let mut device_map: HashMap<String, (u32, i64, i64)> = HashMap::new();

    {
        let mut stmt = conn.prepare(
            "SELECT category_id, amount, tx_type, tx_date, created_by_device
             FROM transactions
             WHERE is_deleted = 0
               AND tx_date >= ?1
               AND tx_date < ?2",
        )?;
        let rows = stmt.query_map(params![start_date, end_date], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?;

        for r in rows {
            let (cat_id_opt, amount, tx_type, tx_date, device_id) = r?;
            tx_count = tx_count.saturating_add(1);

            let day_num: u32 = tx_date
                .get(8..10)
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(1)
                .clamp(1, days_in_month);
            max_active_day = max_active_day.max(day_num);
            let day_idx = (day_num - 1) as usize;
            daily_tx_count[day_idx] = daily_tx_count[day_idx].saturating_add(1);

            let abs_amt = amount.unsigned_abs() as i64;
            let dev_entry = device_map.entry(device_id).or_insert((0, 0, 0));
            dev_entry.0 = dev_entry.0.saturating_add(1);

            if tx_type == "INCOME" || tx_type == "EXPENSE" {
                let (canon_id, canon_name, canon_norm) = cat_id_opt
                    .as_deref()
                    .and_then(|cid| cat_meta.get(cid).cloned())
                    .unwrap_or_else(|| {
                        (
                            "__UNCATEGORIZED__".to_string(),
                            "Tanpa Kategori".to_string(),
                            String::new(),
                        )
                    });

                let is_prive =
                    canon_id == SYSTEM_CATEGORY_PRIVE_ID || canon_norm == prive_norm;
                let is_modal =
                    canon_id == SYSTEM_CATEGORY_MODAL_ID || canon_norm == modal_norm;
                let is_sys = is_prive || is_modal;

                if tx_type == "INCOME" {
                    dev_entry.1 = dev_entry.1.saturating_add(abs_amt);
                    if is_modal {
                        capital_injection = capital_injection.saturating_add(abs_amt);
                    } else {
                        operational_income = operational_income.saturating_add(abs_amt);
                        daily_income[day_idx] = daily_income[day_idx].saturating_add(abs_amt);
                    }
                } else {
                    dev_entry.2 = dev_entry.2.saturating_add(abs_amt);
                    if is_prive {
                        capital_withdrawal = capital_withdrawal.saturating_add(abs_amt);
                    } else {
                        operational_expense = operational_expense.saturating_add(abs_amt);
                        daily_expense[day_idx] = daily_expense[day_idx].saturating_add(abs_amt);
                    }
                }

                let cat_entry = curr_cat_map
                    .entry((canon_id, tx_type))
                    .or_insert((canon_name, is_sys, 0, 0));
                cat_entry.2 = cat_entry.2.saturating_add(abs_amt);
                cat_entry.3 = cat_entry.3.saturating_add(1);
            }
        }
    }

    // Also include categories that had transactions in prev_month but 0 in current_month
    for ((prev_cat_id, prev_kind), _prev_amt) in &prev_cat_totals {
        if !curr_cat_map.contains_key(&(prev_cat_id.clone(), prev_kind.clone())) {
            let (canon_id, canon_name, canon_norm) = cat_meta
                .get(prev_cat_id)
                .cloned()
                .unwrap_or_else(|| {
                    (
                        prev_cat_id.clone(),
                        "Kategori Lainnya".to_string(),
                        String::new(),
                    )
                });
            let is_sys = canon_id == SYSTEM_CATEGORY_PRIVE_ID
                || canon_id == SYSTEM_CATEGORY_MODAL_ID
                || canon_norm == prive_norm
                || canon_norm == modal_norm;
            curr_cat_map.insert(
                (prev_cat_id.clone(), prev_kind.clone()),
                (canon_name, is_sys, 0, 0),
            );
        }
    }

    // Build daily series
    let mut daily_series = Vec::with_capacity(days_in_month as usize);
    let mut cum_inc: i64 = 0;
    let mut cum_exp: i64 = 0;
    for d in 1..=days_in_month {
        let idx = (d - 1) as usize;
        let inc = daily_income[idx];
        let exp = daily_expense[idx];
        cum_inc = cum_inc.saturating_add(inc);
        cum_exp = cum_exp.saturating_add(exp);
        daily_series.push(DailyCashFlowPoint {
            date: format!("{}-{:02}", trimmed_month, d),
            day: d,
            income: inc,
            expense: exp,
            net: inc.saturating_sub(exp),
            cumulative_income: cum_inc,
            cumulative_expense: cum_exp,
            tx_count: daily_tx_count[idx],
        });
    }

    // Determine elapsed days for burn rate & no-spend days
    let now_str = now_iso8601();
    let current_ym = now_str.get(0..7).unwrap_or("");
    let today_day = now_str
        .get(8..10)
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(days_in_month);

    let elapsed_days = if trimmed_month.as_str() < current_ym {
        days_in_month
    } else if trimmed_month.as_str() == current_ym {
        today_day.max(max_active_day).clamp(1, days_in_month)
    } else {
        max_active_day.clamp(1, days_in_month)
    };

    let mut no_spend_days: u32 = 0;
    for d in 1..=elapsed_days {
        if daily_expense[(d - 1) as usize] == 0 {
            no_spend_days += 1;
        }
    }

    let operational_net = operational_income.saturating_sub(operational_expense);
    let savings_rate_bps = if operational_income > 0 {
        let bps = (operational_net as i128) * 10_000 / (operational_income as i128);
        i64::try_from(bps).unwrap_or(0)
    } else {
        0
    };

    let daily_burn_rate = operational_expense / (elapsed_days.max(1) as i64);
    let projected_month_expense = daily_burn_rate.saturating_mul(days_in_month as i64);

    // Budget ceiling for month (use Total Pengeluaran budget if set, otherwise sum of category budgets)
    let budget_progress = get_budget_progress_in_conn(conn, &trimmed_month)?;
    let total_budget_limit = if let Some(all_b) =
        budget_progress.iter().find(|b| b.category_id.is_none())
    {
        Some(all_b.amount_limit)
    } else if !budget_progress.is_empty() {
        Some(
            budget_progress
                .iter()
                .fold(0i64, |acc, b| acc.saturating_add(b.amount_limit)),
        )
    } else {
        None
    };

    // Build Category Breakdown
    let total_exp_all = operational_expense.saturating_add(capital_withdrawal);
    let total_inc_all = operational_income.saturating_add(capital_injection);

    let mut category_breakdown = Vec::with_capacity(curr_cat_map.len());
    for ((cat_id, kind), (cat_name, is_system, curr_amt, cnt)) in curr_cat_map {
        let prev_amt = prev_cat_totals
            .get(&(cat_id.clone(), kind.clone()))
            .copied()
            .unwrap_or(0);
        let delta_amount = curr_amt.saturating_sub(prev_amt);
        let delta_pct = if prev_amt > 0 {
            let p = (delta_amount as i128) * 100 / (prev_amt as i128);
            Some(i64::try_from(p).unwrap_or(0))
        } else {
            None
        };
        let denom = if kind == "EXPENSE" {
            total_exp_all
        } else {
            total_inc_all
        };
        let share_bps = if denom > 0 {
            let bps = (curr_amt as i128) * 10_000 / (denom as i128);
            i64::try_from(bps).unwrap_or(0)
        } else {
            0
        };
        category_breakdown.push(CategoryMonthlyBreakdownItem {
            category_id: cat_id,
            category_name: cat_name,
            kind,
            is_system,
            current_amount: curr_amt,
            prev_amount: prev_amt,
            delta_amount,
            delta_pct,
            share_bps,
            tx_count: cnt,
        });
    }
    category_breakdown.sort_by(|a, b| {
        a.kind
            .cmp(&b.kind)
            .then_with(|| b.current_amount.cmp(&a.current_amount))
            .then_with(|| b.prev_amount.cmp(&a.prev_amount))
            .then_with(|| a.category_name.cmp(&b.category_name))
    });

    // 4. Account Reconciliation (Opening Balance < start_date, Inflow/Outflow in [start_date, end_date), Closing Balance)
    let roots = resolve_account_roots_map(conn)?;
    let mut recon_map: HashMap<String, AccountReconciliationItem> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT id, name, account_type, initial_balance, merged_into_id
             FROM accounts
             WHERE is_deleted = 0",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        })?;
        let mut all_accs = Vec::new();
        for r in rows {
            all_accs.push(r?);
        }
        for (id, name, acc_type, init_bal, merged_into) in &all_accs {
            let root_id = roots.get(id).cloned().unwrap_or_else(|| id.clone());
            if merged_into.is_none() || &root_id == id {
                let entry = recon_map
                    .entry(root_id.clone())
                    .or_insert(AccountReconciliationItem {
                        account_id: root_id,
                        account_name: name.clone(),
                        account_type: acc_type.clone(),
                        opening_balance: 0,
                        month_inflow: 0,
                        month_outflow: 0,
                        net_change: 0,
                        closing_balance: 0,
                        tx_count: 0,
                    });
                entry.account_name = name.clone();
                entry.account_type = acc_type.clone();
                entry.opening_balance = entry.opening_balance.saturating_add(*init_bal);
            }
        }
        for (id, _name, _acc_type, init_bal, merged_into) in &all_accs {
            if merged_into.is_some() {
                let root_id = roots.get(id).cloned().unwrap_or_else(|| id.clone());
                if &root_id != id {
                    if let Some(root_item) = recon_map.get_mut(&root_id) {
                        root_item.opening_balance =
                            root_item.opening_balance.saturating_add(*init_bal);
                    }
                }
            }
        }
    }

    {
        let mut stmt = conn.prepare(
            "SELECT account_id, to_account_id, amount, tx_type, tx_date
             FROM transactions
             WHERE is_deleted = 0
               AND tx_date < ?1",
        )?;
        let rows = stmt.query_map(params![end_date], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?;
        for r in rows {
            let (acc_id, to_acc_id, amount, tx_type, tx_date) = r?;
            let src_root = roots.get(&acc_id).cloned().unwrap_or(acc_id);
            let is_before_month = tx_date < start_date;
            let abs_amt = amount.unsigned_abs() as i64;

            if is_before_month {
                match tx_type.as_str() {
                    "INCOME" | "EXPENSE" => {
                        if let Some(item) = recon_map.get_mut(&src_root) {
                            item.opening_balance = item.opening_balance.saturating_add(amount);
                        }
                    }
                    "TRANSFER" => {
                        if let Some(item) = recon_map.get_mut(&src_root) {
                            item.opening_balance = item.opening_balance.saturating_sub(abs_amt);
                        }
                        if let Some(dst_raw) = to_acc_id {
                            let dst_root = roots.get(&dst_raw).cloned().unwrap_or(dst_raw);
                            if let Some(dst_item) = recon_map.get_mut(&dst_root) {
                                dst_item.opening_balance =
                                    dst_item.opening_balance.saturating_add(abs_amt);
                            }
                        }
                    }
                    _ => {}
                }
            } else {
                // Inside [start_date, end_date)
                match tx_type.as_str() {
                    "INCOME" => {
                        if let Some(item) = recon_map.get_mut(&src_root) {
                            item.month_inflow = item.month_inflow.saturating_add(abs_amt);
                            item.tx_count = item.tx_count.saturating_add(1);
                        }
                    }
                    "EXPENSE" => {
                        if let Some(item) = recon_map.get_mut(&src_root) {
                            item.month_outflow = item.month_outflow.saturating_add(abs_amt);
                            item.tx_count = item.tx_count.saturating_add(1);
                        }
                    }
                    "TRANSFER" => {
                        if let Some(item) = recon_map.get_mut(&src_root) {
                            item.month_outflow = item.month_outflow.saturating_add(abs_amt);
                            item.tx_count = item.tx_count.saturating_add(1);
                        }
                        if let Some(dst_raw) = to_acc_id {
                            let dst_root = roots.get(&dst_raw).cloned().unwrap_or(dst_raw);
                            if let Some(dst_item) = recon_map.get_mut(&dst_root) {
                                dst_item.month_inflow =
                                    dst_item.month_inflow.saturating_add(abs_amt);
                                dst_item.tx_count = dst_item.tx_count.saturating_add(1);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    let mut account_reconciliation: Vec<AccountReconciliationItem> = recon_map
        .into_values()
        .map(|mut item| {
            item.net_change = item.month_inflow.saturating_sub(item.month_outflow);
            item.closing_balance = item.opening_balance.saturating_add(item.net_change);
            item
        })
        .collect();
    account_reconciliation.sort_by(|a, b| {
        a.account_name
            .cmp(&b.account_name)
            .then_with(|| a.account_id.cmp(&b.account_id))
    });

    // 5. Device Contributions
    let local_dev_id: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key = 'device_id'", [], |r| r.get(0))
        .optional()
        .unwrap_or(None);
    let local_dev_name: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key = 'device_name'", [], |r| r.get(0))
        .optional()
        .unwrap_or(None);

    let mut peer_name_map: HashMap<String, String> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT device_id, device_name, custom_alias FROM sync_peers WHERE device_id IS NOT NULL") {
        if let Ok(rows) = stmt.query_map([], |r| {
            let dev_id: String = r.get(0)?;
            let dev_name: Option<String> = r.get(1)?;
            let custom_alias: Option<String> = r.get(2)?;
            Ok((dev_id, custom_alias.or(dev_name)))
        }) {
            for row in rows.flatten() {
                if let (dev_id, Some(name)) = row {
                    peer_name_map.insert(dev_id, name);
                }
            }
        }
    }

    let total_dev_tx = tx_count.max(1) as i128;
    let mut device_contributions: Vec<DeviceContributionItem> = device_map
        .into_iter()
        .map(|(device_id, (cnt, inc, exp))| {
            let share_bps = i64::try_from((cnt as i128) * 10_000 / total_dev_tx).unwrap_or(0);
            let resolved_name = if Some(&device_id) == local_dev_id.as_ref() {
                local_dev_name.clone()
            } else {
                peer_name_map.get(&device_id).cloned()
            };
            DeviceContributionItem {
                device_id,
                tx_count: cnt,
                total_income: inc,
                total_expense: exp,
                share_bps,
                device_name: resolved_name,
            }
        })
        .collect();
    device_contributions.sort_by(|a, b| {
        b.tx_count
            .cmp(&a.tx_count)
            .then_with(|| a.device_id.cmp(&b.device_id))
    });

    // 6. Top 5 Expenses in Month (Sorted descending by largest absolute amount)
    let month_end_inclusive = format!("{}-{:02}", trimmed_month, days_in_month);
    let top_tx_page = list_transactions_in_conn(
        conn,
        TransactionFilter {
            start_date: Some(start_date),
            end_date: Some(month_end_inclusive),
            tx_type: Some("EXPENSE".to_string()),
            sort_by: Some("amount".to_string()),
            sort_dir: Some("desc".to_string()), // Largest absolute amount first = largest expense
            limit: Some(5),
            offset: Some(0),
            ..Default::default()
        },
    )?;

    Ok(MonthlyReportResponse {
        month: trimmed_month,
        prev_month,
        days_in_month,
        elapsed_days,
        no_spend_days,
        tx_count,
        operational_income,
        operational_expense,
        operational_net,
        prev_operational_income,
        prev_operational_expense,
        capital_injection,
        capital_withdrawal,
        savings_rate_bps,
        daily_burn_rate,
        projected_month_expense,
        total_budget_limit,
        daily_series,
        category_breakdown,
        account_reconciliation,
        device_contributions,
        top_expenses: top_tx_page.items,
    })
}

#[tauri::command]
pub async fn get_cash_flow_summary(
    state: State<'_, AppState>,
    book_id: String,
    months_limit: Option<usize>,
) -> AppResult<Vec<CashFlowMonthItem>> {
    let limit = months_limit.unwrap_or(6);
    state
        .with_book(&book_id, move |conn| get_cash_flow_summary_in_conn(conn, limit))
        .await
}

#[tauri::command]
pub async fn get_monthly_report(
    state: State<'_, AppState>,
    book_id: String,
    month: String,
) -> AppResult<MonthlyReportResponse> {
    state
        .with_book(&book_id, move |conn| get_monthly_report_in_conn(conn, &month))
        .await
}

