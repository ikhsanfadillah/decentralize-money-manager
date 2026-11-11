import { jsonSchema, tool, type ToolSet } from "ai";
import {
  tauriApi,
  type AccountView,
  type TransactionType,
} from "../../tauri-api";
import { currentYearMonth, todayIsoDate } from "../../utils";
import {
  matchAccountByName,
  matchCategoryByName,
  normalizeLookupText,
} from "../matchers";
import type { ProposedBudgetDraft, ProposedTransactionDraft } from "../types";

export interface ToolFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface AgentToolExecutionContext {
  bookId: string;
  onToolStep?: (stepLabel: string) => void;
  collectedTransactions: ProposedTransactionDraft[];
  collectedBudgets: ProposedBudgetDraft[];
}

export const COPILOT_TOOL_DECLARATIONS: ToolFunctionDeclaration[] = [
  {
    name: "get_book_overview",
    description:
      "Mengambil daftar rekening beserta saldo terkini, daftar kategori aktif, dan ringkasan arus kas 6 bulan terakhir pada buku aktif.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "search_transactions",
    description:
      "Mencari dan memfilter daftar transaksi pada buku aktif berdasarkan tanggal, kata kunci catatan, tipe transaksi, kategori, atau rekening.",
    parameters: {
      type: "object",
      properties: {
        start_date: {
          type: ["string", "null"],
          description: "Tanggal awal format YYYY-MM-DD (opsional)",
        },
        end_date: {
          type: ["string", "null"],
          description: "Tanggal akhir format YYYY-MM-DD (opsional)",
        },
        search: {
          type: ["string", "null"],
          description:
            "Kata kunci pencarian pada catatan/kategori (opsional)",
        },
        tx_type: {
          type: ["string", "null"],
          enum: ["EXPENSE", "INCOME", "TRANSFER", null],
          description: "Filter jenis transaksi (opsional)",
        },
        category_name: {
          type: ["string", "null"],
          description: "Nama kategori yang ingin difilter (opsional)",
        },
        account_name: {
          type: ["string", "null"],
          description: "Nama rekening/dompet yang ingin difilter (opsional)",
        },
        sort_by: {
          type: ["string", "null"],
          enum: ["tx_date", "amount", null],
          description:
            "Urutkan berdasarkan tanggal (tx_date) atau nominal (amount)",
        },
        sort_dir: {
          type: ["string", "null"],
          enum: ["asc", "desc", null],
          description: "Arah urutan asc atau desc (default desc)",
        },
        limit: {
          type: ["number", "null"],
          description:
            "Jumlah maksimal transaksi yang diambil (1 - 30, default 15)",
        },
      },
    },
  },
  {
    name: "get_monthly_report",
    description:
      "Mengambil laporan analitik bulanan lengkap: pemasukan/pengeluaran operasional, rasio tabungan, rata-rata pengeluaran harian (burn rate), rincian kategori MoM, rekonsiliasi saldo rekening, dan kontribusi perangkat P2P.",
    parameters: {
      type: "object",
      properties: {
        month: {
          type: ["string", "null"],
          description:
            "Bulan laporan format YYYY-MM (contoh: 2026-11). Kosongkan atau null untuk bulan berjalan.",
        },
      },
    },
  },
  {
    name: "get_budget_progress",
    description:
      "Mengambil daftar target anggaran bulanan beserta realisasi pemakaian (spent, remaining, persentase, dan status OK/WARNING/OVER).",
    parameters: {
      type: "object",
      properties: {
        month: {
          type: ["string", "null"],
          description:
            "Bulan anggaran format YYYY-MM. Kosongkan atau null untuk bulan berjalan.",
        },
      },
    },
  },
  {
    name: "propose_transactions",
    description:
      "Mengajukan draf pencatatan 1 atau beberapa transaksi baru untuk dikonfirmasi oleh pengguna di antarmuka chat. Jangan gunakan tool ini jika pengguna belum menyebutkan rekening asal dan terdapat lebih dari 1 rekening di buku (tanyakan ke pengguna terlebih dahulu).",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Daftar transaksi yang diusulkan untuk dicatat",
          items: {
            type: "object",
            properties: {
              tx_type: {
                type: "string",
                enum: ["EXPENSE", "INCOME", "TRANSFER"],
                description: "Jenis transaksi: EXPENSE, INCOME, atau TRANSFER",
              },
              amount: {
                type: "number",
                description:
                  "Nominal uang dalam Rupiah bulat positif (contoh: 45000)",
              },
              account_name: {
                type: ["string", "null"],
                description:
                  "Nama rekening/dompet asal (contoh: Kas Tunai, BCA, GoPay). Isi null atau kosongkan jika belum diketahui.",
              },
              to_account_name: {
                type: ["string", "null"],
                description:
                  "Nama rekening tujuan khusus untuk TRANSFER (opsional). Isi null atau kosongkan jika bukan transfer.",
              },
              category_name: {
                type: ["string", "null"],
                description:
                  "Nama kategori untuk EXPENSE atau INCOME (opsional)",
              },
              tx_date: {
                type: ["string", "null"],
                description:
                  "Tanggal transaksi format YYYY-MM-DD (opsional, default hari ini)",
              },
              note: {
                type: ["string", "null"],
                description: "Catatan singkat transaksi (opsional)",
              },
            },
            required: ["tx_type", "amount"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "propose_budgets",
    description:
      "Mengajukan draf pembuatan atau pembaruan target anggaran bulanan untuk dikonfirmasi oleh pengguna di antarmuka chat.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Daftar target anggaran bulanan yang diusulkan",
          items: {
            type: "object",
            properties: {
              category_name: {
                type: "string",
                description:
                  "Nama kategori pengeluaran, atau gunakan 'Total Pengeluaran' untuk batas total seluruh belanja bulanan",
              },
              amount_limit: {
                type: "number",
                description:
                  "Batas anggaran bulanan dalam Rupiah bulat positif (contoh: 1500000)",
              },
              alert_threshold_pct: {
                type: ["number", "null"],
                description:
                  "Ambang batas peringatan dalam persen (50-100, default 80)",
              },
              reason: {
                type: ["string", "null"],
                description:
                  "Alasan singkat rekomendasi anggaran ini (opsional)",
              },
            },
            required: ["category_name", "amount_limit"],
          },
        },
      },
      required: ["items"],
    },
  },
];

