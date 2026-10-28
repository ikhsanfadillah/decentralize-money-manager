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
import { applyTheme, getStoredTheme, type ThemeMode } from "../../lib/utils";

const BOOK_KINDS: { value: BookKind; label: string }[] = [
  { value: "PERSONAL", label: "Pribadi (Personal)" },
  { value: "BUSINESS", label: "Usaha / Bisnis" },
  { value: "OFFICE", label: "Kantor / Operasional" },
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
      pushToast("Payload undangan QR tidak boleh kosong", {
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
          : "Payload undangan tidak valid atau kedaluwarsa";
      pushToast("Gagal bergabung ke buku P2P", {
        description: msg,
        variant: "error",
      });
    }
  };

  const books = booksQuery.data ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top Bar */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
              <h1 className="text-base font-semibold tracking-tight text-foreground">
                Decentralize Money Manager
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsJoinModalOpen(true)}
              className="rounded border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Gabung Buku P2P (QR / Kode)
            </button>
            <button
              type="button"
              onClick={handleToggleTheme}
              className="rounded border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              {theme === "dark" ? "TEMA: GELAP" : "TEMA: TERANG"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        {/* Create New Book Form */}
        <form
          onSubmit={(e) => void handleCreateBook(e)}
          className="tabular-grid-container grid grid-cols-1 md:grid-cols-12"
        >
          <div className="tabular-grid-cell flex flex-col justify-center p-4 md:col-span-4">
            <h2 className="text-sm font-semibold text-foreground">
              Buat Buku Keuangan Baru
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Data awal kategori standar akan diinisialisasi otomatis.
            </p>
          </div>

          <div className="tabular-grid-cell flex items-center p-4 md:col-span-4">
            <div className="w-full">
              <label
                htmlFor="new-book-name"
                className="mb-1 block text-[11px] font-medium text-muted-foreground"
              >
                Nama Buku
              </label>
              <Input
                id="new-book-name"
                value={newBookName}
                onChange={(e) => setNewBookName(e.target.value)}
                placeholder="Contoh: Dompet Keluarga, Toko Kopi..."
              />
            </div>
          </div>

          <div className="tabular-grid-cell flex items-center p-4 md:col-span-2">
            <div className="w-full">
              <label
                htmlFor="new-book-kind"
                className="mb-1 block text-[11px] font-medium text-muted-foreground"
              >
                Jenis Buku
              </label>
              <select
                id="new-book-kind"
                value={newBookKind}
                onChange={(e) => setNewBookKind(e.target.value as BookKind)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                {BOOK_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="tabular-grid-cell flex items-end justify-end p-4 md:col-span-2">
            <button
              type="submit"
              disabled={createBookMutation.isPending}
              className="h-9 w-full rounded-md border border-border bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
            >
              {createBookMutation.isPending ? "Membuat..." : "+ Buat Buku"}
            </button>
          </div>
        </form>

        {/* Books Tabular Registry */}
        <div className="tabular-grid-container grid grid-cols-1">
          <div className="tabular-grid-cell flex flex-col md:flex-row md:items-center justify-between px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              Daftar Buku Lokal ({books.length})
            </h2>
            <span className="font-mono text-xs text-muted-foreground">
              REGISTRY: registry.sqlite
            </span>
          </div>

          {books.length === 0 ? (
            <div className="tabular-grid-cell p-8 text-center">
              <p className="text-sm font-medium text-foreground">
                Belum ada buku keuangan di perangkat ini
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Buat buku baru pada formulir di atas atau gabung dari perangkat
                lain menggunakan undangan QR P2P.
              </p>
            </div>
          ) : (
            books.map((book) => {
              const isRenaming = renamingBookId === book.id;
              const isConfirmingDelete = confirmDeleteBookId === book.id;

              return (
                <div
                  key={book.id}
                  data-testid={`book-item-${book.id}`}
                  className="tabular-grid-cell flex flex-col justify-between gap-3 p-4 md:flex-row md:items-center"
                >
                  <div className="space-y-1">
                    {isRenaming ? (
                      <div className="flex items-center gap-2">
                        <Input
                          aria-label="Nama Buku Baru"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          className="h-8 max-w-xs text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSaveRename(book.id)}
                          disabled={renameBookMutation.isPending}
                          className="rounded border border-border bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                        >
                          Simpan
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingBookId(null)}
                          className="rounded border border-border bg-background px-2.5 py-1 text-xs text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                        >
                          Batal
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {book.name}
                        </span>
                        <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                          {book.kind}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                            book.file_exists
                              ? "border-primary/40 text-primary"
                              : "border-rose-500/40 text-rose-500"
                          }`}
                        >
                          {book.file_exists
                            ? "FILE SQLITE TERSEDIA"
                            : "FILE SQLITE HILANG (AKAN DIREKREASI SAAT DIBUKA)"}
                        </span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground">
                      <span>ID: {book.id}</span>
                      <span>·</span>
                      <span>Terakhir dibuka: {book.last_opened_at}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      to="/books/$bookId/dashboard"
                      params={{ bookId: book.id }}
                      className="whitespace-nowrap rounded-md border border-border bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                    >
                      Buka Buku →
                    </Link>

                    {!isRenaming && (
                      <button
                        type="button"
                        onClick={() => handleStartRename(book)}
                        className="whitespace-nowrap rounded border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                      >
                        Ubah Nama
                      </button>
                    )}

                    {isConfirmingDelete ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleDeleteBook(book.id)}
                          disabled={deleteBookMutation.isPending}
                          className="rounded border border-rose-500/50 bg-rose-500 px-2.5 py-1.5 text-xs font-semibold text-white shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                        >
                          Konfirmasi Hapus
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteBookId(null)}
                          className="rounded border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                        >
                          Batal
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteBookId(book.id)}
                        className="rounded border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-rose-500 shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
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

      {/* Join P2P Book Modal */}
      {isJoinModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="join-book-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="w-full max-w-lg rounded-md border border-border bg-card p-5 text-card-foreground shadow-none">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h2
                  id="join-book-dialog-title"
                  className="text-base font-semibold text-foreground"
                >
                  Gabung Buku dari Undangan QR P2P
                </h2>
                <p className="text-xs text-muted-foreground">
                  Tempel payload JSON dari QR undangan perangkat sumber (v1)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsJoinModalOpen(false)}
                className="rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Tutup
              </button>
            </div>

            <form
              onSubmit={(e) => void handleJoinBook(e)}
              className="mt-4 space-y-4"
            >
              <div>
                <label
                  htmlFor="invite-qr-payload"
                  className="mb-1.5 block text-xs font-medium text-foreground"
                >
                  Payload Undangan QR (JSON)
                </label>
                <textarea
                  id="invite-qr-payload"
                  rows={5}
                  value={invitePayload}
                  onChange={(e) => setInvitePayload(e.target.value)}
                  placeholder='{"v":1,"book_id":"...","book_name":"...","secret_b64":"...","node_id":"...","expires_at":"..."}'
                  className="w-full rounded-md border border-input bg-background p-2.5 font-mono text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                />
              </div>

              <div>
                <label
                  htmlFor="invite-book-kind"
                  className="mb-1.5 block text-xs font-medium text-foreground"
                >
                  Klasifikasi Buku di Perangkat Ini
                </label>
                <select
                  id="invite-book-kind"
                  value={inviteKind}
                  onChange={(e) => setInviteKind(e.target.value as BookKind)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
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
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={joinBookMutation.isPending}
                  className="rounded-md border border-border bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
                >
                  {joinBookMutation.isPending
                    ? "Memverifikasi & Menyimpan Kunci..."
                    : "Gabung & Sinkronkan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
