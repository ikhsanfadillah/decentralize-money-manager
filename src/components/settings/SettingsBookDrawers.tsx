import {
  ArrowLeftRight,
  BookOpen,
  Check,
  ChevronRight,
  Laptop,
  Trash2,
  X,
} from "lucide-react";
import * as React from "react";
import { formatRelativeTime } from "../../lib/date";
import type { BookMetadata } from "../../lib/tauri-api";
import { formatBookKindLabel, formatRupiah } from "../../lib/utils";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { Input } from "../ui/input";
import { DeleteBookIllustration } from "./DeleteBookIllustration";

export interface SettingsBookDrawersProps {
  bookId: string;
  activeBook: BookMetadata | null;
  allBooks: BookMetadata[];
  activeAccountsCount: number;
  categoriesCount: number;
  totalBalance: number;
  deviceId: string | undefined;

  isEditModalOpen: boolean;
  setIsEditModalOpen: (open: boolean) => void;
  deviceNameInput: string;
  setDeviceNameInput: (val: string) => void;
  isSavingDeviceName: boolean;
  onSaveDeviceName: (e: React.FormEvent) => Promise<void>;

  isRenameBookDrawerOpen: boolean;
  setIsRenameBookDrawerOpen: (open: boolean) => void;
  bookNameDraft: string;
  setBookNameDraft: (val: string) => void;
  isRenamingBook: boolean;
  onSaveBookName: (e: React.FormEvent) => Promise<void>;

  isDeleteBookConfirmOpen: boolean;
  setIsDeleteBookConfirmOpen: (open: boolean) => void;
  isDeletingBook: boolean;
  onConfirmDeleteBook: () => Promise<void>;

  isSwitchBookDrawerOpen: boolean;
  setIsSwitchBookDrawerOpen: (open: boolean) => void;
  onSwitchBook: (targetBookId: string) => Promise<void>;
}

