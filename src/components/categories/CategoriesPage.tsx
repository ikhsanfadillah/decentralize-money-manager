import * as React from "react";
import { useBookFinance } from "../../hooks/useBookFinance";
import type { CategoryKind, CategoryView } from "../../lib/tauri-api";
import { Input } from "../ui/input";
import { pushToast } from "../../lib/toast";

export interface CategoriesPageProps {
  bookId: string;
}

export const CategoriesPage: React.FC<CategoriesPageProps> = ({ bookId }) => {
  const {
    categoriesQuery,
    upsertCategoryMutation,
    deleteCategoryMutation,
  } = useBookFinance({ bookId });

  const [editingCategory, setEditingCategory] =
    React.useState<CategoryView | null>(null);
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<CategoryKind>("EXPENSE");
  const [filterKind, setFilterKind] = React.useState<"ALL" | CategoryKind>(
    "ALL"
  );

  const categories = categoriesQuery.data ?? [];

  const filteredCategories = React.useMemo(() => {
    if (filterKind === "ALL") {
      return categories;
    }
    return categories.filter((c) => c.kind === filterKind);
  }, [categories, filterKind]);

  const handleStartEdit = (cat: CategoryView) => {
    setEditingCategory(cat);
    setName(cat.name);
    setKind(cat.kind);
  };

  const handleResetForm = () => {
    setEditingCategory(null);
    setName("");
    setKind("EXPENSE");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      pushToast("Nama kategori tidak boleh kosong", { variant: "warning" });
      return;
    }

    try {
      await upsertCategoryMutation.mutateAsync({
        id: editingCategory?.id ?? null,
        name: trimmed,
        kind,
      });
      pushToast(
        editingCategory
          ? `Kategori "${trimmed}" diperbarui`
          : `Kategori "${trimmed}" disimpan`,
        { variant: "success" }
      );
      handleResetForm();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menyimpan kategori";
      pushToast("Gagal menyimpan kategori", {
        description: msg,
        variant: "error",
      });
    }
  };

  const handleDelete = async (cat: CategoryView) => {
    try {
      await deleteCategoryMutation.mutateAsync(cat.id);
      pushToast(`Kategori "${cat.name}" dihapus`, { variant: "info" });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menghapus kategori";
      pushToast("Gagal menghapus kategori", {
        description: msg,
        variant: "error",
      });
    }
  };

  const isSystemCategory = (normalizedName: string) =>
    normalizedName === "prive/penarikan" || normalizedName === "suntikan modal";

  return (
    <div className="space-y-6">
      {/* Header & Filter Strip */}
      <div className="tabular-grid-container grid grid-cols-1 md:grid-cols-12">
        <div className="tabular-grid-cell flex flex-col justify-center p-4 md:col-span-8">
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            Manajemen Kategori Transaksi
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Kategori dengan nama ternormalisasi dan jenis yang sama antar-perangkat
            akan digabungkan otomatis (`AUTO-MERGED`) oleh mesin CRDT.
          </p>
        </div>

        <div className="tabular-grid-cell flex items-center justify-end gap-1.5 p-4 md:col-span-4">
          {(["ALL", "EXPENSE", "INCOME"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilterKind(tab)}
              className={`rounded border px-2.5 py-1 font-mono text-xs font-medium shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                filterKind === tab
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {tab === "ALL"
                ? "SEMUA"
                : tab === "EXPENSE"
                  ? "PENGELUARAN"
                  : "PEMASUKAN"}
            </button>
          ))}
        </div>
      </div>

      {/* Add / Edit Category Form */}
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="tabular-grid-container grid grid-cols-1 md:grid-cols-12"
      >
        <div className="tabular-grid-cell p-4 md:col-span-6">
          <label
            htmlFor="category-name-input"
            className="mb-1.5 block text-xs font-medium text-foreground"
          >
            {editingCategory ? "Edit Nama Kategori" : "Nama Kategori Baru"}
          </label>
          <Input
            id="category-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Contoh: Makan & Minum, Transportasi, Gaji..."
          />
        </div>

        <div className="tabular-grid-cell p-4 md:col-span-4">
          <label
            htmlFor="category-kind-select"
            className="mb-1.5 block text-xs font-medium text-foreground"
          >
            Jenis Kategori
          </label>
          <select
            id="category-kind-select"
            value={kind}
            onChange={(e) => setKind(e.target.value as CategoryKind)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            <option value="EXPENSE">Pengeluaran (EXPENSE)</option>
            <option value="INCOME">Pemasukan (INCOME)</option>
          </select>
        </div>

        <div className="tabular-grid-cell flex items-end justify-end gap-2 p-4 md:col-span-2">
          {editingCategory && (
            <button
              type="button"
              onClick={handleResetForm}
              className="h-9 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Batal
            </button>
          )}
          <button
            type="submit"
            disabled={upsertCategoryMutation.isPending}
            className="h-9 w-full rounded-md border border-border bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
          >
            {editingCategory ? "Perbarui" : "+ Simpan"}
          </button>
        </div>
      </form>

      {/* Categories Table */}
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell hidden grid-cols-12 items-center px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
          <div className="col-span-5">Nama Kategori</div>
          <div className="col-span-2">Jenis</div>
          <div className="col-span-3">Status Kanonik / Deduplikasi</div>
          <div className="col-span-2 text-right">Aksi</div>
        </div>

        {filteredCategories.length === 0 ? (
          <div className="tabular-grid-cell p-8 text-center text-xs text-muted-foreground">
            Tidak ada kategori yang sesuai dengan filter.
          </div>
        ) : (
          filteredCategories.map((cat) => {
            const isSys = isSystemCategory(cat.normalized_name);
            return (
              <div
                key={cat.id}
                data-testid={`category-row-${cat.id}`}
                className="tabular-grid-cell grid grid-cols-1 items-center gap-2 px-4 py-3 text-xs md:grid-cols-12"
              >
                <div className="md:col-span-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">
                      {cat.name}
                    </span>
                    {isSys && (
                      <span className="rounded border border-primary/40 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                        KATEGORI SISTEM ANTAR-BUKU
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    Normalisasi: &ldquo;{cat.normalized_name}&rdquo; · ID:{" "}
                    {cat.id.slice(0, 8)}
                  </p>
                </div>

                <div className="md:col-span-2">
                  <span
                    className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${
                      cat.kind === "EXPENSE"
                        ? "border-rose-500/40 text-rose-500"
                        : "border-emerald-500/40 text-emerald-500"
                    }`}
                  >
                    {cat.kind === "EXPENSE" ? "PENGELUARAN" : "PEMASUKAN"}
                  </span>
                </div>

                <div className="md:col-span-3">
                  {cat.merged_into_id ? (
                    <span
                      data-testid={`category-auto-merged-${cat.id}`}
                      className="inline-flex items-center rounded border border-amber-500/40 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-500"
                    >
                      AUTO-MERGED → {cat.canonical_id.slice(0, 8)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                      KANONIK ({cat.canonical_id.slice(0, 8)})
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-end gap-1.5 md:col-span-2">
                  <button
                    type="button"
                    onClick={() => handleStartEdit(cat)}
                    className="rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(cat)}
                    className="rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-rose-500 shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