const TOOL_STEP_LABELS: Record<string, string> = {
  get_book_overview: "Memeriksa saldo rekening & ringkasan buku...",
  search_transactions: "Mencari data transaksi...",
  get_monthly_report: "Menganalisis laporan bulanan...",
  get_budget_progress: "Memeriksa progres anggaran...",
  propose_transactions: "Menyiapkan draf transaksi...",
  propose_budgets: "Menyiapkan draf target anggaran...",
};

async function handleGetBookOverview(ctx: AgentToolExecutionContext) {
  const [balances, categories, cashFlow] = await Promise.all([
    tauriApi.getAccountBalances(ctx.bookId),
    tauriApi.listCategories(ctx.bookId),
    tauriApi.getCashFlowSummary(ctx.bookId, 6),
  ]);

  const activeCategories = categories
    .filter((c) => !c.merged_into_id && c.is_deleted === 0)
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));

  const totalBalance = balances.reduce((sum, b) => sum + b.current_balance, 0);

  return {
    today: todayIsoDate(),
    current_month: currentYearMonth(),
    total_balance_rupiah: totalBalance,
    accounts: balances.map((b) => ({
      id: b.account_id,
      name: b.name,
      type: b.account_type,
      current_balance: b.current_balance,
    })),
    categories: activeCategories,
    recent_6_months_cash_flow: cashFlow,
  };
}

