import { tauriApi } from "../../../lib/tauri-api";
import { pushToast } from "../../../lib/toast";
import { formatRupiah } from "../../../lib/utils";

export async function checkBudgetThresholdAfterExpense(
  bookId: string,
  txDate: string,
  categoryId: string
): Promise<void> {
  const month = txDate.slice(0, 7);
  try {
    const progressList = await tauriApi.getBudgetProgress(bookId, month);
    for (const b of progressList) {
      const isRelevant =
        b.category_id === null || b.category_id === categoryId;
      if (isRelevant && (b.status === "OVER" || b.status === "WARNING")) {
        pushToast(
          b.status === "OVER"
            ? `Anggaran "${b.category_name}" Melebihi Batas (${b.pct}%)`
            : `Peringatan Anggaran "${b.category_name}" (${b.pct}%)`,
          {
            description: `Terpakai ${formatRupiah(b.spent)} dari batas ${formatRupiah(b.amount_limit)} pada bulan ${month}.`,
            variant: b.status === "OVER" ? "error" : "warning",
          }
        );
      }
    }
  } catch {
    // Non-fatal check
  }
}

