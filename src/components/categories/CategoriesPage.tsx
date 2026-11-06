import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { useBookFinance } from "../../hooks/useBookFinance";
import type { CategoryKind, CategoryView } from "../../lib/tauri-api";
import { EmptyStateIllustration } from "../ui/EmptyStateIllustration";
import { Input } from "../ui/input";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { DeleteTransactionIllustration } from "../transactions/TransactionTable";
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

  const [isDrawerOpen, setIsDrawerOpen] = React.useState(false);
  const [editingCategory, setEditingCategory] =
    React.useState<CategoryView | null>(null);
  const [categoryPendingDelete, setCategoryPendingDelete] =
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
    setIsDrawerOpen(true);
  };

  const handleResetForm = () => {
    setEditingCategory(null);
    setName("");
    setKind("EXPENSE");
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    handleResetForm();
  };

  const handleSaveCategoryDirect = async (e: React.FormEvent) => {
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
      handleCloseDrawer();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menyimpan kategori";
      pushToast("Gagal menyimpan kategori", {
        description: msg,
        variant: "error",
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!categoryPendingDelete) return;

    try {
      await deleteCategoryMutation.mutateAsync(categoryPendingDelete.id);
      pushToast(`Kategori "${categoryPendingDelete.name}" berhasil dihapus`, {
        variant: "info",
      });
      setCategoryPendingDelete(null);
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
    <div className="w-full">
      {/* 1. Header with Inline Plus Action */}
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                to="/books/$bookId/settings"
                params={{ bookId }}
                className="nav-touch-item inline-flex h-6 shrink-0 items-center rounded border border-border bg-background px-2 font-mono text-[10px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                ← Pengaturan
              </Link>
              <h1 className="truncate text-xs font-semibold tracking-tight text-foreground sm:text-sm">
                Categories
              </h1>
            </div>

            <button
              type="button"
              onClick={() => {
                handleResetForm();
                setIsDrawerOpen(true);
              }}
              title="Tambah Kategori Baru"
              aria-label="Tambah Kategori Baru"
              className="nav-touch-item inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-primary text-primary-foreground hover:opacity-90 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-all"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Kategori dengan nama dan jenis yang sama akan otomatis diselaraskan saat sinkronisasi.
          </p>
        </div>
      </div>

      {/* 2. Filter Tabs Strip */}
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell flex items-center p-0">
          {(["ALL", "EXPENSE", "INCOME"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilterKind(tab)}
              className={`nav-touch-item inline-flex flex-1 justify-center items-center gap-1.5 py-2 px-3 text-xs font-medium border-b-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                filterKind === tab
                  ? "border-primary text-primary font-semibold bg-primary/5"
                  : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {tab === "EXPENSE" && (
                <TrendingDown className="h-3.5 w-3.5 shrink-0 text-rose-500" aria-hidden="true" />
              )}
              {tab === "INCOME" && (
                <TrendingUp className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
              )}
              <span>
                {tab === "ALL"
                  ? "Semua"
                  : tab === "EXPENSE"
                    ? "Pengeluaran"
                    : "Pemasukan"}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 3. Categories List (Master View: Clean Tabular Rows, Tap-to-Edit) */}
      <div className="tabular-grid-container grid grid-cols-1">
        {/* Desktop Header */}
        <div className="tabular-grid-cell hidden grid-cols-12 items-center px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
          <div className="col-span-8">Nama Kategori</div>
          <div className="col-span-4 text-right">Jenis Kategori</div>
        </div>

        {filteredCategories.length === 0 ? (
          <div className="tabular-grid-cell flex flex-col items-center justify-center p-6 text-center text-xs text-muted-foreground">
            <EmptyStateIllustration variant="category-filter" />
            <p className="mt-2">Tidak ada kategori yang sesuai dengan filter.</p>
            <button
              type="button"
              onClick={() => {
                handleResetForm();
                setIsDrawerOpen(true);
              }}
              className="mt-2.5 nav-touch-item inline-flex items-center gap-1 rounded border border-border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              Tambah Kategori Baru
            </button>
          </div>
        ) : (
          filteredCategories.map((cat, idx) => {
            const isSys = isSystemCategory(cat.normalized_name);
            return (
              <div
                key={cat.id}
                data-testid={`category-row-${cat.id}`}
                role="button"
                tabIndex={0}
                onClick={() => handleStartEdit(cat)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleStartEdit(cat);
                  }
                }}
                style={{ animationDelay: `${idx * 25}ms` }}
                className="tabular-grid-cell group nav-touch-item animate-card-up flex cursor-pointer items-center justify-between px-3 py-2.5 text-xs transition-colors hover:bg-muted/60 active:bg-muted/80 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                {/* Left: Category Name + Badges (Max space, no squeeze!) */}
                <div className="flex min-w-0 flex-1 items-center gap-2 pr-3">
                  <span className="truncate font-semibold text-foreground text-xs sm:text-sm">
                    {cat.name}
                  </span>
                  {isSys && (
                    <span className="shrink-0 rounded border border-primary/40 bg-primary/5 px-1.5 py-0.2 font-mono text-[9px] font-semibold text-primary">
                      Bawaan Sistem
                    </span>
                  )}
                  {cat.merged_into_id && (
                    <span
                      data-testid={`category-auto-merged-${cat.id}`}
                      className="shrink-0 rounded border border-amber-500/40 bg-amber-500/5 px-1.5 py-0.2 font-mono text-[9px] font-semibold text-amber-500"
                    >
                      Tergabung
                    </span>
                  )}
                </div>

                {/* Right: Kind Badge + Tap Chevron */}
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                      cat.kind === "EXPENSE"
                        ? "border-rose-500/30 bg-rose-500/10 text-rose-500"
                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                    }`}
                  >
                    {cat.kind === "EXPENSE" ? (
                      <>
                        <TrendingDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>Pengeluaran</span>
                      </>
                    ) : (
                      <>
                        <TrendingUp className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>Pemasukan</span>
                      </>
                    )}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 4. Detail & Edit Drawer (Detail View with Progressive Disclosure) */}
      <Drawer
        open={isDrawerOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleCloseDrawer();
          }
        }}
        shouldScaleBackground={false}
      >
        <DrawerContent className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col rounded-t-xl border-t border-border bg-card p-0 shadow-2xl focus:outline-none sm:mx-auto sm:max-w-lg">
          <form onSubmit={handleSaveCategoryDirect} className="flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
              <div>
                <DrawerTitle
                  id="category-dialog-title"
                  className="text-sm font-semibold text-foreground"
                >
                  {editingCategory
                    ? "Detail & Ubah Kategori"
                    : "Tambah Kategori Baru"}
                </DrawerTitle>
                <DrawerDescription className="text-xs text-muted-foreground">
                  {editingCategory
                    ? "Kelola nama dan jenis kategori transaksi Anda"
                    : "Kategori membantu mengelompokkan pos transaksi"}
                </DrawerDescription>
              </div>
              <button
                type="button"
                onClick={handleCloseDrawer}
                aria-label="Tutup"
                className="nav-touch-item inline-flex h-7 w-7 items-center justify-center rounded border border-border hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="space-y-3.5 px-4 py-4 sm:px-5">
              <div className="space-y-1">
                <label
                  htmlFor="category-name-input"
                  className="text-xs font-medium text-foreground"
                >
                  Nama Kategori
                </label>
                <Input
                  id="category-name-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Makan & Minum, Transportasi, Gaji..."
                  autoFocus
                />
              </div>

              <div className="space-y-1">
                <span className="text-xs font-medium text-foreground">
                  Jenis Kategori
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setKind("EXPENSE")}
                    className={`nav-touch-item flex items-center justify-center gap-1.5 rounded border py-2 px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                      kind === "EXPENSE"
                        ? "border-rose-500/40 bg-rose-500/10 font-semibold text-rose-500"
                        : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <TrendingDown className="h-3.5 w-3.5 shrink-0" />
                    <span>Pengeluaran</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setKind("INCOME")}
                    className={`nav-touch-item flex items-center justify-center gap-1.5 rounded border py-2 px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                      kind === "INCOME"
                        ? "border-emerald-500/40 bg-emerald-500/10 font-semibold text-emerald-500"
                        : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <TrendingUp className="h-3.5 w-3.5 shrink-0" />
                    <span>Pemasukan</span>
                  </button>
                </div>
              </div>

              {/* Destructive Action inside Detail (Progressive Disclosure) */}
              {editingCategory && (
                <div className="pt-2 border-t border-border/60">
                  {isSystemCategory(editingCategory.normalized_name) ? (
                    <p className="text-[11px] text-muted-foreground italic text-center">
                      Kategori bawaan sistem tidak dapat dihapus.
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const target = editingCategory;
                        handleCloseDrawer();
                        setCategoryPendingDelete(target);
                      }}
                      className="nav-touch-item flex w-full items-center justify-center gap-1.5 rounded border border-rose-500/20 bg-rose-500/5 py-2 text-xs font-medium text-rose-600 hover:bg-rose-500/10 active:scale-[0.99] dark:text-rose-400 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Hapus Kategori Ini</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5 sm:px-5">
              <button
                type="button"
                onClick={handleCloseDrawer}
                className="nav-touch-item rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={upsertCategoryMutation.isPending}
                className="nav-touch-item rounded border border-border bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 active:scale-[0.98] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                {upsertCategoryMutation.isPending
                  ? "Menyimpan..."
                  : editingCategory
                    ? "Simpan Perubahan"
                    : "Simpan Kategori"}
              </button>
            </div>
          </form>
        </DrawerContent>
      </Drawer>

      {/* 5. Dedicated Delete Confirmation Drawer */}
      <Drawer
        open={categoryPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setCategoryPendingDelete(null);
        }}
      >
        <DrawerContent
          aria-describedby="delete-category-confirm-desc"
          className="p-0 sm:mx-auto sm:max-w-md sm:rounded-t-2xl"
        >
          <div className="flex flex-col items-center px-4 pt-5 pb-2 text-center">
            {/* Vector Illustration */}
            <DeleteTransactionIllustration className="h-24 w-24 my-1" />

            <DrawerHeader className="p-0 mt-2 space-y-1 border-0">
              <DrawerTitle className="text-center text-base font-bold text-foreground sm:text-lg">
                Hapus Kategori Ini?
              </DrawerTitle>
              <DrawerDescription
                id="delete-category-confirm-desc"
                className="text-center text-xs text-muted-foreground max-w-xs mx-auto"
              >
                Kategori ini akan dihapus dari buku. Transaksi lama dengan kategori ini tidak akan hilang, namun kategorinya akan menjadi tidak terdefinisi.
              </DrawerDescription>
            </DrawerHeader>

            {/* Category Preview Box */}
            {categoryPendingDelete && (
              <div className="w-full mt-3 rounded-lg border border-border bg-muted/40 p-3 text-left text-xs space-y-1.5">
                <div className="flex items-center justify-between font-semibold">
                  <span className="truncate text-foreground text-sm">
                    {categoryPendingDelete.name}
                  </span>
                  <span
                    className={`rounded border px-1.5 py-0.2 font-mono text-[10px] ${
                      categoryPendingDelete.kind === "EXPENSE"
                        ? "border-rose-500/30 bg-rose-500/10 text-rose-500"
                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                    }`}
                  >
                    {categoryPendingDelete.kind === "EXPENSE"
                      ? "Pengeluaran"
                      : "Pemasukan"}
                  </span>
                </div>
              </div>
            )}
          </div>

          <DrawerFooter className="border-t border-border px-4 py-3 bg-card/60 backdrop-blur-xs flex flex-row items-center gap-2">
            <button
              type="button"
              onClick={() => setCategoryPendingDelete(null)}
              className="nav-touch-item flex-1 h-9 rounded-lg border border-border bg-background px-4 font-mono text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground active:scale-98 transition-all focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={deleteCategoryMutation.isPending}
              onClick={() => void handleConfirmDelete()}
              className="nav-touch-item flex-1 h-9 inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-4 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 active:scale-98 transition-all focus-visible:outline-2 focus-visible:outline-rose-600 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              <span>
                {deleteCategoryMutation.isPending
                  ? "Menghapus..."
                  : "Hapus Kategori"}
              </span>
            </button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
};