async function handleSearchTransactions(
  args: Record<string, unknown>,
  ctx: AgentToolExecutionContext
) {
  const [accounts, categories] = await Promise.all([
    tauriApi.listAccounts(ctx.bookId),
    tauriApi.listCategories(ctx.bookId),
  ]);

  let accountIdFilter: string | null = null;
  if (typeof args.account_name === "string" && args.account_name.trim()) {
    const matchedAcc = matchAccountByName(accounts, args.account_name);
    if (matchedAcc) accountIdFilter = matchedAcc.id;
  }

  let categoryIdFilter: string | null = null;
  if (typeof args.category_name === "string" && args.category_name.trim()) {
    const normTarget = normalizeLookupText(args.category_name);
    const foundCat = categories.find(
      (c) =>
        !c.merged_into_id &&
        (normalizeLookupText(c.name).includes(normTarget) ||
          normTarget.includes(normalizeLookupText(c.name)))
    );
    if (foundCat) categoryIdFilter = foundCat.id;
  }

  const rawLimit = typeof args.limit === "number" ? args.limit : 15;
  const limit = Math.max(1, Math.min(30, Math.trunc(rawLimit)));

  const result = await tauriApi.listTransactions(ctx.bookId, {
    start_date:
      typeof args.start_date === "string" ? args.start_date : null,
    end_date: typeof args.end_date === "string" ? args.end_date : null,
    search: typeof args.search === "string" ? args.search : null,
    tx_type:
      args.tx_type === "EXPENSE" ||
      args.tx_type === "INCOME" ||
      args.tx_type === "TRANSFER"
        ? args.tx_type
        : null,
    account_id: accountIdFilter,
    category_id: categoryIdFilter,
    sort_by: args.sort_by === "amount" ? "amount" : "tx_date",
    sort_dir: args.sort_dir === "asc" ? "asc" : "desc",
    limit,
    offset: 0,
  });

  return {
    total_matching: result.total,
    returned_count: result.items.length,
    transactions: result.items.map((t) => ({
      id: t.id,
      tx_date: t.tx_date,
      tx_type: t.tx_type,
      amount: t.amount,
      account_name: t.account_name,
      to_account_name: t.to_account_name,
      category_name: t.category_name,
      note: t.note,
    })),
  };
}

async function handleGetMonthlyReport(
  args: Record<string, unknown>,
  ctx: AgentToolExecutionContext
) {
  const month =
    typeof args.month === "string" && /^\d{4}-\d{2}$/.test(args.month.trim())
      ? args.month.trim()
      : currentYearMonth();
  const report = await tauriApi.getMonthlyReport(ctx.bookId, month);
  return {
    month: report.month,
    prev_month: report.prev_month,
    operational_income: report.operational_income,
    operational_expense: report.operational_expense,
    operational_net: report.operational_net,
    prev_operational_income: report.prev_operational_income,
    prev_operational_expense: report.prev_operational_expense,
    savings_rate_pct: Number((report.savings_rate_bps / 100).toFixed(2)),
    daily_burn_rate: report.daily_burn_rate,
    projected_month_expense: report.projected_month_expense,
    total_budget_limit: report.total_budget_limit,
    no_spend_days: report.no_spend_days,
    elapsed_days: report.elapsed_days,
    tx_count: report.tx_count,
    capital_injection: report.capital_injection,
    capital_withdrawal: report.capital_withdrawal,
    category_breakdown: report.category_breakdown.map((c) => ({
      category_name: c.category_name,
      kind: c.kind,
      current_amount: c.current_amount,
      prev_amount: c.prev_amount,
      delta_amount: c.delta_amount,
      delta_pct: c.delta_pct,
      share_pct: Number((c.share_bps / 100).toFixed(1)),
      tx_count: c.tx_count,
    })),
    account_reconciliation: report.account_reconciliation,
    device_contributions: report.device_contributions,
    top_expenses: report.top_expenses.map((t) => ({
      tx_date: t.tx_date,
      amount: Math.abs(t.amount),
      category_name: t.category_name,
      account_name: t.account_name,
      note: t.note,
    })),
  };
}

