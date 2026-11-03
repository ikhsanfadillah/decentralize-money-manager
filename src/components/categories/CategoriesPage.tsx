import * as React from "react";
import { Link } from "@tanstack/react-router";
import { TrendingDown, TrendingUp, X } from "lucide-react";
import { useBookFinance } from "../../hooks/useBookFinance";
import type { CategoryKind, CategoryView } from "../../lib/tauri-api";
import { EmptyStateIllustration } from "../ui/EmptyStateIllustration";
import { Input } from "../ui/input";
import {
  ButtonSlideToConfirm,
  type SlideConfirmResult,
} from "../ui/ButtonSlideToConfirm";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "../ui/drawer";
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

  const handleSlideConfirm = async (): Promise<SlideConfirmResult> => {
    const trimmed = name.trim();
    if (!trimmed) {
      pushToast("Nama kategori tidak boleh kosong", { variant: "warning" });
      return { ok: false, message: "Nama kategori tidak boleh kosong" };
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
      return { ok: true };
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menyimpan kategori";
      pushToast("Gagal menyimpan kategori", {
        description: msg,
        variant: "error",
      });
      return { ok: false, message: "Gagal Menyimpan Kategori" };
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
    <div className="w-full">
      {/* Header & Filter Strip */}
      <div className="tabular-grid-container grid grid-cols-1 md:grid-cols-12">
        <div className="tabular-grid-cell flex flex-col justify-center px-3 py-2.5 md:col-span-7">
          <div className="flex items-center gap-2">
            <Link
              to="/books/$bookId/settings"
              params={{ bookId }}
              className="nav-touch-item inline-flex h-6 shrink-0 items-center rounded border border-border bg-background px-2 font-mono text-[10px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              ← Pengaturan
            </Link>
            <h1 className="text-xs font-semibold tracking-tight text-foreground sm:text-sm">
              Manajemen Kategori Transaksi
            </h1>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Kategori dengan nama dan jenis yang sama akan otomatis diselaraskan
            saat sinkronisasi antar-perangkat.
          </p>
        </div>

        <div className="tabular-grid-cell flex flex-wrap items-center justify-end gap-1.5 px-3 py-2 md:col-span-5">
          <div className="flex items-center gap-1">
            {(["ALL", "EXPENSE", "INCOME"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilterKind(tab)}
                className={`nav-touch-item inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-[11px] font-medium focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                  filterKind === tab
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {tab === "EXPENSE" && (
                  <TrendingDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                )}
                {tab === "INCOME" && (
                  <TrendingUp className="h-3 w-3 shrink-0" aria-hidden="true" />
                )}
                <span>
                  {tab === "ALL"
                    ? "SEMUA"
                    : tab === "EXPENSE"
                      ? "PENGELUARAN"
                      : "PEMASUKAN"}
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              handleResetForm();
              setIsDrawerOpen(true);
            }}
            className="nav-touch-item rounded border border-border bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            + Kategori Baru
          </button>
        </div>
      </div>

      {/* Categories Table */}
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell hidden grid-cols-12 items-center px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
          <div className="col-span-5">Nama Kategori</div>
          <div className="col-span-2">Jenis</div>
          <div className="col-span-3">Status Sinkronisasi</div>
          <div className="col-span-2 text-right">Aksi</div>
        </div>

        {filteredCategories.length === 0 ? (
          <div className="tabular-grid-cell flex flex-col items-center justify-center p-6 text-center text-xs text-muted-foreground">
            <EmptyStateIllustration variant="category-filter" />
            <p>Tidak ada kategori yang sesuai dengan filter.</p>
            <button
              type="button"
              onClick={() => {
                handleResetForm();
                setIsDrawerOpen(true);
              }}
              className="mt-2.5 nav-touch-item inline-flex items-center rounded border border-border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              + Tambah Kategori Baru
            </button>
          </div>
        ) : (
          filteredCategories.map((cat, idx) => {
            const isSys = isSystemCategory(cat.normalized_name);
            return (
              <div
                key={cat.id}
                data-testid={`category-row-${cat.id}`}
                style={{ animationDelay: `${idx * 30}ms` }}
                className="tabular-grid-cell animate-card-up grid grid-cols-1 items-center gap-1.5 px-3 py-2.5 text-xs md:grid-cols-12"
              >
                <div className="md:col-span-5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-foreground">
                      {cat.name}
                    </span>
                    {isSys && (
                      <span className="rounded border border-primary/40 px-1 py-0.2 font-mono text-[9px] text-primary">
                        Bawaan Sistem
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-1.5 md:col-span-5 md:grid md:grid-cols-5">
                  <div className="md:col-span-2">
                    <span
                      title={cat.kind === "EXPENSE" ? "Pengeluaran" : "Pemasukan"}
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                        cat.kind === "EXPENSE"
                          ? "border-rose-500/40 text-rose-500"
                          : "border-emerald-500/40 text-emerald-500"
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
                  </div>

                  <div className="md:col-span-3">
                    {cat.merged_into_id ? (
                      <span
                        data-testid={`category-auto-merged-${cat.id}`}
                        className="inline-flex items-center rounded border border-amber-500/40 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-500"
                      >
                        Tergabung otomatis
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        Kategori Utama
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-1.5 md:col-span-2">
                  <button
                    type="button"
                    onClick={() => handleStartEdit(cat)}
                    className="nav-touch-item rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(cat)}
                    className="nav-touch-item rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-rose-500 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Category Drawer with ButtonSlideToConfirm */}
      <Drawer
        open={isDrawerOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleCloseDrawer();
          }
        }}
        shouldScaleBackground={false}
      >
        <DrawerContent className="fixed inset-x-0 bottom-0 z-50 flex h-[100dvh] max-h-[100dvh] w-full flex-col rounded-none border-t border-border bg-card p-0 shadow-2xl focus:outline-none sm:mx-auto sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:rounded-t-2xl">
          <form
            onSubmit={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
              }
            }}
            className="flex h-full sm:h-auto flex-1 flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6 shrink-0 bg-card">
              <div>
                <DrawerTitle
                  id="category-dialog-title"
                  className="text-sm font-semibold text-foreground"
                >
                  {editingCategory
                    ? "Edit Kategori Transaksi"
                    : "Tambah Kategori Baru"}
                </DrawerTitle>
                <DrawerDescription className="mt-0.5 text-xs text-muted-foreground">
                  Kategori membantu mengelompokkan pos pengeluaran dan pemasukan
                  transaksi.
                </DrawerDescription>
              </div>
              <button
                type="button"
                onClick={handleCloseDrawer}
                aria-label="Tutup"
                className="nav-touch-item inline-flex shrink-0 h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="category-name-input"
                  className="block text-xs font-medium text-foreground"
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
                <label
                  htmlFor="category-kind-select"
                  className="block text-xs font-medium text-foreground"
                >
                  Jenis Kategori
                </label>
                <select
                  id="category-kind-select"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as CategoryKind)}
                  className="flex h-9 w-full rounded border border-input bg-background px-3 py-1 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  <option value="EXPENSE">Pengeluaran</option>
                  <option value="INCOME">Pemasukan</option>
                </select>
              </div>
            </div>

            {/* Footer with ButtonSlideToConfirm */}
            <div className="flex items-center justify-end gap-2 border-t border-border p-2.5 sm:px-6 bg-card/60 backdrop-blur-xs shrink-0">
              <ButtonSlideToConfirm
                key={
                  isDrawerOpen
                    ? `cat-${editingCategory?.id ?? "new"}`
                    : "closed"
                }
                disabled={upsertCategoryMutation.isPending}
                label={
                  editingCategory
                    ? "Geser untuk Simpan Perubahan"
                    : "Geser untuk Simpan Kategori"
                }
                readyLabel="Lepas untuk Simpan"
                loadingLabel="Menyimpan Kategori..."
                successLabel={
                  editingCategory
                    ? "Kategori Diperbarui!"
                    : "Kategori Disimpan!"
                }
                onConfirm={handleSlideConfirm}
                onSuccessComplete={handleCloseDrawer}
              />
            </div>
          </form>
        </DrawerContent>
      </Drawer>
    </div>
  );
};
