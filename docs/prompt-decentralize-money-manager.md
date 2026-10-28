# PROMPT: Decentralize Money Manager (v3)

Bertindaklah sebagai **Principal Systems Architect & Senior Frontend/Rust Engineer**. Bangun arsitektur dan kode implementasi produksi untuk aplikasi **"Decentralize Money Manager"**: aplikasi pencatat keuangan Local-First, Offline-First, dan Decentralized yang berjalan di Desktop (Windows/macOS/Linux) dan Mobile (Android/iOS) lewat **Tauri v2**.

---

## 0. CARA KERJA & FORMAT OUTPUT

Pekerjaan ini terlalu besar untuk satu respons. Kerjakan **per fase** (Bagian 11). Aturan:

1. Mulai respons pertama dengan ringkasan arsitektur (maks. 40 baris) dan daftar asumsi yang kamu pakai, lalu langsung kerjakan **Fase 1**. Berhenti di akhir tiap fase dan tunggu perintah "lanjut".
2. Setiap file ditulis **utuh dan siap jalan**: tanpa placeholder, tanpa `// TODO`, tanpa `...` pemotong. Jika sebuah file tidak muat, pecah menjadi modul lebih kecil, jangan dipotong.
3. Tulis path file sebagai judul sebelum setiap blok kode.
4. Di akhir tiap fase, tulis: (a) cara menjalankan/menguji, (b) bagian yang **tidak kamu yakini** (terutama API crate pihak ketiga seperti `iroh`), (c) risiko yang tersisa.
5. **Jangan mengarang API.** Jika tidak yakin tentang signature sebuah crate/library, nyatakan secara eksplisit dan isolasi di balik trait/abstraksi agar mudah diperbaiki.
6. Semua komentar kode, nama identifier, dan nama event memakai bahasa Inggris. Teks UI dan penjelasan memakai Bahasa Indonesia.

---

## 1. STACK & VERSI

- **Shell**: Tauri v2 (desktop + mobile), Rust edition 2021, `tokio`, `serde`, `thiserror`.
- **DB**: `rusqlite` (feature `bundled`), SQLite mode WAL.
- **Sync/Crypto**: `iroh` (QUIC, hole punching, relay fallback; **pin versi eksak**), `chacha20poly1305` (XChaCha20-Poly1305), `blake3`, `hmac`+`sha2`, `uuid` (feature `v7` dan `v5`), `postcard` untuk serialisasi wire.
- **Frontend**: React 19, TypeScript `strict: true`, Vite, TanStack Router (file-based), TanStack Query v5, TanStack Table v8, Zustand v5, Tailwind CSS v4, shadcn/ui, **`react-number-format` v5** (satu-satunya library untuk input nominal, lihat 8.4), Vitest + Testing Library (`@testing-library/user-event`).
- Package manager: pnpm.

---

## 2. KEPUTUSAN TERKUNCI vs ASUMSI

### Keputusan terkunci (jangan diubah)
- **Transport sync = iroh.** Satu endpoint iroh per perangkat (bukan per buku). Relay iroh hanya meneruskan paket QUIC terenkripsi untuk koneksi/fallback; relay **bukan** penyimpan pesan (tidak ada store-and-forward).
- **v1: sync hanya berjalan saat app terbuka (foreground).** Konsekuensi yang harus ditulis di dokumentasi: dua perangkat baru bisa sinkron jika **keduanya online dan terbuka pada waktu yang sama**. Tidak ada background sync di v1.
- **Satu file `.sqlite` fisik per buku**, tanpa Foreign Key antar-file.
- **Zero polling**: UI diperbarui lewat event Tauri.
- **LWW per-row** (sebelumnya A1): snapshot baris penuh membawa `updated_hlc`. Trade-off yang diterima: edit bersamaan pada kolom berbeda di baris yang sama berarti baris dengan HLC terbaru menang seluruhnya. Dokumentasikan perilaku ini di bagian keterbatasan.