async function handleGetBudgetProgress(
  args: Record<string, unknown>,
  ctx: AgentToolExecutionContext
) {
  const month =
    typeof args.month === "string" && /^\d{4}-\d{2}$/.test(args.month.trim())
      ? args.month.trim()
      : currentYearMonth();
  const items = await tauriApi.getBudgetProgress(ctx.bookId, month);
  return {
    month,
    budgets: items.map((b) => ({
      category_name:
        b.category_id === null ? "Total Pengeluaran" : b.category_name,
      amount_limit: b.amount_limit,
      spent: b.spent,
      remaining: b.remaining,
      pct: b.pct,
      status: b.status,
    })),
  };
}

async function handleProposeTransactions(
  args: Record<string, unknown>,
  ctx: AgentToolExecutionContext
) {
  const [accounts, categories] = await Promise.all([
    tauriApi.listAccounts(ctx.bookId),
    tauriApi.listCategories(ctx.bookId),
  ]);
  const activeAccounts = accounts.filter(
    (a) => !a.merged_into_id && a.is_deleted === 0
  );

  if (activeAccounts.length === 0) {
    return {
      status: "ERROR_NO_ACCOUNTS",
      message:
        "Buku ini belum memiliki rekening aktif. Mohon tambahkan rekening terlebih dahulu melalui menu Rekening.",
    };
  }

  const rawItems = Array.isArray(args.items) ? args.items : [];
  if (rawItems.length === 0) {
    return {
      status: "ERROR_NO_ITEMS",
      message: "Tidak ada transaksi yang diusulkan untuk dicatat.",
    };
  }

  // 1. Check if any item is missing source account when book has > 1 active account
  const missingAccountItem = rawItems.find((it) => {
    const item = it as Record<string, unknown>;
    const rawAcc =
      typeof item.account_name === "string" ? item.account_name.trim() : "";
    return !rawAcc && activeAccounts.length > 1;
  });

  if (missingAccountItem) {
    return {
      status: "NEED_ACCOUNT_CLARIFICATION",
      missing_field: "account_name",
      message:
        `Pengguna belum menyebutkan rekening/dompet asal yang ingin digunakan, dan buku ini memiliki ${activeAccounts.length} rekening aktif. JANGAN langsung membuat transaksi. Tanyakan secara ramah kepada pengguna ingin dicatat dari rekening yang mana dari daftar pilihan berikut:\n` +
        activeAccounts
          .map((a) => `- ${a.name} (${a.account_type})`)
          .join("\n"),
      available_accounts: activeAccounts.map((a) => ({
        name: a.name,
        account_type: a.account_type,
      })),
    };
  }

  // 2. Check if any TRANSFER item is missing destination account
  const missingTransferDestination = rawItems.find((it) => {
    const item = it as Record<string, unknown>;
    const txTypeRaw = String(item.tx_type ?? "").toUpperCase();
    if (txTypeRaw !== "TRANSFER") return false;
    const rawToAcc =
      typeof item.to_account_name === "string"
        ? item.to_account_name.trim()
        : "";
    return !rawToAcc && activeAccounts.length > 1;
  });

  if (missingTransferDestination) {
    return {
      status: "NEED_TRANSFER_DESTINATION_CLARIFICATION",
      missing_field: "to_account_name",
      message:
        "Transaksi transfer membutuhkan rekening tujuan, namun belum disebutkan. Tanyakan secara ramah kepada pengguna ingin mentransfer ke rekening yang mana dari pilihan berikut:\n" +
        activeAccounts.map((a) => `- ${a.name}`).join("\n"),
      available_accounts: activeAccounts.map((a) => a.name),
    };
  }

  // 3. Check if both category_name and note are empty on non-transfer items
  const missingCategoryItem = rawItems.find((it) => {
    const item = it as Record<string, unknown>;
    const txTypeRaw = String(item.tx_type ?? "EXPENSE").toUpperCase();
    if (txTypeRaw === "TRANSFER") return false;
    const rawCat =
      typeof item.category_name === "string"
        ? item.category_name.trim()
        : "";
    const rawNote =
      typeof item.note === "string" ? item.note.trim() : "";
    return !rawCat && !rawNote;
  });

  if (missingCategoryItem) {
    const txKind =
      String(missingCategoryItem.tx_type ?? "").toUpperCase() === "INCOME"
        ? "INCOME"
        : "EXPENSE";
    const activeCategories = categories.filter(
      (c) => c.kind === txKind && !c.merged_into_id && c.is_deleted === 0
    );
    return {
      status: "NEED_CATEGORY_CLARIFICATION",
      missing_field: "category_name",
      message:
        `Kategori transaksi belum jelas. Tanyakan secara ramah kepada pengguna transaksi ini masuk ke kategori apa dari daftar kategori yang tersedia:\n` +
        activeCategories
          .slice(0, 8)
          .map((c) => `- ${c.name}`)
          .join("\n"),
      available_categories: activeCategories.map((c) => c.name),
    };
  }

  const createdDrafts: ProposedTransactionDraft[] = [];

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i] as Record<string, unknown>;
    const txTypeRaw = String(item.tx_type ?? "EXPENSE").toUpperCase();
    const tx_type: TransactionType =
      txTypeRaw === "INCOME" || txTypeRaw === "TRANSFER"
        ? txTypeRaw
        : "EXPENSE";

    const amount = Math.max(
      0,
      Math.abs(Math.trunc(Number(item.amount ?? 0)))
    );
    if (amount <= 0) continue;

    const srcAcc = matchAccountByName(
      activeAccounts,
      typeof item.account_name === "string" ? item.account_name : null
    );
    if (!srcAcc) continue;

    let toAcc: AccountView | null = null;
    if (tx_type === "TRANSFER") {
      const candidates = activeAccounts.filter((a) => a.id !== srcAcc.id);
      toAcc =
        matchAccountByName(
          candidates,
          typeof item.to_account_name === "string"
            ? item.to_account_name
            : null
        ) ??
        candidates[0] ??
        null;
    }

    const rawCatName =
      typeof item.category_name === "string" && item.category_name.trim()
        ? item.category_name
        : typeof item.note === "string" && item.note.trim()
          ? item.note
          : null;

    const catMatch =
      tx_type === "TRANSFER"
        ? { matched: null, suggestedNewName: null }
        : matchCategoryByName(categories, tx_type, rawCatName);

    const tx_date =
      typeof item.tx_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.tx_date.trim())
        ? item.tx_date.trim()
        : todayIsoDate();

    const draft: ProposedTransactionDraft = {
      id: `draft-tx-${Date.now()}-${i}`,
      tx_type,
      account_id: srcAcc.id,
      account_name: srcAcc.name,
      to_account_id: toAcc?.id ?? null,
      to_account_name: toAcc?.name ?? null,
      category_id: catMatch.matched?.id ?? null,
      category_name:
        catMatch.suggestedNewName ?? catMatch.matched?.name ?? null,
      suggested_new_category: catMatch.suggestedNewName,
      amount,
      tx_date,
      note:
        typeof item.note === "string" && item.note.trim()
          ? item.note.trim()
          : typeof item.category_name === "string" &&
              item.category_name.trim()
            ? item.category_name.trim()
            : "Transaksi via AI Assistant",
    };
    createdDrafts.push(draft);
    ctx.collectedTransactions.push(draft);
  }

  return {
    status: "PROPOSED_AWAITING_USER_CONFIRMATION",
    proposed_count: createdDrafts.length,
    message:
      "Kartu konfirmasi transaksi telah ditampilkan kepada pengguna. Beri tahu pengguna untuk menekan tombol 'Simpan Transaksi' pada kartu di bawah pesan.",
  };
}

