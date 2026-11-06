import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScanLine, X } from "lucide-react";
import {
  tauriApi,
  type BookKind,
  type BookMetadata,
} from "../../lib/tauri-api";
import { bookQueryKeys } from "../../hooks/useBookFinance";
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
import { BarcodeScannerModal } from "./BarcodeScannerModal";
import { pushToast } from "../../lib/toast";
import { formatDateTime, formatRelativeTime } from "../../lib/date";

export const BookSwitcherPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isCreateBookDrawerOpen, setIsCreateBookDrawerOpen] =
    React.useState(false);
  const [newBookName, setNewBookName] = React.useState("");

  const [invitePayload, setInvitePayload] = React.useState("");
  const [isJoinModalOpen, setIsJoinModalOpen] = React.useState(false);
  const [isScanModalOpen, setIsScanModalOpen] = React.useState(false);

  const [renamingBook, setRenamingBook] = React.useState<BookMetadata | null>(
    null
  );
  const [renameDraft, setRenameDraft] = React.useState("");
  const [confirmDeleteBookId, setConfirmDeleteBookId] = React.useState<
    string | null
  >(null);

  const booksQuery = useQuery({
    queryKey: bookQueryKeys.allBooks,
    queryFn: () => tauriApi.listBooks(),
  });

  const createBookMutation = useMutation({
    mutationFn: ({ name, kind }: { name: string; kind: BookKind }) =>
      tauriApi.createBook(name, kind),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: bookQueryKeys.allBooks });
      setNewBookName("");
      pushToast(`Buku "${created.name}" berhasil dibuat`, {
        variant: "success",
      });
    },
  });

  const renameBookMutation = useMutation({
    mutationFn: ({ bookId, newName }: { bookId: string; newName: string }) =>
      tauriApi.renameBook(bookId, newName),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: bookQueryKeys.allBooks });
      setRenamingBook(null);
      setRenameDraft("");
      pushToast(`Nama buku diubah menjadi "${updated.name}"`, {
        variant: "success",
      });
    },
  });

  const deleteBookMutation = useMutation({
    mutationFn: (bookId: string) => tauriApi.deleteBook(bookId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bookQueryKeys.allBooks });
      setConfirmDeleteBookId(null);
      pushToast("Buku berhasil dihapus dari perangkat ini", {
        variant: "info",
      });
    },
  });

  const joinBookMutation = useMutation({
    mutationFn: ({ qr, kind }: { qr: string; kind: BookKind }) =>
      tauriApi.joinBookFromInvite(qr, kind),
    onSuccess: (joinedBook) => {
      void queryClient.invalidateQueries({ queryKey: bookQueryKeys.allBooks });
      setInvitePayload("");
      setIsJoinModalOpen(false);
      pushToast(`Berhasil bergabung ke buku "${joinedBook.name}"`, {
        variant: "success",
      });
      void navigate({
        to: "/books/$bookId/dashboard",
        params: { bookId: joinedBook.id },
      });
    },
  });

  const handleSlideConfirmCreateBook = async (): Promise<SlideConfirmResult> => {
    const trimmed = newBookName.trim();
    if (!trimmed) {
      pushToast("Nama buku tidak boleh kosong", { variant: "warning" });
      return { ok: false, message: "Nama buku tidak boleh kosong" };
    }
    try {
      await createBookMutation.mutateAsync({
        name: trimmed,
        kind: "PERSONAL",
      });
      return { ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal membuat buku";
      pushToast("Gagal membuat buku", { description: msg, variant: "error" });
      return { ok: false, message: "Gagal Membuat Buku" };
    }
  };

  const handleStartRename = (book: BookMetadata) => {
    setRenamingBook(book);
    setRenameDraft(book.name);
  };

  const handleSlideConfirmRename = async (): Promise<SlideConfirmResult> => {
    if (!renamingBook) {
      return { ok: false, message: "Buku tidak ditemukan" };
    }
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      pushToast("Nama buku tidak boleh kosong", { variant: "warning" });
      return { ok: false, message: "Nama buku tidak boleh kosong" };
    }
    try {
      await renameBookMutation.mutateAsync({
        bookId: renamingBook.id,
        newName: trimmed,
      });
      return { ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal mengubah nama";
      pushToast("Gagal mengubah nama buku", {
        description: msg,
        variant: "error",
      });
      return { ok: false, message: "Gagal Mengubah Nama" };
    }
  };

  const handleDeleteBook = async (bookId: string) => {
    try {
      await deleteBookMutation.mutateAsync(bookId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal menghapus buku";
      pushToast("Gagal menghapus buku", { description: msg, variant: "error" });
    }
  };

  const handleSlideConfirmJoinBook = async (): Promise<SlideConfirmResult> => {
    const trimmed = invitePayload.trim();
    if (!trimmed) {
      pushToast("Kode undangan tidak boleh kosong", {
        variant: "warning",
      });
      return { ok: false, message: "Kode undangan tidak boleh kosong" };
    }
    try {
      await joinBookMutation.mutateAsync({ qr: trimmed, kind: "PERSONAL" });
      return { ok: true };
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Kode undangan tidak sesuai atau masa berlakunya sudah habis";
      pushToast("Belum berhasil bergabung ke buku", {
        description: msg,
        variant: "error",
      });
      return { ok: false, message: "Gagal Bergabung ke Buku" };
    }
  };

  const books = booksQuery.data ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="page-transition-wrapper animate-page-in w-full p-0">
        {/* Books List */}
        <div className="tabular-grid-container grid grid-cols-1">
          <div className="tabular-grid-cell flex items-center justify-between px-3 py-2.5">
            <div>
              <h2 className="text-xs font-semibold text-foreground sm:text-sm">
                Daftar Buku Keuangan ({books.length})
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Pilih buku untuk mulai mencatat keuangan
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsCreateBookDrawerOpen(true)}
                className="nav-touch-item rounded border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                + Buat Buku
              </button>
              <button
                type="button"
                onClick={() => setIsScanModalOpen(true)}
                title="Scan Barcode / QR untuk Gabung Buku"
                className="nav-touch-item inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                <ScanLine className="h-3.5 w-3.5 text-primary" />
                <span className="hidden sm:inline">Scan QR</span>
              </button>
            </div>
          </div>

          {books.length === 0 ? (
            <div className="tabular-grid-cell p-8 text-center">
              <p className="text-xs font-medium text-foreground">
                Belum ada buku keuangan
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Silakan buat buku baru atau gabung ke buku bersama pasangan /
                keluarga.
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateBookDrawerOpen(true)}
                  className="nav-touch-item rounded border border-border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                >
                  + Buat Buku Baru
                </button>
                <button
                  type="button"
                  onClick={() => setIsScanModalOpen(true)}
                  className="nav-touch-item inline-flex items-center gap-1.5 rounded border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                >
                  <ScanLine className="h-3.5 w-3.5 text-primary" />
                  <span>Scan QR untuk Gabung</span>
                </button>
              </div>
            </div>
          ) : (
            books.map((book, idx) => {
              const isConfirmingDelete = confirmDeleteBookId === book.id;

              return (
                <div
                  key={book.id}
                  data-testid={`book-item-${book.id}`}
                  style={{ animationDelay: `${idx * 35}ms` }}
                  className="tabular-grid-cell animate-card-up flex items-center justify-between gap-3 px-3 py-3"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-foreground sm:text-sm">
                        {book.name}
                      </span>
                    </div>

                    <p
                      className="truncate text-[11px] text-muted-foreground"
                      title={`Terakhir dibuka: ${formatDateTime(book.last_opened_at)}`}
                    >
                      Terakhir dibuka: {formatRelativeTime(book.last_opened_at)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Link
                      to="/books/$bookId/dashboard"
                      params={{ bookId: book.id }}
                      className="nav-touch-item whitespace-nowrap rounded border border-border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                    >
                      Buka →
                    </Link>

                    <button
                      type="button"
                      onClick={() => handleStartRename(book)}
                      className="nav-touch-item rounded border border-border bg-background px-2 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                    >
                      Ubah Nama
                    </button>

                    {isConfirmingDelete ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleDeleteBook(book.id)}
                          disabled={deleteBookMutation.isPending}
                          className="nav-touch-item rounded border border-rose-500 bg-rose-500 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-rose-600 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                        >
                          Yakin Hapus
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteBookId(null)}
                          className="nav-touch-item rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                        >
                          Batal
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteBookId(book.id)}
                        className="nav-touch-item rounded border border-border bg-background px-2 py-1.5 text-[11px] font-medium text-rose-500 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                      >
                        Hapus
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>

      {/* Create New Book Drawer with ButtonSlideToConfirm */}
      <Drawer
        open={isCreateBookDrawerOpen}
        onOpenChange={setIsCreateBookDrawerOpen}
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
                  id="create-book-drawer-title"
                  className="text-sm font-semibold text-foreground"
                >
                  Buat Buku Keuangan Baru
                </DrawerTitle>
                <DrawerDescription className="mt-0.5 text-xs text-muted-foreground">
                  Pisahkan catatan uang harian, tabungan keluarga, atau usaha
                  Anda.
                </DrawerDescription>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateBookDrawerOpen(false)}
                aria-label="Tutup"
                className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="new-book-name"
                  className="block text-xs font-medium text-foreground"
                >
                  Nama Buku Keuangan
                </label>
                <Input
                  id="new-book-name"
                  value={newBookName}
                  onChange={(e) => setNewBookName(e.target.value)}
                  placeholder="Contoh: Uang Rumah Tangga, Tabungan, Usaha..."
                  autoFocus
                />
              </div>
            </div>

            {/* Footer with ButtonSlideToConfirm */}
            <div className="flex items-center justify-end gap-2 border-t border-border p-2.5 sm:px-6 bg-card/60 backdrop-blur-xs shrink-0">
              <ButtonSlideToConfirm
                key={isCreateBookDrawerOpen ? "book-open" : "book-closed"}
                disabled={createBookMutation.isPending}
                label="Geser untuk Buat Buku"
                readyLabel="Lepas untuk Buat Buku"
                loadingLabel="Menyiapkan Buku..."
                successLabel="Buku Berhasil Dibuat!"
                onConfirm={handleSlideConfirmCreateBook}
                onSuccessComplete={() => {
                  setIsCreateBookDrawerOpen(false);
                }}
              />
            </div>
          </form>
        </DrawerContent>
      </Drawer>

      {/* Rename Book Drawer with ButtonSlideToConfirm */}
      <Drawer
        open={Boolean(renamingBook)}
        onOpenChange={(open) => {
          if (!open) {
            setRenamingBook(null);
            setRenameDraft("");
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
                  id="rename-book-drawer-title"
                  className="text-sm font-semibold text-foreground"
                >
                  Ubah Nama Buku Keuangan
                </DrawerTitle>
                <DrawerDescription className="mt-0.5 text-xs text-muted-foreground">
                  Perbarui nama buku catatan keuangan Anda.
                </DrawerDescription>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRenamingBook(null);
                  setRenameDraft("");
                }}
                aria-label="Tutup"
                className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="rename-book-name"
                  className="block text-xs font-medium text-foreground"
                >
                  Nama Buku Keuangan Baru
                </label>
                <Input
                  id="rename-book-name"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  placeholder="Contoh: Uang Rumah Tangga, Tabungan, Usaha..."
                  autoFocus
                />
              </div>
            </div>

            {/* Footer with ButtonSlideToConfirm */}
            <div className="flex items-center justify-end gap-2 border-t border-border p-2.5 sm:px-6 bg-card/60 backdrop-blur-xs shrink-0">
              <ButtonSlideToConfirm
                key={renamingBook ? `rename-${renamingBook.id}` : "rename-closed"}
                disabled={renameBookMutation.isPending}
                label="Geser untuk Ubah Nama"
                readyLabel="Lepas untuk Ubah Nama"
                loadingLabel="Menyimpan..."
                successLabel="Nama Berhasil Diubah!"
                onConfirm={handleSlideConfirmRename}
                onSuccessComplete={() => {
                  setRenamingBook(null);
                  setRenameDraft("");
                }}
              />
            </div>
          </form>
        </DrawerContent>
      </Drawer>

      {/* Join Shared Book Drawer with ButtonSlideToConfirm */}
      <Drawer
        open={isJoinModalOpen}
        onOpenChange={setIsJoinModalOpen}
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
                  id="join-book-dialog-title"
                  className="text-sm font-semibold text-foreground"
                >
                  Gabung ke Buku Keuangan Bersama
                </DrawerTitle>
                <DrawerDescription className="mt-0.5 text-xs text-muted-foreground">
                  Masukkan kode undangan dari perangkat pasangan, keluarga, atau
                  rekan Anda.
                </DrawerDescription>
              </div>
              <button
                type="button"
                onClick={() => setIsJoinModalOpen(false)}
                aria-label="Tutup"
                className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="invite-qr-payload"
                  className="block text-xs font-medium text-foreground"
                >
                  Link atau Kode Undangan Buku
                </label>
                <textarea
                  id="invite-qr-payload"
                  rows={3}
                  value={invitePayload}
                  onChange={(e) => setInvitePayload(e.target.value)}
                  placeholder="Tempel link undangan (https://.../#/invite?d=...) atau kode undangan..."
                  className="w-full rounded border border-input bg-background p-2.5 font-mono text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                />
              </div>
            </div>

            {/* Footer with ButtonSlideToConfirm */}
            <div className="flex items-center justify-end gap-2 border-t border-border p-2.5 sm:px-6 bg-card/60 backdrop-blur-xs shrink-0">
              <ButtonSlideToConfirm
                key={isJoinModalOpen ? "join-open" : "join-closed"}
                disabled={joinBookMutation.isPending}
                label="Geser untuk Gabung Buku"
                readyLabel="Lepas untuk Gabung"
                loadingLabel="Menghubungkan..."
                successLabel="Berhasil Bergabung!"
                onConfirm={handleSlideConfirmJoinBook}
                onSuccessComplete={() => setIsJoinModalOpen(false)}
              />
            </div>
          </form>
        </DrawerContent>
      </Drawer>
      {/* Barcode & QR Scanner Modal */}
      <BarcodeScannerModal
        open={isScanModalOpen}
        onOpenChange={setIsScanModalOpen}
        onJoinBook={async (payload) => {
          await joinBookMutation.mutateAsync({ qr: payload, kind: "PERSONAL" });
        }}
        isJoining={joinBookMutation.isPending}
      />
    </div>
  );
};
