import type { Database } from "@sqlite.org/sqlite-wasm";
import type {
  AccountReconciliationItem,
  AccountType,
  CashFlowMonthItem,
  CategoryKind,
  CategoryMonthlyBreakdownItem,
  DailyCashFlowPoint,
  DeviceContributionItem,
  MonthlyReportResponse,
} from "../../lib/tauri-api";
import {
  SYSTEM_CATEGORY_MODAL_ID,
  SYSTEM_CATEGORY_MODAL_NAME,
  SYSTEM_CATEGORY_PRIVE_ID,
  SYSTEM_CATEGORY_PRIVE_NAME,
  daysInYearMonth,
  normalizeCategoryName,
  nowIso8601,
  parseMonthBounds,
  previousYearMonth,
} from "../../lib/web-core";
import { getBudgetProgressInDb } from "./budgets-repo";
import { resolveAccountRootsMap } from "./crdt-ops";
import { listTransactionsInDb } from "./transactions-repo";

export function getCashFlowSummaryInDb(
  db: Database,
  monthsLimit?: number
): CashFlowMonthItem[] {
  const limit = Math.min(36, Math.max(1, monthsLimit ?? 6));
  const rows = db.selectArrays(
    `SELECT
        substr(tx_date, 1, 7) AS month,
        COALESCE(SUM(CASE WHEN tx_type = 'INCOME' THEN amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN tx_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS expense
     FROM transactions
     WHERE is_deleted = 0
       AND tx_type IN ('INCOME', 'EXPENSE')
     GROUP BY substr(tx_date, 1, 7)
     ORDER BY month DESC
     LIMIT ?1`,
    [limit]
  );

  const items: CashFlowMonthItem[] = rows.map((r) => {
    const income = Number(r[1]);
    const expense = Number(r[2]);
    return {
      month: String(r[0]),
      income,
      expense,
      net: income - expense,
    };
  });
  items.reverse();
  return items;
}