async function handleProposeBudgets(
  args: Record<string, unknown>,
  ctx: AgentToolExecutionContext
) {
  const categories = await tauriApi.listCategories(ctx.bookId);
  const rawItems = Array.isArray(args.items) ? args.items : [];
  const createdBudgets: ProposedBudgetDraft[] = [];

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i] as Record<string, unknown>;
    const amount_limit = Math.max(
      0,
      Math.abs(Math.trunc(Number(item.amount_limit ?? 0)))
    );
    if (amount_limit <= 0) continue;

    const rawCatName =
      typeof item.category_name === "string"
        ? item.category_name.trim()
        : "Total Pengeluaran";
    const normName = normalizeLookupText(rawCatName);
    const isTotalBudget =
      normName === "all" ||
      normName === "semua" ||
      normName.includes("totalpengeluaran") ||
      normName.includes("semuabelanja");

    let category_id: string | null = null;
    let category_name = "Total Pengeluaran";

    if (!isTotalBudget) {
      const matched = matchCategoryByName(
        categories,
        "EXPENSE",
        rawCatName
      );
      if (matched.matched) {
        category_id = matched.matched.id;
        category_name = matched.matched.name;
      } else {
        category_name = rawCatName;
      }
    }

    const thresholdRaw = Number(item.alert_threshold_pct ?? 80);
    const alert_threshold_pct = Number.isFinite(thresholdRaw)
      ? Math.max(50, Math.min(100, Math.trunc(thresholdRaw)))
      : 80;

    const draft: ProposedBudgetDraft = {
      id: `draft-budget-${Date.now()}-${i}`,
      category_id,
      category_name,
      amount_limit,
      alert_threshold_pct,
      reason:
        typeof item.reason === "string" && item.reason.trim()
          ? item.reason.trim()
          : undefined,
    };
    createdBudgets.push(draft);
    ctx.collectedBudgets.push(draft);
  }

  return {
    status: "PROPOSED_AWAITING_USER_CONFIRMATION",
    proposed_count: createdBudgets.length,
    message:
      "Kartu konfirmasi anggaran telah ditampilkan kepada pengguna. Beri tahu pengguna untuk menekan tombol 'Terapkan Anggaran' pada kartu di bawah pesan.",
  };
}

