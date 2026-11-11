import type { AccountView, CategoryView } from "../tauri-api";

export function normalizeLookupText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z0-9]/g, "");
}

export function matchAccountByName(
  accounts: AccountView[],
  queryName?: string | null
): AccountView | null {
  const active = accounts.filter(
    (a) => !a.merged_into_id && a.is_deleted === 0
  );
  if (active.length === 0) return null;
  if (!queryName || !queryName.trim()) {
    return active[0];
  }

  const normQuery = normalizeLookupText(queryName);
  if (!normQuery) return active[0];

  // 1. Exact match on id or normalized name
  const exact = active.find(
    (a) =>
      a.id === queryName.trim() || normalizeLookupText(a.name) === normQuery
  );
  if (exact) return exact;

  // 2. Substring match
  const partial = active.find((a) => {
    const normAcc = normalizeLookupText(a.name);
    return normAcc.includes(normQuery) || normQuery.includes(normAcc);
  });
  if (partial) return partial;

  // 3. Account type hint match (e.g., "tunai"/"cash", "bank", "ewallet"/"gopay"/"ovo")
  if (
    normQuery.includes("tunai") ||
    normQuery.includes("kas") ||
    normQuery.includes("cash")
  ) {
    const cashAcc = active.find((a) => a.account_type === "CASH");
    if (cashAcc) return cashAcc;
  }
  if (
    normQuery.includes("gopay") ||
    normQuery.includes("ovo") ||
    normQuery.includes("dana") ||
    normQuery.includes("shopeepay") ||
    normQuery.includes("wallet")
  ) {
    const walletAcc = active.find((a) => a.account_type === "EWALLET");
    if (walletAcc) return walletAcc;
  }
  if (
    normQuery.includes("bank") ||
    normQuery.includes("bca") ||
    normQuery.includes("mandiri") ||
    normQuery.includes("bri") ||
    normQuery.includes("bni")
  ) {
    const bankAcc = active.find((a) => a.account_type === "BANK");
    if (bankAcc) return bankAcc;
  }

  return active[0];
}

export function matchCategoryByName(
  categories: CategoryView[],
  kind: "EXPENSE" | "INCOME",
  queryName?: string | null
): { matched: CategoryView | null; suggestedNewName: string | null } {
  const active = categories.filter(
    (c) => c.kind === kind && !c.merged_into_id && c.is_deleted === 0
  );
  if (!queryName || !queryName.trim()) {
    return { matched: active[0] ?? null, suggestedNewName: null };
  }

  const trimmed = queryName.trim();
  const normQuery = normalizeLookupText(trimmed);
  if (!normQuery) {
    return { matched: active[0] ?? null, suggestedNewName: null };
  }

  // 1. Exact id or normalized name
  const exact = active.find(
    (c) => c.id === trimmed || normalizeLookupText(c.name) === normQuery
  );
  if (exact) {
    return { matched: exact, suggestedNewName: null };
  }

  // 2. Substring match
  const partial = active.find((c) => {
    const normCat = normalizeLookupText(c.name);
    return normCat.includes(normQuery) || normQuery.includes(normCat);
  });
  if (partial) {
    return { matched: partial, suggestedNewName: null };
  }

  return {
    matched: active[0] ?? null,
    suggestedNewName: trimmed,
  };
}