### Asumsi default (kerjakan sesuai ini, tandai di ringkasan awal, mudah diubah)
- **A2. Enkripsi at-rest**: v1 mengandalkan sandbox OS; file ekspor dan seluruh data di jaringan dienkripsi. SQLCipher tidak dipakai di v1 (kompleksitas build Android/iOS).
- **A3. Pencabutan perangkat**: v1 tidak mendukung revoke per perangkat. Cara mengeluarkan perangkat = rotasi kunci buku (buat kunci baru, re-invite perangkat yang sah). Dokumentasikan sebagai keterbatasan.
- **A4. Registry buku**: daftar buku disimpan di `$APP_DATA/registry.sqlite` (tabel `books`: `id, name, kind, created_at, last_opened_at`) yang hanya berisi **metadata**, tidak ada data transaksi.
- **A5. Transfer antar-buku** tidak atomik lintas file. Gunakan `link_id` (UUIDv7) sebagai idempotency key: tulis `EXPENSE` di buku asal, lalu `INCOME` di buku tujuan; jika langkah kedua gagal, lakukan compensating soft-delete pada langkah pertama.
- **A6. Budget**: hanya periode `MONTHLY` (bulan kalender), tanpa rollover sisa antar-bulan. Pemasukan/refund tidak mengurangi pengeluaran terpakai. Budget total (`category_id = NULL`) **tidak** menghitung kategori sistem "Prive/Penarikan" (transfer antar-buku bukan konsumsi).
- **A7. Identitas budget deterministik**: `id = UUIDv5(namespace_app, "{category_id|ALL}:{period}")`, sehingga dua perangkat yang membuat budget yang sama bersamaan menghasilkan baris yang sama (diselesaikan LWW), bukan duplikat.

---

## 3. PRINSIP ARSITEKTUR

### 3.1 Isolasi multi-buku
- Setiap buku (Pribadi, Bisnis, Kantor, dst.) = file `$APP_DATA/books/{book_id}.sqlite`. Setiap buku punya **book key** simetris 32-byte sendiri dan **topic ID sync** sendiri (lihat 6.2). Dilarang mencampur data dua buku dalam satu file atau satu koneksi.
- `AppState` memegang pool dinamis: `Arc<RwLock<HashMap<String, Arc<Mutex<Connection>>>>>`.
  - Semua operasi DB berjalan di `tokio::task::spawn_blocking` agar tidak memblokir runtime.
  - Setiap command menerima `book_id`. Validasi `book_id` sebagai UUID (cegah path traversal) sebelum membuka file. Jika koneksi belum ada di pool, buka, jalankan migrasi bila perlu, lalu simpan di pool.
  - Sediakan `close_book(book_id)` yang melepas koneksi dan menghentikan sesi sync buku itu.

### 3.2 Aturan akuntansi lintas buku
- Dilarang membuat relasi/referensi yang dipaksa integritasnya antar-file buku.
- Transfer antar-buku = 2 transaksi terpisah: `EXPENSE` kategori "Prive/Penarikan" di buku asal dan `INCOME` kategori "Bagi Hasil/Injeksi Modal" di buku tujuan (lihat A5). Kategori sistem ini dibuat otomatis dengan ID deterministik per kategori bila belum ada.

### 3.3 Event-driven (zero polling)
- `crdt:synced` payload `{ book_id: string, tables: string[] }`: dipancarkan setelah satu batch OpLog remote berhasil di-commit (debounce 250 ms agar tidak membanjiri UI).
- `sync:status` payload `{ book_id, state: "idle" | "connecting" | "syncing" | "error", peers: number, last_synced_at: string | null }`: untuk pill status sync.
- Frontend `listen()` dari `@tauri-apps/api/event`, melakukan invalidate **selektif** (`['books', bookId, ...]`), dan **wajib** unlisten saat unmount.

---

## 4. SKEMA DATABASE (per buku)