export async function executeCopilotToolCall(
  toolName: string,
  args: Record<string, unknown>,
  ctx: AgentToolExecutionContext
): Promise<unknown> {
  ctx.onToolStep?.(TOOL_STEP_LABELS[toolName] ?? `Menjalankan ${toolName}...`);

  switch (toolName) {
    case "get_book_overview":
      return handleGetBookOverview(ctx);
    case "search_transactions":
      return handleSearchTransactions(args, ctx);
    case "get_monthly_report":
      return handleGetMonthlyReport(args, ctx);
    case "get_budget_progress":
      return handleGetBudgetProgress(args, ctx);
    case "propose_transactions":
      return handleProposeTransactions(args, ctx);
    case "propose_budgets":
      return handleProposeBudgets(args, ctx);
    default:
      return { error: `Tool '${toolName}' tidak dikenali.` };
  }
}

/**
 * Builds a Vercel AI SDK `ToolSet` wired to `executeCopilotToolCall` for `generateText`.
 */
export function buildCopilotVercelTools(
  ctx: AgentToolExecutionContext
): ToolSet {
  const toolSet: ToolSet = {};
  for (const decl of COPILOT_TOOL_DECLARATIONS) {
    toolSet[decl.name] = tool({
      description: decl.description,
      inputSchema: jsonSchema<Record<string, unknown>>(decl.parameters),
      execute: async (args) => executeCopilotToolCall(decl.name, args, ctx),
    });
  }
  return toolSet;
}