export const SettingsBookDrawers: React.FC<SettingsBookDrawersProps> = ({
  bookId,
  activeBook,
  allBooks,
  activeAccountsCount,
  categoriesCount,
  totalBalance,
  deviceId,
  isEditModalOpen,
  setIsEditModalOpen,
  deviceNameInput,
  setDeviceNameInput,
  isSavingDeviceName,
  onSaveDeviceName,
  isRenameBookDrawerOpen,
  setIsRenameBookDrawerOpen,
  bookNameDraft,
  setBookNameDraft,
  isRenamingBook,
  onSaveBookName,
  isDeleteBookConfirmOpen,
  setIsDeleteBookConfirmOpen,
  isDeletingBook,
  onConfirmDeleteBook,
  isSwitchBookDrawerOpen,
  setIsSwitchBookDrawerOpen,
  onSwitchBook,
}) => {
  return (
    <>
      {/* Modal Edit Device Name */}
      {isEditModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-device-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fade-in"
        >
          <div
            data-floating-surface="true"
            className="floating-surface w-full max-w-sm rounded-3xl border border-border p-5"
          >
            <div className="flex items-center justify-between border-b border-border/70 pb-3">
              <h3
                id="edit-device-modal-title"
                className="flex items-center gap-2 text-sm font-semibold text-foreground"
              >
                <Laptop className="h-4 w-4 text-primary" />
                <span>Ubah Nama Perangkat Ini</span>
              </h3>
              <button
                type="button"
                aria-label="Tutup"
                onClick={() => setIsEditModalOpen(false)}
                className="rounded-full border border-border p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={onSaveDeviceName} className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="input-device-name"
                  className="mb-1.5 block text-xs font-medium text-muted-foreground"
                >
                  Nama Label Perangkat
                </label>
                <input
                  id="input-device-name"
                  type="text"
                  value={deviceNameInput}
                  onChange={(e) => setDeviceNameInput(e.target.value)}
                  placeholder="Contoh: Laptop Kerja, HP Budi"
                  maxLength={64}
                  autoFocus
                  className="flex h-10 w-full rounded-xl border border-border bg-black/[0.04] px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary dark:bg-white/[0.06]"
                />
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  ID teknis ({deviceId}) tetap unik dan tidak berubah.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-3">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="rounded-full border border-border bg-black/[0.04] px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:bg-white/[0.06]"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSavingDeviceName}
                  className="rounded-full bg-cta-surface px-4 py-1.5 text-xs font-semibold text-cta-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {isSavingDeviceName ? "Menyimpan..." : "Simpan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Book Drawer (Vaul) */}
      <Drawer
        open={isRenameBookDrawerOpen}
        onOpenChange={setIsRenameBookDrawerOpen}
        shouldScaleBackground={false}
      >
        <DrawerContent className="p-0 data-[vaul-drawer-direction=bottom]:w-full data-[vaul-drawer-direction=bottom]:sm:mx-auto sm:max-w-md">
          <form
            onSubmit={(e) => void onSaveBookName(e)}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border/70 px-5 py-4">
              <div>
                <DrawerTitle
                  id="rename-book-drawer-title"
                  className="text-sm font-bold text-foreground"
                >
                  Ubah Nama Buku Keuangan
                </DrawerTitle>
                <DrawerDescription className="mt-0.5 text-xs text-muted-foreground">
                  Perbarui nama buku catatan keuangan Anda.
                </DrawerDescription>
              </div>
              <button
                type="button"
                onClick={() => setIsRenameBookDrawerOpen(false)}
                aria-label="Tutup"
                className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-auto min-h-0 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="rename-book-name-input"
                  className="block text-xs font-medium text-foreground"
                >
                  Nama Buku Keuangan Baru
                </label>
                <Input
                  id="rename-book-name-input"
                  value={bookNameDraft}
                  onChange={(e) => setBookNameDraft(e.target.value)}
                  placeholder="Contoh: Uang Rumah Tangga, Tabungan, Usaha..."
                  maxLength={80}
                  autoFocus
                />
              </div>
            </div>

            <DrawerFooter className="flex flex-row items-center gap-2 border-t border-border/70 px-5 py-3.5">
              <button
                type="button"
                disabled={isRenamingBook}
                onClick={() => setIsRenameBookDrawerOpen(false)}
                className="nav-touch-item h-10 flex-1 rounded-full border border-border bg-black/[0.04] px-4 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 dark:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isRenamingBook}
                className="nav-touch-item h-10 flex-1 rounded-full bg-cta-surface px-5 text-xs font-semibold text-cta-foreground transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                {isRenamingBook ? "Menyimpan..." : "Simpan Perubahan"}
              </button>
            </DrawerFooter>
          </form>
        </DrawerContent>
      </Drawer>

      {/* Dedicated Delete Book Confirmation Drawer */}
      <Drawer
        open={isDeleteBookConfirmOpen}
        onOpenChange={setIsDeleteBookConfirmOpen}
      >
        <DrawerContent
          aria-describedby="delete-book-confirm-desc"
          className="p-0 data-[vaul-drawer-direction=bottom]:sm:mx-auto sm:max-w-md"
        >
          <div className="flex flex-auto min-h-0 flex-col overflow-y-auto overscroll-contain px-5 pt-5 pb-3 text-center">
            <div className="my-auto flex w-full flex-col items-center">
              <DeleteBookIllustration className="my-1 h-24 w-24" />

              <DrawerHeader className="mt-2 space-y-1 border-0 p-0">
                <DrawerTitle className="text-center text-base font-bold text-foreground sm:text-lg">
                  Hapus Buku Ini?
                </DrawerTitle>
                <DrawerDescription
                  id="delete-book-confirm-desc"
                  className="mx-auto max-w-xs text-center text-xs text-muted-foreground"
                >
                  Buku ini beserta seluruh rekening, kategori, transaksi, dan
                  anggaran di dalamnya akan dihapus permanen dari perangkat ini.
                  Tindakan ini tidak dapat dibatalkan.
                </DrawerDescription>
              </DrawerHeader>

              {/* Book Preview Box */}
              <div className="mt-3 w-full space-y-1.5 rounded-2xl border border-border bg-black/[0.04] p-3.5 text-left text-xs dark:bg-white/[0.05]">
                <div className="flex items-center justify-between gap-2 font-semibold">
                  <span className="truncate text-sm text-foreground">
                    {activeBook?.name ?? "Buku Keuangan"}
                  </span>
                  {activeBook && (
                    <span className="shrink-0 rounded-full border border-border bg-black/[0.04] px-2 py-0.5 font-mono text-[10px] text-muted-foreground dark:bg-white/[0.06]">
                      {formatBookKindLabel(activeBook.kind)}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-border/50 pt-1.5 text-xs text-muted-foreground">
                  <span>
                    {activeAccountsCount} Akun · {categoriesCount} Kategori
                  </span>
                  <span className="font-mono font-bold tabular-nums text-foreground">
                    {formatRupiah(totalBalance)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <DrawerFooter className="flex flex-row items-center gap-2 border-t border-border/70 px-5 py-3.5">
            <button
              type="button"
              disabled={isDeletingBook}
              onClick={() => setIsDeleteBookConfirmOpen(false)}
              className="nav-touch-item h-10 flex-1 rounded-full border border-border bg-black/[0.04] px-4 font-mono text-xs font-semibold text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-98 disabled:opacity-50 dark:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Batal
            </button>
            <button
              type="button"
              data-testid="confirm-delete-book-button"
              disabled={isDeletingBook}
              onClick={() => void onConfirmDeleteBook()}
              className="nav-touch-item inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-rose-600 px-4 text-xs font-semibold text-white transition-all hover:bg-rose-700 active:scale-98 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-rose-600"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span>{isDeletingBook ? "Menghapus..." : "Hapus Buku"}</span>
            </button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Switch Book Drawer (Vaul) */}
      <Drawer
        open={isSwitchBookDrawerOpen}
        onOpenChange={setIsSwitchBookDrawerOpen}
        shouldScaleBackground={false}
      >
        <DrawerContent className="p-0 data-[vaul-drawer-direction=bottom]:max-h-[85dvh] data-[vaul-drawer-direction=bottom]:w-full data-[vaul-drawer-direction=bottom]:sm:mx-auto sm:max-w-md">
          <div className="flex shrink-0 items-center justify-between border-b border-border/70 px-5 py-4">
            <div>
              <DrawerTitle
                id="switch-book-drawer-title"
                className="text-sm font-bold text-foreground"
              >
                Ganti Buku Keuangan
              </DrawerTitle>
              <DrawerDescription className="mt-0.5 text-xs text-muted-foreground">
                Pilih buku lain di perangkat ini atau buka daftar semua buku.
              </DrawerDescription>
            </div>
            <button
              type="button"
              onClick={() => setIsSwitchBookDrawerOpen(false)}
              aria-label="Tutup"
              className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-auto min-h-0 space-y-2 overflow-y-auto overscroll-contain px-5 py-4">
            {allBooks.map((b) => {
              const isCurrent = b.id === bookId;
              return (
                <button
                  key={b.id}
                  type="button"
                  data-testid={`switch-book-item-${b.id}`}
                  onClick={() => void onSwitchBook(b.id)}
                  className={`nav-touch-item flex w-full items-center justify-between gap-3 rounded-2xl border p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                    isCurrent
                      ? "border-primary/40 bg-primary/10"
                      : "border-border bg-black/[0.03] hover:bg-black/[0.06] dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        isCurrent
                          ? "bg-cta-surface text-cta-foreground"
                          : "border border-border bg-black/[0.04] text-primary dark:bg-white/[0.06]"
                      }`}
                    >
                      <BookOpen className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-foreground sm:text-sm">
                          {b.name}
                        </span>
                        <span className="shrink-0 rounded-full border border-border bg-black/[0.04] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground dark:bg-white/[0.06]">
                          {formatBookKindLabel(b.kind)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        Dibuka {formatRelativeTime(b.last_opened_at)}
                      </p>
                    </div>
                  </div>

                  {isCurrent ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-cta-surface px-2.5 py-1 text-[10px] font-bold text-cta-foreground">
                      <Check className="h-3 w-3" aria-hidden="true" />
                      <span>Aktif</span>
                    </span>
                  ) : (
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>

          <DrawerFooter className="border-t border-border/70 px-5 py-3.5">
            <button
              type="button"
              data-testid="btn-view-all-books"
              onClick={() => void onSwitchBook("__HOME__")}
              className="nav-touch-item inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-border bg-black/[0.04] px-4 text-xs font-semibold text-foreground transition-colors hover:bg-muted dark:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              <ArrowLeftRight
                className="h-3.5 w-3.5 text-primary"
                aria-hidden="true"
              />
              <span>Lihat Semua Buku &amp; Buat Baru</span>
            </button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
};