Jalankan saat inisialisasi file baru, dengan versi skema di `PRAGMA user_version` dan migrasi berurutan yang idempoten.

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = OFF;   -- wajib OFF: op CRDT bisa tiba out-of-order
PRAGMA synchronous = NORMAL;
```

Integritas referensial dijaga di lapisan aplikasi. Baris yang merujuk akun/kategori yang belum tiba **harus ditoleransi** (UI menampilkan "Akun tidak diketahui" sampai datanya tiba).

**`meta`** (key-value lokal, tidak disinkronkan): `book_id`, `book_name`, `device_id` (acak 8 hex, dibuat sekali), `hlc_last` (state HLC terakhir).

**`accounts`**
- `id TEXT PRIMARY KEY` (UUIDv7; akun Cash default memakai UUID deterministik hardcoded)
- `name TEXT NOT NULL`, `account_type TEXT NOT NULL` (`BANK` | `CASH` | `EWALLET`)
- `initial_balance INTEGER NOT NULL DEFAULT 0` (Rupiah penuh, `i64`)
- `merged_into_id TEXT` (nullable; penggabungan manual)
- `is_deleted INTEGER NOT NULL DEFAULT 0`, `updated_hlc TEXT NOT NULL`

**`categories`**
- `id TEXT PRIMARY KEY` (UUIDv7)
- `name TEXT NOT NULL`, `normalized_name TEXT NOT NULL`, `kind TEXT NOT NULL` (`EXPENSE` | `INCOME`)
- `merged_into_id TEXT`, `is_deleted INTEGER NOT NULL DEFAULT 0`, `updated_hlc TEXT NOT NULL`
- Normalisasi: Unicode NFKC → lowercase → buang semua karakter non-alfanumerik. **Diimplementasikan hanya di Rust** (satu sumber kebenaran), frontend tidak menghitungnya sendiri.

**`transactions`**
- `id TEXT PRIMARY KEY` (UUIDv7)
- `account_id TEXT NOT NULL`, `to_account_id TEXT` (hanya untuk `TRANSFER`), `category_id TEXT` (**nullable**; wajib untuk `EXPENSE`/`INCOME`, `NULL` untuk `TRANSFER`)
- `amount INTEGER NOT NULL`: `EXPENSE` negatif, `INCOME` positif, `TRANSFER` **positif** (arah ditentukan `account_id` → `to_account_id`)
- `tx_type TEXT NOT NULL` (`EXPENSE` | `INCOME` | `TRANSFER`)
- `note TEXT`, `tx_date TEXT NOT NULL` (ISO `YYYY-MM-DD`), `created_by_device TEXT NOT NULL`
- `link_id TEXT` (opsional; penanda pasangan transfer antar-buku, tanpa FK)
- `is_deleted INTEGER NOT NULL DEFAULT 0`, `updated_hlc TEXT NOT NULL`
- Validasi di command: tanda `amount` harus konsisten dengan `tx_type`; `TRANSFER` wajib `account_id != to_account_id`; nilai harus `Number.isSafeInteger` di sisi TS.

**`budgets`**
- `id TEXT PRIMARY KEY` (UUIDv5 deterministik, lihat A7)
- `category_id TEXT` (nullable; `NULL` = budget total seluruh pengeluaran)
- `period TEXT NOT NULL` (v1: hanya `MONTHLY`)
- `amount_limit INTEGER NOT NULL` (Rupiah penuh, harus > 0)
- `alert_threshold_pct INTEGER NOT NULL DEFAULT 80` (1 sampai 100)
- `is_deleted INTEGER NOT NULL DEFAULT 0`, `updated_hlc TEXT NOT NULL`
- Progress/terpakai **tidak disimpan**; selalu dihitung dari `transactions`.

**`crdt_oplog`**
- `hlc_timestamp TEXT PRIMARY KEY`, `table_name TEXT NOT NULL`, `row_id TEXT NOT NULL`, `payload_json TEXT NOT NULL`, `device_id TEXT NOT NULL`

**`sync_peers`** (lokal, tidak disinkronkan): `node_id TEXT PRIMARY KEY`, `device_id TEXT`, `last_seen_at TEXT`.

**Indeks wajib**: `transactions(tx_date DESC)`, `transactions(account_id)`, `transactions(category_id)`, `crdt_oplog(device_id, hlc_timestamp)`, `categories(kind, normalized_name)`, `budgets(category_id, period)`, `transactions(tx_type, tx_date)`.

---

## 5. CRDT: HLC & ATURAN MERGE

### 5.1 Format HLC
`{wall_ms:013}-{counter:05}-{device_id}`, zero-padded desimal, sehingga **urutan leksikografis = urutan kausal**. Implementasi di `hlc.rs`:
- `tick()` untuk event lokal, `receive(remote)` untuk update dari peer; state dipersist ke `meta.hlc_last`.
- Counter naik untuk setiap op, termasuk beberapa op dalam satu transaksi.
- **Guard drift**: tolak op remote yang `wall_ms`-nya > now + 24 jam (laporkan lewat `sync:status` error, jangan crash).

### 5.2 Format op
`payload_json` = `{ "op": "upsert", "row": { ...snapshot baris penuh termasuk updated_hlc } }`. Hapus = upsert dengan `is_deleted = 1` (tombstone, tidak pernah `DELETE` fisik).

### 5.3 Aturan apply (`merge_remote_oplog`)
Untuk setiap op, dalam satu transaksi ACID:
1. `INSERT OR IGNORE` ke `crdt_oplog` (idempotensi via PK).
2. Baris belum ada → insert. Baris ada dan `op.hlc > row.updated_hlc` → timpa. Selain itu → abaikan.
3. Hasil harus **idempoten, komutatif, dan konvergen** apa pun urutan/duplikasi op. Ini harus dibuktikan oleh test (Bagian 12).
4. Setelah batch, jalankan `dedupe_categories()` lalu emit `crdt:synced`.

### 5.4 Auto-merge kategori kembar (deterministik)
- Grup: `(kind, normalized_name)` dengan baris `is_deleted = 0`. Jika ada >1 baris, **kanonik = `id` terkecil** (leksikografis).
- `merged_into_id` hasil auto-merge adalah **state turunan**: dihitung ulang setelah setiap apply, **tidak ditulis ke oplog** (agar tidak terjadi badai op antar perangkat). Karena fungsinya murni atas himpunan baris, semua perangkat konvergen ke hasil sama.
- Transaksi yang menunjuk kategori ter-merge diresolusi saat baca lewat `COALESCE(merged_into_id, id)`.

### 5.5 Penggabungan akun manual
- Merge manual **dicatat ke oplog**. Target harus di-resolve ke root dulu (tolak jika target sudah ter-merge ke akun lain).
- Resolusi root pakai recursive CTE dengan batas kedalaman 16. Jika terdeteksi siklus (akibat merge bersamaan A→B dan B→A), root = `id` terkecil dalam siklus.

### 5.6 Budget
- Karena `id` deterministik (A7), konflik pembuatan budget otomatis diselesaikan LWW per-row (5.3), tanpa langkah dedupe khusus.
- Jika dua kategori digabung (5.4) sehingga ada lebih dari satu budget yang ter-resolve ke kategori kanonik + periode yang sama, saat baca gunakan **satu** budget saja: `updated_hlc` terbesar menang (seri: `id` terkecil). Pemilihan ini turunan dan tidak ditulis ke oplog.
- Budget yang kategorinya `is_deleted = 1` disembunyikan dari daftar dan perhitungan, tetapi barisnya tidak dihapus (muncul lagi bila kategori dipulihkan).

---

## 6. SYNC P2P (iroh)

### 6.1 Abstraksi
Semua logika jaringan di balik `trait Transport` (`connect`, `accept`, `send_batch`, `recv_batch`) dengan implementasi `IrohTransport`. Protokol di atasnya tidak boleh bergantung pada tipe iroh langsung.

### 6.2 Identitas, topic, dan kunci
- Satu `NodeId` iroh per perangkat; secret key-nya disimpan di secure storage OS lewat trait `KeyStore`.
- Per buku: `book_key` (32 byte acak). Turunkan dengan BLAKE3 `derive_key` tiga nilai berbeda: `topic_id`, `auth_key`, `enc_key`. Jangan memakai `book_key` mentah untuk lebih dari satu tujuan.
- Book key disimpan di secure storage OS, **bukan** di file `.sqlite`.

### 6.3 Protokol (ALPN `fmm/sync/1`)
1. **Hello**: pengirim mengirim `{ book_topic_id, device_id, nonce }`; lawan membalas challenge. Kedua sisi membuktikan pengetahuan `auth_key` lewat HMAC. Peer yang gagal bukti **ditolak dan diputus** tanpa membocorkan apakah buku itu ada.
2. **Frontier exchange**: tiap sisi mengirim `{ device_id → max_hlc }`.
3. **Delta**: tiap sisi mengirim op yang belum dimiliki lawan, dalam batch (maks. 500 op atau 256 KB), tiap batch dienkripsi XChaCha20-Poly1305 dengan `enc_key` dan nonce acak 24 byte.
4. **Live push**: setelah sinkron awal, op lokal baru langsung didorong ke peer yang terhubung.
5. Penerima menerapkan batch lewat `merge_remote_oplog` (5.3).

### 6.4 Invite & join
- QR berisi `{ v, book_id, book_name, book_key, inviter_node_addr }`. **Perlakukan sebagai rahasia**: tampilkan dengan peringatan jelas, sertakan `expires_at` (default 10 menit), dan sembunyikan otomatis saat app ke background.
- Alur join: scan QR → buat file buku kosong dengan `book_id` itu → simpan kunci → connect ke inviter → sinkron penuh.
- Peer yang dikenal disimpan ke `sync_peers`; saat Hello, peer saling bertukar daftar `node_id` yang dikenal supaya buku dengan >2 perangkat bisa saling terhubung.

### 6.5 Lifecycle (foreground-only)
- Mulai sesi sync saat app start/resume dan buku dibuka; hentikan bersih saat app pause/background. Tangani reconnect dengan exponential backoff (maks. 60 detik).
- Pill status di UI harus jujur: tampilkan "Tidak ada perangkat lain yang online" sebagai kondisi normal, bukan error.

---

## 7. COMMAND RUST (IPC)

Semua command menerima `book_id` (kecuali manajemen buku), mengembalikan `Result<T, AppError>` dengan `AppError` serializable (`code`, `message`).

- **Buku**: `list_books`, `create_book`, `rename_book`, `delete_book`, `open_book`, `close_book`, `export_book_encrypted`.
- **Akun**: `list_accounts`, `upsert_account`, `delete_account`, `merge_accounts`.
- **Kategori**: `list_categories`, `upsert_category`, `delete_category`.
- **Transaksi**: `add_transaction`, `update_transaction`, `delete_transaction`, `list_transactions` (filter tanggal/akun/kategori/tipe/teks, sort, **pagination sisi server** dengan keyset atau LIMIT/OFFSET), `transfer_between_books` (A5).
- **Saldo & ringkasan**: `get_account_balances`, `get_cash_flow_summary` (agregat per bulan untuk grafik dashboard).
- **Budget**: `list_budgets`, `upsert_budget` (membuat atau mengubah; id dihitung di Rust), `delete_budget` (tombstone), `get_budget_progress(book_id, month: "YYYY-MM")`.
- **Sync**: `get_sync_status`, `create_invite`, `join_book_from_invite`, `list_peers`.
- **Inti CRDT**: `merge_remote_oplog` (dipanggil internal oleh lapisan sync, bukan oleh frontend).

### Spesifikasi logika inti
1. **`add_transaction`**: validasi → tulis baris transaksi **dan** op `crdt_oplog` dalam satu `BEGIN IMMEDIATE ... COMMIT`. Gagal di tengah = rollback total.
2. **`get_account_balances`**: saldo per akun *root* (hasil resolusi `merged_into_id`, lihat 5.5):
   `initial_balance` (dijumlahkan seluruh anggota merge) + Σ `INCOME`/`EXPENSE` (amount bertanda) − Σ `TRANSFER` keluar + Σ `TRANSFER` masuk. Abaikan baris `is_deleted = 1`. Gunakan `i64` dan `checked_add`.
3. **`merge_remote_oplog`**: sesuai 5.3 dan 5.4.
4. **`get_budget_progress`**: untuk tiap budget aktif pada bulan `month`, hitung dalam **satu query** (tanpa N+1):
   - `spent` = −Σ `amount` untuk `tx_type = 'EXPENSE'`, `is_deleted = 0`, `tx_date >= 'YYYY-MM-01'` dan `< 'YYYY-MM+1-01'`, dengan kategori ter-resolve (`COALESCE(merged_into_id, id)`) sama dengan kategori budget. Untuk budget total: semua `EXPENSE` kecuali kategori sistem (A6). `spent` selalu `>= 0`, tipe `i64`.
   - `remaining = amount_limit − spent` (boleh negatif), `pct = spent * 100 / amount_limit`.
   - `status`: `OK` jika `pct < alert_threshold_pct`, `WARNING` jika `alert_threshold_pct <= pct <= 100`, `OVER` jika `pct > 100`. Urutkan `pct` menurun.

---

## 8. DESIGN SYSTEM: ENTERPRISE EMERALD (Vercel & Supabase aesthetic)

### 8.1 Zero shadow
- **Tanpa box-shadow sama sekali.** Hapus semua kelas `shadow-*` dari komponen shadcn (Card, Button, Input, Dialog, Sheet, Popover, DropdownMenu, Select, dll.) dan set `shadow-none` eksplisit.
- Catatan penting: di Tailwind, utilitas **`ring-*` memakai box-shadow**, jadi dilarang juga. State fokus memakai `outline`: `focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary`.
- Tambahkan di `index.css` pengaman global: `*, ::before, ::after { --tw-shadow: 0 0 #0000; --tw-ring-shadow: 0 0 #0000; }`.

### 8.2 Pola Tabular Border Grid (anti double-border)
- Container: `bg-border gap-px border border-border rounded-lg overflow-hidden` (`grid`/`flex` sesuai kebutuhan). Setiap child memakai `bg-card` sehingga garis 1px tampil tajam tanpa border ganda. Tidak ada margin antar-kartu.
- Untuk tabel: header dan baris sebagai child grid dengan pola yang sama; tidak ada `border-b` ganda pada baris.

### 8.3 Palet warna (sumber kebenaran = nilai hex)
| Token | Light | Dark (default) |
|---|---|---|
| background | `#ffffff` | `#09090b` |
| card | `#fafafa` | `#121215` |
| border | `#e4e4e7` | `#27272a` |
| foreground | `#09090b` | `#f4f4f5` |
| primary | `#15803d` | `#10b981` |
| primary-foreground | `#ffffff` | `#022c22` |

- Perbaikan dari versi lama: nilai HSL dan hex untuk primary sebelumnya tidak setara, dan teks putih di atas `#10b981` kontrasnya terlalu rendah (~2.5:1). Gunakan tabel di atas; kontras teks UI minimal **WCAG AA (4.5:1)**.
- Aksen fungsional: Expense `rose-500`, Income `emerald-500`, Transfer `sky-500`. Jangan hanya bergantung pada warna: sertakan ikon atau tanda (+/−) untuk pembeda.
- Dark mode default via class `dark` di `<html>`; pilihan tema disimpan di `localStorage` (bukan Zustand, lihat 9.3).

### 8.4 Tipografi & format angka
- Font: Geist (fallback Inter, `system-ui`), dibundel lokal (app harus jalan offline; **jangan** load dari CDN).
- Angka uang dan metadata: `font-mono tabular-nums tracking-tight`. Format `Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })`.
- **Currency input: wajib `react-number-format` v5 (`NumericFormat`) untuk SETIAP input nominal** (nominal transaksi, saldo awal akun, batas budget, filter min/max). Dilarang memakai `<input>` mentah atau masking buatan sendiri untuk uang.
  - Alasan pemilihan: caret engine bawaan menangani cursor-jumping, paste, dan edit di tengah angka; TypeScript bawaan; sangat banyak dipakai; bisa membungkus input shadcn lewat `customInput`. `react-currency-input-field` dipertimbangkan, tetapi berorientasi nilai string dan desimal/locale sehingga kurang pas untuk integer Rupiah.
  - Bungkus **sekali** di `src/components/ui/currency-input.tsx` dan pakai di mana-mana. Konfigurasi baku: `thousandSeparator="."`, `decimalSeparator=","`, `decimalScale={0}`, `allowNegative={false}`, `allowLeadingZeros={false}`, `prefix="Rp "`, `inputMode="numeric"`, `customInput={Input}` (shadcn; tetap `font-mono tabular-nums tracking-tight text-right`), dan `isAllowed` yang membatasi nilai ≤ 999.999.999.999.999 (15 digit, aman untuk `Number.isSafeInteger`).
  - Kontrak komponen: props `value: number | null` dan `onValueChange(value: number | null)`; nilai berasal dari `values.floatValue` (integer mentah), **bukan** string terformat; kosong = `null`. Harus bisa dipakai lewat `Controller` react-hook-form.
  - Tanda negatif tidak pernah diinput; tanda `amount` ditentukan `tx_type` saat submit (lihat skema `transactions`).
  - Sebelum dipakai: pin versi eksak dan cek `peerDependencies`-nya mendukung React 19. Jika tidak, nyatakan di akhir Fase 3 dan pilih versi terbaru yang kompatibel.
  - Karena jsdom tidak mensimulasikan caret, uji manual wajib di Android WebView dan iOS WKWebView (keyboard numerik, edit di tengah angka, paste).

---

## 9. ARSITEKTUR FRONTEND

### 9.1 Routing
- TanStack Router **file-based** dengan `createHashHistory()` (wajib, agar tidak blank saat back/refresh di WebView). Plugin Vite menghasilkan `routeTree.gen.ts`.
- Struktur route (perubahan dari versi lama: prefix `_book` di TanStack Router berarti *pathless layout*, sehingga URL tidak memuat `books`. Dipakai `books/$bookId` agar URL eksplisit):
  - `/` → Book Switcher (daftar buku lokal, tambah buku, join via QR, indikator status file)
  - `/books/$bookId` → layout buku aktif (Sidebar, Header, Breadcrumbs, Book Switcher dropdown, pill sync)
  - `/books/$bookId/dashboard` → alokasi saldo, kartu statistik tabular, grafik arus kas, ringkasan budget bulan berjalan, aksi cepat
  - `/books/$bookId/transactions` → data table (TanStack Table; sorting, filter kolom, pagination **server-side**, indikator device ID)
  - `/books/$bookId/accounts` → manajemen akun
  - `/books/$bookId/categories` → manajemen kategori dengan badge auto-merge
  - `/books/$bookId/budgets` → manajemen budget bulanan (lihat 9.5)
  - `/books/$bookId/settings` → sync P2P buku ini (invite QR, daftar peer, export `.sqlite` terenkripsi)
- `beforeLoad` pada layout buku: panggil `open_book`; jika `bookId` tidak valid, redirect ke `/` dengan toast.
- Sediakan `errorComponent` dan `pendingComponent` per route.

### 9.2 TanStack Query
- Query key **wajib** menyertakan buku: `['books', bookId, 'accounts']`, `['books', bookId, 'categories']`, `['books', bookId, 'transactions', filters]`, `['books', bookId, 'balances']`, `['books', bookId, 'summary']`, `['books', bookId, 'budgets', month]`.
- Mutasi lokal meng-invalidate key terkait saat sukses. Event `crdt:synced` meng-invalidate hanya key untuk `tables` yang berubah pada `book_id` tersebut. Karena progress budget dihitung dari transaksi, perubahan pada `transactions`, `categories`, atau `budgets` juga meng-invalidate key `budgets`.
- Hook `useBookFinance.ts` membungkus semua query/mutation dan mengelola listener event dengan cleanup yang benar (hindari listener ganda di React 19 StrictMode).

### 9.3 Zustand (UI state saja)
Hanya: `isNewTransactionModalOpen`, `activeFilterDraft`, `activeDrawerId`. **Dilarang** menyimpan data transaksi/saldo/akun/kategori di Zustand. Dialog/drawer budget memakai `activeDrawerId` (mis. `"budget:new"`, `"budget:{id}"`), tidak menambah state baru.

### 9.4 Tauri
- Konfigurasi `capabilities/default.json` dengan permission minimal (hanya yang dipakai: event, dialog, clipboard bila perlu).
- Tambahkan CSP ketat di `tauri.conf.json`; tidak ada request jaringan dari WebView (semua jaringan lewat Rust).

### 9.5 Fitur Budget
- Halaman `/budgets`: pemilih bulan (default bulan berjalan, bisa maju/mundur), daftar budget dalam grid tabular (pola 8.2). Tiap baris: nama kategori (atau "Total Pengeluaran"), terpakai/limit (mono), sisa, progress bar tanpa shadow, tombol edit.
- Warna progress: `primary` saat `OK`, `amber-500` saat `WARNING`, `rose-500` saat `OVER`. **Selalu sertakan label teks status** (jangan hanya warna).
- `BudgetDialog`: pilih kategori (hanya `EXPENSE`, plus opsi "Semua pengeluaran"), `CurrencyInput` untuk limit, ambang peringatan 1 sampai 100 (default 80). Jika budget untuk kategori+periode itu sudah ada, dialog masuk **mode edit** (id deterministik), bukan error duplikat.
- Dashboard menampilkan kartu "Budget bulan ini" berisi 3 budget dengan `pct` tertinggi.
- Peringatan hanya di dalam app (badge, banner, toast saat transaksi yang baru disimpan membuat budget melewati ambang). Tidak ada push notification di v1 (foreground-only).
- Membuat budget tidak mengubah transaksi lama; progress selalu dihitung ulang dari data.

---

## 10. KEAMANAN & PRIVASI

- Jangan pernah mencatat (log) kunci, isi QR invite, atau nominal transaksi. Log hanya ID dan hitungan.
- Zeroize material kunci di memori setelah dipakai (`zeroize`).
- File ekspor: format `[header versi | salt | nonce | ciphertext]`, kunci diturunkan dari passphrase pengguna (Argon2id), bukan dari book key.
- Semua input dari peer dianggap tidak tepercaya: validasi ukuran batch, skema `payload_json`, dan nilai tiap kolom sebelum apply.

---

## 11. DELIVERABLES PER FASE

**Fase 1: Fondasi Rust**
`src-tauri/Cargo.toml`, `src-tauri/src/{lib.rs, error.rs, db.rs, hlc.rs, crdt.rs, commands.rs}`: pool dinamis, migrasi, UUIDv7 helper, HLC, `add_transaction`, `get_account_balances`, `merge_remote_oplog`, dedupe kategori, resolusi root akun, tabel `budgets` dengan `get_budget_progress`, plus **unit test** (Bagian 12).

**Fase 2: Sync P2P**
`src-tauri/src/sync/{mod.rs, transport.rs, iroh_transport.rs, protocol.rs, crypto.rs, keystore.rs}`, command `create_invite`/`join_book_from_invite`, event `crdt:synced` dan `sync:status`, lifecycle foreground-only.

**Fase 3: Frontend inti**
`tailwind.config.ts`, `src/index.css` (token Emerald, no-shadow, tabular border), `src/lib/tauri-api.ts` (wrapper `invoke` type-safe, tipe TS mencerminkan struct Rust), `src/hooks/useBookFinance.ts`, `src/stores/ui-store.ts`, `src/components/ui/currency-input.tsx` (lihat 8.4), `src/routes/**`, router setup hash history.

**Fase 4: UI**
`src/components/layout/BookLayout.tsx` (header tabular border + live sync indicator), `src/components/transactions/TransactionTable.tsx` (TanStack Table, border menyatu ala Vercel), `src/components/transactions/TransactionDialog.tsx` (memakai `CurrencyInput`), halaman Switcher, Dashboard (dengan kartu budget), Accounts, Categories, **Budgets** (`BudgetsPage.tsx`, `BudgetDialog.tsx`, `BudgetProgressBar.tsx`), Settings.

---

## 12. KRITERIA PENERIMAAN & PENGUJIAN

**Rust (`cargo test`)**
- HLC: monoton, urutan leksikografis benar, `receive()` menggeser clock, guard drift menolak op > +24 jam.
- Konvergensi CRDT: untuk himpunan op acak, menerapkan dalam **urutan acak** dan **dengan duplikasi** di dua database terpisah harus menghasilkan isi tabel identik (property test).
- Dedupe kategori: hasil sama di semua urutan; kanonik = `id` terkecil.
- Resolusi merge akun: kasus rantai, dan siklus A→B/B→A.
- `get_account_balances`: akun ter-merge, transfer antar-akun, baris `is_deleted`, nilai besar (tanpa overflow).
- `get_budget_progress`: batas bulan (31 Jan vs 1 Feb), `TRANSFER` dan `INCOME` tidak dihitung, baris `is_deleted`, kategori ter-merge dihitung ke kanonik, budget total mengecualikan kategori sistem, status `OK`/`WARNING`/`OVER` tepat di ambang (mis. 79%, 80%, 100%, 101%), `amount_limit` sangat besar tanpa overflow.
- Budget CRDT: dua perangkat membuat budget yang sama (kategori+periode sama) bersamaan menghasilkan **satu** baris dengan nilai LWW; dua budget yang ter-resolve ke kategori kanonik sama hanya dihitung satu kali (5.6).
- `add_transaction`: kegagalan di tengah tidak meninggalkan baris tanpa op (atomik).
- Protokol sync: peer dengan `auth_key` salah ditolak; batch yang dimodifikasi gagal dekripsi.

**Frontend (`vitest`)**
- `CurrencyInput` (Vitest + user-event): ketik, hapus, paste (`"Rp 1.500.000"` dan `"1500000"`), edit di tengah angka, batas 15 digit, tidak menerima `-`/desimal; `onValueChange` selalu mengembalikan integer atau `null`, tidak pernah string. Verifikasi manual caret di perangkat nyata (lihat 8.4).
- `BudgetsPage`: status warna disertai label teks; event `crdt:synced` dengan `tables` berisi `transactions` meng-invalidate query budget.
- Query key selalu memuat `bookId`; event `crdt:synced` untuk buku lain tidak meng-invalidate buku aktif.

**Checklist akhir (nyatakan lulus/tidak di akhir Fase 4)**
- [ ] Tidak ada `box-shadow` atau `ring-*` di komponen mana pun
- [ ] Semua angka uang memakai `font-mono tabular-nums tracking-tight`
- [ ] Tidak ada `<input>` mentah untuk nominal; semua lewat `CurrencyInput` (`react-number-format`)
- [ ] Fitur budget lengkap: skema, command, route, dialog, kartu dashboard, test
- [ ] Tidak ada data keuangan di Zustand
- [ ] TypeScript lolos `strict` tanpa `any`
- [ ] Tidak ada `TODO`, placeholder, atau kode terpotong
- [ ] App berfungsi penuh tanpa jaringan; sync hanya bergantung pada peer, bukan pada server pihak ketiga selain relay iroh untuk konektivitas
