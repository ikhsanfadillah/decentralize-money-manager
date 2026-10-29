import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  tauriApi,
  type BookKind,
  type BookMetadata,
} from "../../lib/tauri-api";
import { bookQueryKeys } from "../../hooks/useBookFinance";
import { Input } from "../ui/input";
import { pushToast } from "../../lib/toast";
import {
  applyTheme,
  formatBookKindLabel,
  getStoredTheme,
  type ThemeMode,
} from "../../lib/utils";

const BOOK_KINDS: { value: BookKind; label: string }[] = [
  { value: "PERSONAL", label: "Pribadi / Keluarga" },
  { value: "BUSINESS", label: "Usaha / Bisnis" },
  { value: "OFFICE", label: "Kantor / Kegiatan" },
  { value: "OTHER", label: "Lainnya" },
];

export const BookSwitcherPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [theme, setTheme] = React.useState<ThemeMode>(() => getStoredTheme());
  const [newBookName, setNewBookName] = React.useState("");
  const [newBookKind, setNewBookKind] = React.useState<BookKind>("PERSONAL");

  const [invitePayload, setInvitePayload] = React.useState("");
  const [inviteKind, setInviteKind] = React.useState<BookKind>("PERSONAL");
  const [isJoinModalOpen, setIsJoinModalOpen] = React.useState(false);

  const [renamingBookId, setRenamingBookId] = React.useState<string | null>(
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
      setRenamingBookId(null);
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

  const handleToggleTheme = () => {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  const handleCreateBook = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newBookName.trim();
    if (!trimmed) {
      pushToast("Nama buku tidak boleh kosong", { variant: "warning" });
      return;
    }
    try {
      await createBookMutation.mutateAsync({
        name: trimmed,
        kind: newBookKind,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal membuat buku";
      pushToast("Gagal membuat buku", { description: msg, variant: "error" });
    }
  };

  const handleStartRename = (book: BookMetadata) => {
    setRenamingBookId(book.id);
    setRenameDraft(book.name);
  };

  const handleSaveRename = async (bookId: string) => {
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      pushToast("Nama buku baru tidak boleh kosong", { variant: "warning" });
      return;
    }
    try {
      await renameBookMutation.mutateAsync({ bookId, newName: trimmed });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal mengubah nama";
      pushToast("Gagal mengubah nama buku", {
        description: msg,
        variant: "error",
      });
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

  const handleJoinBook = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = invitePayload.trim();
    if (!trimmed) {
      pushToast("Kode undangan tidak boleh kosong", {
        variant: "warning",
      });
      return;
    }
    try {
      await joinBookMutation.mutateAsync({ qr: trimmed, kind: inviteKind });
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Kode undangan tidak sesuai atau masa berlakunya sudah habis";
      pushToast("Belum berhasil bergabung ke buku", {
        description: msg,
        variant: "error",
      });
    }
  };

  const books = booksQuery.data ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Compact Top Bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-primary" />
            <h1 className="text-sm font-semibold tracking-tight text-foreground">
              Buku Keuangan Saya
            </h1>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsJoinModalOpen(true)}
              className="nav-touch-item rounded border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Gabung Buku Bersama
            </button>
            <button
              type="button"
              onClick={handleToggleTheme}
              className="nav-touch-item rounded border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              {theme === "dark" ? "Mode Gelap" : "Mode Terang"}
            </button>
          </div>
        </div>
      </header>

      <main className="page-transition-wrapper animate-page-in w-full p-0">
        {/* Create New Book Form */}
        <form
          onSubmit={(e) => void handleCreateBook(e)}
          className="tabular-grid-container grid grid-cols-1 md:grid-cols-12"
        >
          <div className="tabular-grid-cell flex flex-col justify-center px-3 py-2.5 md:col-span-4">
            <h2 className="text-xs font-semibold text-foreground sm:text-sm">
              Buat Buku Keuangan Baru
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Pisahkan catatan uang harian, tabungan keluarga, atau usaha Anda.
            </p>
          </div>

          <div className="tabular-grid-cell flex items-center px-3 py-2.5 md:col-span-4">
            <div className="w-full">
              <label
                htmlFor="new-book-name"
                className="mb-1 block text-[10px] font-medium text-muted-foreground"
              >
                Nama Buku
              </label>
              <Input
                id="new-book-name"
                value={newBookName}
                onChange={(e) => setNewBookName(e.target.value)}
                placeholder="Contoh: Uang Rumah Tangga, Tabungan, Usaha..."
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="tabular-grid-cell flex items-center px-3 py-2.5 md:col-span-2">
            <div className="w-full">
              <label
                htmlFor="new-book-kind"
                className="mb-1 block text-[10px] font-medium text-muted-foreground"
              >
                Kategori Buku
              </label>
              <select
                id="new-book-kind"
                value={newBookKind}
                onChange={(e) => setNewBookKind(e.target.value as BookKind)}
                className="flex h-8 w-full rounded border border-input bg-background px-2 py-1 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                {BOOK_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="tabular-grid-cell flex items-end justify-end px-3 py-2.5 md:col-span-2">
            <button
              type="submit"
              disabled={createBookMutation.isPending}
              className="nav-touch-item h-8 w-full rounded border border-border bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
            >
              {createBookMutation.isPending ? "Menyiapkan..." : "+ Buat Buku"}
            </button>
          </div>
        </form>

        {/* Books List */}
        <div className="tabular-grid-container grid grid-cols-1">
          <div className="tabular-grid-cell flex items-center justify-between px-3 py-2">
            <h2 className="text-xs font-semibold text-foreground sm:text-sm">
              Daftar Buku Keuangan ({books.length})
            </h2>
            <span className="text-[11px] text-muted-foreground">
              Pilih buku untuk mulai mencatat
            </span>
          </div>

          {books.length === 0 ? (
            <div className="tabular-grid-cell p-6 text-center">
              <p className="text-xs font-medium text-foreground">
                Belum ada buku keuangan
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Silakan buat buku baru di atas atau gabung ke buku bersama pasangan/keluarga.
              </p>
            </div>
          ) : (
            books.map((book, idx) => {
              const isRenaming = renamingBookId === book.id;
              const isConfirmingDelete = confirmDeleteBookId === book.id;

              return (
                <div
                  key={book.id}
                  data-testid={`book-item-${book.id}`}
                  style={{ animationDelay: `${idx * 35}ms` }}
                  className="tabular-grid-cell animate-card-up flex items-center justify-between gap-3 px-3 py-3"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    {isRenaming ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          aria-label="Nama Buku Baru"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          className="h-7 max-w-xs text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSaveRename(book.id)}
                          disabled={renameBookMutation.isPending}
                          className="rounded border border-border bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                        >
                          Simpan
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingBookId(null)}
                          className="rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                        >
                          Batal
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-foreground sm:text-sm">
                          {book.name}
                        </span>
                        <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.2 text-[10px] font-medium text-primary">
                          {formatBookKindLabel(book.kind)}
                        </span>
                      </div>
                    )}

                    <p className="truncate text-[11px] text-muted-foreground">
                      Terakhir dibuka: {book.last_opened_at}
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

                    {!isRenaming && (
                      <button
                        type="button"
                        onClick={() => handleStartRename(book)}
                        className="nav-touch-item whitespace-nowrap rounded border border-border bg-background px-2 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                      >
                        Ubah Nama
                      </button>
                    )}

                    {isConfirmingDelete ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleDeleteBook(book.id)}
                          disabled={deleteBookMutation.isPending}
                          className="rounded border border-rose-500/50 bg-rose-500 px-2 py-1.5 text-[11px] font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                        >
                          Ya, Hapus
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteBookId(null)}
                          className="rounded border border-border bg-background px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
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

      {/* Join Shared Book Modal */}
      {isJoinModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="join-book-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="w-full max-w-lg rounded border border-border bg-card p-4 text-card-foreground">
            <div className="flex items-center justify-between border-b border-border pb-2.5">
              <div>
                <h2
                  id="join-book-dialog-title"
                  className="text-sm font-semibold text-foreground"
                >
                  Gabung ke Buku Keuangan Bersama
                </h2>
                <p className="text-xs text-muted-foreground">
                  Masukkan kode undangan dari perangkat pasangan, keluarga, atau rekan Anda.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsJoinModalOpen(false)}
                className="rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Tutup
              </button>
            </div>

            <form
              onSubmit={(e) => void handleJoinBook(e)}
              className="mt-3 space-y-3"
            >
              <div>
                <label
                  htmlFor="invite-qr-payload"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  Kode Undangan Buku
                </label>
                <textarea
                  id="invite-qr-payload"
                  rows={4}
                  value={invitePayload}
                  onChange={(e) => setInvitePayload(e.target.value)}
                  placeholder="Tempel kode undangan yang disalin dari menu Bagikan Buku..."
                  className="w-full rounded border border-input bg-background p-2.5 font-mono text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                />
              </div>

              <div>
                <label
                  htmlFor="invite-book-kind"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  Simpan Sebagai Kategori
                </label>
                <select
                  id="invite-book-kind"
                  value={inviteKind}
                  onChange={(e) => setInviteKind(e.target.value as BookKind)}
                  className="flex h-9 w-full rounded border border-input bg-background px-3 py-1 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  {BOOK_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => setIsJoinModalOpen(false)}
                  className="rounded border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={joinBookMutation.isPending}
                  className="rounded border border-border bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
                >
                  {joinBookMutation.isPending
                    ? "Menghubungkan..."
                    : "Gabung Sekarang"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
