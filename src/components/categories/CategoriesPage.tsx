import * as React from "react";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import {
  ChevronRight,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { useBookFinance } from "../../hooks/useBookFinance";
import { useSmoothReady } from "../../hooks/useSmoothReady";
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

  const shouldReduceMotion = useReducedMotion();
  const { isReady, showSkeleton, didWaitForData } = useSmoothReady(
    categoriesQuery.isPending
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

  if (!isReady) {
    if (!showSkeleton) {
      return <div className="w-full min-h-[45vh]" aria-busy="true" />;
    }
    return (
      <div
        className="animate-page-in w-full space-y-4"
        aria-label="Memuat kategori"
        aria-busy="true"
      >
        <div className="glass-card h-28 animate-pulse p-5" />
        <div className="glass-card h-48 animate-pulse p-5" />
      </div>
    );
  }

  return (
    <motion.div
      initial={
        didWaitForData
          ? { opacity: 0, y: shouldReduceMotion ? 0 : 4 }
          : false
      }
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: shouldReduceMotion ? 0.08 : 0.22,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="w-full space-y-4"
    >
      {/* 1. Header with Inline Plus Action */}
      <div className="glass-card p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link
              to="/books/$bookId/settings"
              params={{ bookId }}
              className="nav-touch-item inline-flex h-8 shrink-0 items-center rounded-full border border-border bg-black/[0.04] dark:bg-white/[0.06] px-3 font-mono text-[11px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              ← Pengaturan
            </Link>
            <h1 className="truncate text-sm font-bold tracking-tight text-foreground sm:text-base">
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
            className="nav-touch-item inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-cta-surface px-3.5 text-xs font-semibold text-cta-foreground hover:opacity-90 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-all"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Kategori Baru</span>
          </button>
        </div>

        <div className="contrast-card px-3.5 py-2.5 text-[11px] text-white/80">
          Kategori dengan nama dan jenis yang sama akan otomatis diselaraskan secara CRDT saat sinkronisasi antar perangkat.
        </div>
      </div>

      {/* 2. Capsule Filter Tabs Strip */}
      <div className="flex items-center gap-1.5 rounded-full border border-border bg-card backdrop-blur-md p-1.5">
        {(["ALL", "EXPENSE", "INCOME"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setFilterKind(tab)}
            className={`nav-touch-item inline-flex flex-1 justify-center items-center gap-1.5 rounded-full py-2 px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
              filterKind === tab
                ? "bg-cta-surface text-cta-foreground font-semibold"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
          >
            {tab === "EXPENSE" && (
              <TrendingDown
                className={`h-3.5 w-3.5 shrink-0 ${filterKind === tab ? "text-rose-500" : "text-rose-400"}`}
                aria-hidden="true"
              />
            )}
            {tab === "INCOME" && (
              <TrendingUp
                className={`h-3.5 w-3.5 shrink-0 ${filterKind === tab ? "text-emerald-500" : "text-emerald-400"}`}
                aria-hidden="true"
              />
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

      {/* 3. Categories Glass List */}
      <div className="glass-card overflow-hidden">
        {/* Desktop Header */}
        <div className="hidden grid-cols-12 items-center border-b border-border/70 bg-black/[0.02] dark:bg-white/[0.04] px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
          <div className="col-span-8">Nama Kategori</div>
          <div className="col-span-4 text-right">Jenis Kategori</div>
        </div>

        <div className="divide-y divide-border/70">
          {filteredCategories.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center text-xs text-muted-foreground">
              <EmptyStateIllustration variant="category-filter" />
              <p className="mt-2">Tidak ada kategori yang sesuai dengan filter.</p>
              <button
                type="button"
                onClick={() => {
                  handleResetForm();
                  setIsDrawerOpen(true);
                }}
                className="mt-3 nav-touch-item inline-flex items-center gap-1.5 rounded-full bg-cta-surface px-4 py-2 text-xs font-semibold text-cta-foreground hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" />
                Tambah Kategori Baru
              </button>
            </div>
          ) : (
            filteredCategories.map((cat) => {
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
                  className="group nav-touch-item flex cursor-pointer items-center justify-between px-4 py-3 text-xs transition-colors hover:bg-white/[0.05] active:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  {/* Left: Category Name + Badges */}
                  <div className="flex min-w-0 flex-1 items-center gap-2 pr-3">
                    <span className="truncate font-semibold text-foreground text-xs sm:text-sm">
                      {cat.name}
                    </span>
                    {isSys && (
                      <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[9px] font-semibold text-primary">
                        Bawaan Sistem
                      </span>
                    )}
                    {cat.merged_into_id && (
                      <span
                        data-testid={`category-auto-merged-${cat.id}`}
                        className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[9px] font-semibold text-amber-400"
                      >
                        Tergabung
                      </span>
                    )}
                  </div>

                  {/* Right: Kind Badge + Tap Chevron */}
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold ${
                        cat.kind === "EXPENSE"
                          ? "border-rose-500/30 bg-rose-500/10 text-rose-500 dark:text-rose-400"
                          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
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
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 4. Detail & Edit Drawer */}
      <Drawer
        open={isDrawerOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleCloseDrawer();
          }
        }}
        shouldScaleBackground={false}
      >
        <DrawerContent className="p-0 data-[vaul-drawer-direction=bottom]:max-h-[90dvh] data-[vaul-drawer-direction=bottom]:w-full data-[vaul-drawer-direction=bottom]:sm:mx-auto sm:max-w-lg">
          <form onSubmit={handleSaveCategoryDirect} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-border/70 px-5 py-3.5">
              <div>
                <DrawerTitle
                  id="category-dialog-title"
                  className="text-sm font-bold text-foreground"
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
                className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-black/[0.04] dark:bg-white/[0.06] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-auto min-h-0 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
              <div className="space-y-1.5">
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

              <div className="space-y-1.5">
                <span className="text-xs font-medium text-foreground">
                  Jenis Kategori
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setKind("EXPENSE")}
                    className={`nav-touch-item flex items-center justify-center gap-1.5 rounded-xl border py-2.5 px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                      kind === "EXPENSE"
                        ? "border-rose-500/40 bg-rose-500/15 font-semibold text-rose-500 dark:text-rose-300"
                        : "border-border bg-black/[0.03] dark:bg-white/[0.05] text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <TrendingDown className="h-3.5 w-3.5 shrink-0" />
                    <span>Pengeluaran</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setKind("INCOME")}
                    className={`nav-touch-item flex items-center justify-center gap-1.5 rounded-xl border py-2.5 px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                      kind === "INCOME"
                        ? "border-emerald-500/40 bg-emerald-500/15 font-semibold text-emerald-600 dark:text-emerald-300"
                        : "border-border bg-black/[0.03] dark:bg-white/[0.05] text-muted-foreground hover:bg-muted"
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
                      className="nav-touch-item flex w-full items-center justify-center gap-1.5 rounded-full border border-rose-500/25 bg-rose-500/10 py-2.5 text-xs font-medium text-rose-600 hover:bg-rose-500/15 active:scale-[0.99] dark:text-rose-400 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Hapus Kategori Ini</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="mt-auto flex shrink-0 items-center justify-end gap-2 border-t border-border/70 px-5 py-3">
              <button
                type="button"
                onClick={handleCloseDrawer}
                className="nav-touch-item rounded-full border border-border bg-black/[0.04] dark:bg-white/[0.06] px-4 py-2 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={upsertCategoryMutation.isPending}
                className="nav-touch-item rounded-full bg-cta-surface px-5 py-2 text-xs font-semibold text-cta-foreground hover:opacity-90 active:scale-[0.98] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
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
          className="p-0 data-[vaul-drawer-direction=bottom]:sm:mx-auto sm:max-w-md"
        >
          <div className="flex flex-auto min-h-0 flex-col overflow-y-auto overscroll-contain px-5 pt-5 pb-3 text-center">
            <div className="my-auto flex w-full flex-col items-center">
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
                <div className="w-full mt-3 rounded-2xl border border-border bg-black/[0.04] dark:bg-white/[0.05] p-3.5 text-left text-xs space-y-1.5">
                  <div className="flex items-center justify-between font-semibold">
                    <span className="truncate text-foreground text-sm">
                      {categoryPendingDelete.name}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${
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
          </div>

          <DrawerFooter className="border-t border-border/70 px-5 py-3 flex flex-row items-center gap-2">
            <button
              type="button"
              onClick={() => setCategoryPendingDelete(null)}
              className="nav-touch-item flex-1 h-10 rounded-full border border-border bg-black/[0.04] dark:bg-white/[0.06] px-4 font-mono text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground active:scale-98 transition-all focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={deleteCategoryMutation.isPending}
              onClick={() => void handleConfirmDelete()}
              className="nav-touch-item flex-1 h-10 inline-flex items-center justify-center gap-1.5 rounded-full bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-700 active:scale-98 transition-all focus-visible:outline-2 focus-visible:outline-rose-600 disabled:opacity-50"
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
    </motion.div>
  );
};