export function getMonthlyReportInDb(
  db: Database,
  month: string
): MonthlyReportResponse {
  const trimmedMonth = month.trim();
  const [startDate, endDate] = parseMonthBounds(trimmedMonth);
  const prevMonth = previousYearMonth(trimmedMonth);
  const [prevStartDate, prevEndDate] = parseMonthBounds(prevMonth);

  const year = Number(trimmedMonth.slice(0, 4));
  const monthNum = Number(trimmedMonth.slice(5, 7));
  const daysInMonth = daysInYearMonth(year, monthNum);

  const priveNorm = normalizeCategoryName(SYSTEM_CATEGORY_PRIVE_NAME);
  const modalNorm = normalizeCategoryName(SYSTEM_CATEGORY_MODAL_NAME);

  // 1. Resolve canonical category metadata
  const catMeta = new Map<
    string,
    { canonId: string; canonName: string; canonNorm: string }
  >();
  const catRows = db.selectArrays(
    `SELECT
        c.id,
        COALESCE(c_canon.id, c.id) AS canonical_id,
        COALESCE(c_canon.name, c.name) AS canonical_name,
        COALESCE(c_canon.normalized_name, c.normalized_name) AS canonical_norm
     FROM categories c
     LEFT JOIN categories c_canon ON c_canon.id = COALESCE(c.merged_into_id, c.id)`
  );
  for (const r of catRows) {
    const rawId = String(r[0]);
    const canonId = String(r[1]);
    const canonName = String(r[2]);
    const canonNorm = String(r[3]);
    catMeta.set(rawId, { canonId, canonName, canonNorm });
    if (!catMeta.has(canonId)) {
      catMeta.set(canonId, { canonId, canonName, canonNorm });
    }
  }

  // 2. Scan previous month transactions
  let prevOperationalIncome = 0;
  let prevOperationalExpense = 0;
  const prevCatTotals = new Map<string, number>();

  const prevTxRows = db.selectArrays(
    `SELECT category_id, amount, tx_type
     FROM transactions
     WHERE is_deleted = 0
       AND tx_date >= ?1
       AND tx_date < ?2
       AND tx_type IN ('INCOME', 'EXPENSE')`,
    [prevStartDate, prevEndDate]
  );
  for (const r of prevTxRows) {
    const catIdOpt = r[0] !== null ? String(r[0]) : null;
    const amount = Number(r[1]);
    const txType = String(r[2]);
    const meta = (catIdOpt && catMeta.get(catIdOpt)) || {
      canonId: "__UNCATEGORIZED__",
      canonName: "Tanpa Kategori",
      canonNorm: "",
    };
    const absAmt = Math.abs(amount);
    const isSys =
      meta.canonId === SYSTEM_CATEGORY_PRIVE_ID ||
      meta.canonId === SYSTEM_CATEGORY_MODAL_ID ||
      meta.canonNorm === priveNorm ||
      meta.canonNorm === modalNorm;

    if (txType === "INCOME" && !isSys) {
      prevOperationalIncome += absAmt;
    } else if (txType === "EXPENSE" && !isSys) {
      prevOperationalExpense += absAmt;
    }
    const key = `${meta.canonId}:::${txType}`;
    prevCatTotals.set(key, (prevCatTotals.get(key) ?? 0) + absAmt);
  }

  // 3. Scan current month transactions
  const dailyIncome = new Array<number>(daysInMonth).fill(0);
  const dailyExpense = new Array<number>(daysInMonth).fill(0);
  const dailyTxCount = new Array<number>(daysInMonth).fill(0);

  let operationalIncome = 0;
  let operationalExpense = 0;
  let capitalInjection = 0;
  let capitalWithdrawal = 0;
  let txCount = 0;
  let maxActiveDay = 1;

  const currCatMap = new Map<
    string,
    {
      canonId: string;
      kind: CategoryKind;
      canonName: string;
      isSystem: boolean;
      currentAmount: number;
      txCount: number;
    }
  >();
  const deviceMap = new Map<
    string,
    { txCount: number; income: number; expense: number }
  >();

  const currTxRows = db.selectArrays(
    `SELECT category_id, amount, tx_type, tx_date, created_by_device
     FROM transactions
     WHERE is_deleted = 0
       AND tx_date >= ?1
       AND tx_date < ?2`,
    [startDate, endDate]
  );

  for (const r of currTxRows) {
    const catIdOpt = r[0] !== null ? String(r[0]) : null;
    const amount = Number(r[1]);
    const txType = String(r[2]);
    const txDate = String(r[3]);
    const deviceId = String(r[4]);

    txCount += 1;
    const parsedDay = Number(txDate.slice(8, 10));
    const dayNum = Math.min(
      daysInMonth,
      Math.max(1, Number.isFinite(parsedDay) ? parsedDay : 1)
    );
    maxActiveDay = Math.max(maxActiveDay, dayNum);
    const dayIdx = dayNum - 1;
    dailyTxCount[dayIdx] += 1;

    const absAmt = Math.abs(amount);
    const devEntry = deviceMap.get(deviceId) ?? {
      txCount: 0,
      income: 0,
      expense: 0,
    };
    devEntry.txCount += 1;
    deviceMap.set(deviceId, devEntry);

    if (txType === "INCOME" || txType === "EXPENSE") {
      const meta = (catIdOpt && catMeta.get(catIdOpt)) || {
        canonId: "__UNCATEGORIZED__",
        canonName: "Tanpa Kategori",
        canonNorm: "",
      };
      const isPrive =
        meta.canonId === SYSTEM_CATEGORY_PRIVE_ID ||
        meta.canonNorm === priveNorm;
      const isModal =
        meta.canonId === SYSTEM_CATEGORY_MODAL_ID ||
        meta.canonNorm === modalNorm;
      const isSys = isPrive || isModal;

      if (txType === "INCOME") {
        devEntry.income += absAmt;
        if (isModal) {
          capitalInjection += absAmt;
        } else {
          operationalIncome += absAmt;
          dailyIncome[dayIdx] += absAmt;
        }
      } else {
        devEntry.expense += absAmt;
        if (isPrive) {
          capitalWithdrawal += absAmt;
        } else {
          operationalExpense += absAmt;
          dailyExpense[dayIdx] += absAmt;
        }
      }

      const key = `${meta.canonId}:::${txType}`;
      const catEntry = currCatMap.get(key) ?? {
        canonId: meta.canonId,
        kind: txType as CategoryKind,
        canonName: meta.canonName,
        isSystem: isSys,
        currentAmount: 0,
        txCount: 0,
      };
      catEntry.currentAmount += absAmt;
      catEntry.txCount += 1;
      currCatMap.set(key, catEntry);
    }
  }

  for (const key of prevCatTotals.keys()) {
    if (!currCatMap.has(key)) {
      const [prevCatId, prevKind] = key.split(":::");
      const meta = catMeta.get(prevCatId) ?? {
        canonId: prevCatId,
        canonName: "Kategori Lainnya",
        canonNorm: "",
      };
      const isSys =
        meta.canonId === SYSTEM_CATEGORY_PRIVE_ID ||
        meta.canonId === SYSTEM_CATEGORY_MODAL_ID ||
        meta.canonNorm === priveNorm ||
        meta.canonNorm === modalNorm;
      currCatMap.set(key, {
        canonId: prevCatId,
        kind: prevKind as CategoryKind,
        canonName: meta.canonName,
        isSystem: isSys,
        currentAmount: 0,
        txCount: 0,
      });
    }
  }

  // Build daily series
  const dailySeries: DailyCashFlowPoint[] = [];
  let cumInc = 0;
  let cumExp = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const idx = d - 1;
    const inc = dailyIncome[idx];
    const exp = dailyExpense[idx];
    cumInc += inc;
    cumExp += exp;
    dailySeries.push({
      date: `${trimmedMonth}-${d.toString().padStart(2, "0")}`,
      day: d,
      income: inc,
      expense: exp,
      net: inc - exp,
      cumulative_income: cumInc,
      cumulative_expense: cumExp,
      tx_count: dailyTxCount[idx],
    });
  }

  const nowStr = nowIso8601();
  const currentYm = nowStr.slice(0, 7);
  const todayDay = Number(nowStr.slice(8, 10)) || daysInMonth;

  const elapsedDays =
    trimmedMonth < currentYm
      ? daysInMonth
      : trimmedMonth === currentYm
        ? Math.min(daysInMonth, Math.max(1, Math.max(todayDay, maxActiveDay)))
        : Math.min(daysInMonth, Math.max(1, maxActiveDay));

  let noSpendDays = 0;
  for (let d = 1; d <= elapsedDays; d++) {
    if (dailyExpense[d - 1] === 0) {
      noSpendDays += 1;
    }
  }

  const operationalNet = operationalIncome - operationalExpense;
  const savingsRateBps =
    operationalIncome > 0
      ? Math.trunc((operationalNet * 10_000) / operationalIncome)
      : 0;
  const dailyBurnRate = Math.trunc(
    operationalExpense / Math.max(1, elapsedDays)
  );
  const projectedMonthExpense = dailyBurnRate * daysInMonth;

  const budgetProgress = getBudgetProgressInDb(db, trimmedMonth);
  const allBudget = budgetProgress.find((b) => b.category_id === null);
  const totalBudgetLimit = allBudget
    ? allBudget.amount_limit
    : budgetProgress.length > 0
      ? budgetProgress.reduce((acc, b) => acc + b.amount_limit, 0)
      : null;

  const totalExpAll = operationalExpense + capitalWithdrawal;
  const totalIncAll = operationalIncome + capitalInjection;

  const categoryBreakdown: CategoryMonthlyBreakdownItem[] = [];
  for (const [key, item] of currCatMap.entries()) {
    const prevAmt = prevCatTotals.get(key) ?? 0;
    const deltaAmount = item.currentAmount - prevAmt;
    const deltaPct =
      prevAmt > 0 ? Math.trunc((deltaAmount * 100) / prevAmt) : null;
    const denom = item.kind === "EXPENSE" ? totalExpAll : totalIncAll;
    const shareBps =
      denom > 0 ? Math.trunc((item.currentAmount * 10_000) / denom) : 0;

    categoryBreakdown.push({
      category_id: item.canonId,
      category_name: item.canonName,
      kind: item.kind,
      is_system: item.isSystem,
      current_amount: item.currentAmount,
      prev_amount: prevAmt,
      delta_amount: deltaAmount,
      delta_pct: deltaPct,
      share_bps: shareBps,
      tx_count: item.txCount,
    });
  }
  categoryBreakdown.sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      b.current_amount - a.current_amount ||
      b.prev_amount - a.prev_amount ||
      a.category_name.localeCompare(b.category_name)
  );

  // 4. Account Reconciliation
  const roots = resolveAccountRootsMap(db);
  const reconMap = new Map<string, AccountReconciliationItem>();
  const allAccs = db.selectArrays(
    `SELECT id, name, account_type, initial_balance, merged_into_id
     FROM accounts
     WHERE is_deleted = 0`
  );

  for (const r of allAccs) {
    const id = String(r[0]);
    const name = String(r[1]);
    const accType = String(r[2]) as AccountType;
    const initBal = Number(r[3]);
    const mergedInto = r[4] !== null ? String(r[4]) : null;
    const rootId = roots.get(id) ?? id;

    if (mergedInto === null || rootId === id) {
      const entry = reconMap.get(rootId) ?? {
        account_id: rootId,
        account_name: name,
        account_type: accType,
        opening_balance: 0,
        month_inflow: 0,
        month_outflow: 0,
        net_change: 0,
        closing_balance: 0,
        tx_count: 0,
      };
      entry.account_name = name;
      entry.account_type = accType;
      entry.opening_balance += initBal;
      reconMap.set(rootId, entry);
    }
  }
  for (const r of allAccs) {
    const id = String(r[0]);
    const initBal = Number(r[3]);
    const mergedInto = r[4] !== null ? String(r[4]) : null;
    if (mergedInto !== null) {
      const rootId = roots.get(id) ?? id;
      if (rootId !== id) {
        const rootItem = reconMap.get(rootId);
        if (rootItem) {
          rootItem.opening_balance += initBal;
        }
      }
    }
  }

  const reconTxRows = db.selectArrays(
    `SELECT account_id, to_account_id, amount, tx_type, tx_date
     FROM transactions
     WHERE is_deleted = 0
       AND tx_date < ?1`,
    [endDate]
  );
  for (const r of reconTxRows) {
    const accId = String(r[0]);
    const toAccId = r[1] !== null ? String(r[1]) : null;
    const amount = Number(r[2]);
    const txType = String(r[3]);
    const txDate = String(r[4]);
    const srcRoot = roots.get(accId) ?? accId;
    const isBeforeMonth = txDate < startDate;
    const absAmt = Math.abs(amount);

    if (isBeforeMonth) {
      if (txType === "INCOME" || txType === "EXPENSE") {
        const item = reconMap.get(srcRoot);
        if (item) item.opening_balance += amount;
      } else if (txType === "TRANSFER") {
        const item = reconMap.get(srcRoot);
        if (item) item.opening_balance -= absAmt;
        if (toAccId) {
          const dstRoot = roots.get(toAccId) ?? toAccId;
          const dstItem = reconMap.get(dstRoot);
          if (dstItem) dstItem.opening_balance += absAmt;
        }
      }
    } else {
      if (txType === "INCOME") {
        const item = reconMap.get(srcRoot);
        if (item) {
          item.month_inflow += absAmt;
          item.tx_count += 1;
        }
      } else if (txType === "EXPENSE") {
        const item = reconMap.get(srcRoot);
        if (item) {
          item.month_outflow += absAmt;
          item.tx_count += 1;
        }
      } else if (txType === "TRANSFER") {
        const item = reconMap.get(srcRoot);
        if (item) {
          item.month_outflow += absAmt;
          item.tx_count += 1;
        }
        if (toAccId) {
          const dstRoot = roots.get(toAccId) ?? toAccId;
          const dstItem = reconMap.get(dstRoot);
          if (dstItem) {
            dstItem.month_inflow += absAmt;
            dstItem.tx_count += 1;
          }
        }
      }
    }
  }

  const accountReconciliation = Array.from(reconMap.values()).map((item) => {
    const netChange = item.month_inflow - item.month_outflow;
    return {
      ...item,
      net_change: netChange,
      closing_balance: item.opening_balance + netChange,
    };
  });
  accountReconciliation.sort(
    (a, b) =>
      a.account_name.localeCompare(b.account_name) ||
      a.account_id.localeCompare(b.account_id)
  );

  // 5. Device Contributions
  const totalDevTx = Math.max(1, txCount);
  const localDevId =
    (db.selectValue("SELECT value FROM meta WHERE key = 'device_id'") as string) ||
    null;
  const localDevName =
    (db.selectValue("SELECT value FROM meta WHERE key = 'device_name'") as string) ||
    null;
  const peerNameRows = db.selectArrays(
    "SELECT device_id, device_name, custom_alias FROM sync_peers WHERE device_id IS NOT NULL"
  );
  const peerNameMap = new Map<string, string>();
  for (const r of peerNameRows) {
    const devId = String(r[0]);
    const aliasOrName =
      r[2] !== null ? String(r[2]) : r[1] !== null ? String(r[1]) : null;
    if (aliasOrName) {
      peerNameMap.set(devId, aliasOrName);
    }
  }

  const deviceContributions: DeviceContributionItem[] = Array.from(
    deviceMap.entries()
  ).map(([deviceId, stats]) => {
    const resolvedName =
      deviceId === localDevId
        ? localDevName
        : peerNameMap.get(deviceId) || null;
    return {
      device_id: deviceId,
      device_name: resolvedName,
      tx_count: stats.txCount,
      total_income: stats.income,
      total_expense: stats.expense,
      share_bps: Math.trunc((stats.txCount * 10_000) / totalDevTx),
    };
  });
  deviceContributions.sort(
    (a, b) =>
      b.tx_count - a.tx_count || a.device_id.localeCompare(b.device_id)
  );

  // 6. Top 5 Expenses in Month
  const monthEndInclusive = `${trimmedMonth}-${daysInMonth
    .toString()
    .padStart(2, "0")}`;
  const topTxPage = listTransactionsInDb(db, {
    start_date: startDate,
    end_date: monthEndInclusive,
    tx_type: "EXPENSE",
    sort_by: "amount",
    sort_dir: "desc",
    limit: 5,
    offset: 0,
  });

  return {
    month: trimmedMonth,
    prev_month: prevMonth,
    days_in_month: daysInMonth,
    elapsed_days: elapsedDays,
    no_spend_days: noSpendDays,
    tx_count: txCount,
    operational_income: operationalIncome,
    operational_expense: operationalExpense,
    operational_net: operationalNet,
    prev_operational_income: prevOperationalIncome,
    prev_operational_expense: prevOperationalExpense,
    capital_injection: capitalInjection,
    capital_withdrawal: capitalWithdrawal,
    savings_rate_bps: savingsRateBps,
    daily_burn_rate: dailyBurnRate,
    projected_month_expense: projectedMonthExpense,
    total_budget_limit: totalBudgetLimit,
    daily_series: dailySeries,
    category_breakdown: categoryBreakdown,
    account_reconciliation: accountReconciliation,
    device_contributions: deviceContributions,
    top_expenses: topTxPage.items,
  };
}

