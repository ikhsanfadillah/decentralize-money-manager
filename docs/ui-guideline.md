# UI Style & Design System Guideline — Neutral Zinc Glass

Dokumen ini mendefinisikan gaya visual **Neutral Zinc Glass** pada proyek **Decentralize Money Manager (`p2p-money-manager`)** untuk kedua target runtime (**Tauri v2 Desktop/Mobile** dan **Static Web/PWA**).

Panduan ini berevolusi dari konsep *Glassmorphic Financial Clarity* dengan kanvas **Neutral Zinc Monochrome** yang tenang dan bebas bias warna hangat/merek, sehingga angka pemasukan, pengeluaran, target anggaran, serta grafik tetap menjadi pusat perhatian utama **tanpa mengubah** arsitektur data lokal/CRDT maupun aturan keamanan proyek.

---

## 1. Filosofi & Prinsip Desain

1. **Neutral Zinc Canvas (Unbiased Polarity):** Latar belakang mode gelap (default) menggunakan gradasi halus abu-abu netral (*obsidian-to-zinc* `#09090b → #111114 → #16161a`), sementara mode terang menggunakan kanvas putih lembut hingga alabaster netral (`#fafafa → #f5f5f7 → #f1f1f3`). Pendekatan monokromatik ini membuat aplikasi terasa netral, objektif, dan berfokus penuh pada data uang.
2. **Monochrome Interactive Chrome (`bg-cta-surface`):** Tombol aksi utama (*CTA*), tombol apung `+` (*FAB*), tombol konfirmasi geser (`ButtonSlideToConfirm`), pill tab aktif, dan operator kalkulator menggunakan permukaan adaptif hitam/putih netral—putih murni di Dark Mode dan hitam zinc di Light Mode—bukan warna aksen amber atau merek tertentu.
3. **Translucent Glass Layering:** Kartu dan banner menggunakan lapisan kaca semi-transparan dengan garis tepi `1px` tipis (`hairline border`) untuk memisahkan hierarki konten tanpa *drop shadow* yang berat.
4. **Hero Financial Clarity:** Nominal saldo utama tampil paling dominan dengan ukuran besar, kontras tinggi (`#fafafa` / `#09090b`), dan perataan angka tabular (`tabular-nums`).
5. **Privacy-Aware by Default:** Mendukung penyamaran nominal sensitif (*Privacy Eye Toggle*) pada ringkasan kekayaan agar aman dibuka di ruang publik.
6. **Semantic Color Restraint:** Warna cerah hanya dipakai untuk makna finansial & status nyata (**Emerald** Pemasukan/Aman, **Rose** Pengeluaran/Melebihi Batas/Hapus, **Amber** Peringatan/Batas Anggaran/Pindah Buku, **Sky** Transfer), bukan sebagai dekorasi latar belakang.
7. **Zero-CDN & Offline-First Assets:** Seluruh font, ikon (`lucide-react`), dan ilustrasi SVG dibundel lokal agar aplikasi tampil identik dalam kondisi tanpa internet.

---

## 2. Color System & Design Tokens

### 2.1 Background Canvas (Gradient)

Pada mode gelap (default), area viewport utama (`body`) menggunakan gradasi vertikal netral yang halus (*fixed/full-height gradient*):

| Stop | Lokasi | Hex / Nilai | Keterangan |
| :--- | :--- | :--- | :--- |
| **Canvas Start** | `0%` (Atas) | `#09090b` | Deep Obsidian Zinc (area status bar & header) |
| **Canvas Mid** | `50%` (Tengah) | `#111114` | Charcoal Zinc (area saldo & konten utama) |
| **Canvas End** | `100%` (Bawah) | `#16161a` | Soft Slate Zinc (area kartu bawah & dock) |

> **Light Mode:** Mode terang menggunakan gradasi netral bersih (`#fafafa 0% → #f5f5f7 52% → #f1f1f3 100%`) dengan kartu kaca putih (`rgba(255, 255, 255, 0.85)`) dan teks `#09090b`.

### 2.2 Semantic & Surface Tokens

| Token CSS Variable | Dark Mode (Default) | Light Mode | Penggunaan |
| :--- | :--- | :--- | :--- |
| `--color-background` | `#09090b` | `#fafafa` | Fallback warna dasar & area overscroll |
| `--color-floating-surface` | `#121216` | `#ffffff` | Permukaan `Drawer`, `Dialog`, `<select>`, & menu mengambang |
| `--color-foreground` | `#fafafa` | `#09090b` | Judul utama, saldo hero, angka utama |
| `--color-card` | `rgba(255, 255, 255, 0.055)` | `rgba(255, 255, 255, 0.85)` | Kartu *glass* standar (`Rekening & Dompet`, daftar buku, histori) |
| `--color-card-contrast` | `rgba(20, 20, 24, 0.92)` | `#18181b` | Kartu edukasi/insight/peringatan kontras tinggi |
| `--color-border` | `rgba(255, 255, 255, 0.11)` | `rgba(24, 24, 27, 0.10)` | *Hairline border* 1px kartu & pemisah internal |
| `--color-primary` | `#e4e4e7` | `#27272a` | Aksen monokrom (focus ring, badge sistem, highlight grafik, ikon perangkat) |
| `--color-primary-foreground` | `#09090b` | `#ffffff` | Teks/ikon di atas latar `--color-primary` |
| `--color-cta-surface` | `#ffffff` | `#09090b` | Seluruh action button utama, FAB `+`, tab pill aktif, dan slider `ButtonSlideToConfirm` |
| `--color-cta-foreground` | `#09090b` | `#ffffff` | Teks/ikon di atas `bg-cta-surface` |
| `--color-muted` | `rgba(255, 255, 255, 0.06)` | `rgba(24, 24, 27, 0.06)` | Latar tombol sekunder, chip filter, segmen bar kosong |
| `--color-muted-foreground` | `rgba(255, 255, 255, 0.68)` | `#52525b` | Label sekunder, metadata waktu, tab nav nonaktif |
| `--color-dock` | `rgba(15, 15, 18, 0.88)` | `rgba(255, 255, 255, 0.90)` | Latar *Floating Pill Bottom Navigation* (dengan `backdrop-blur-xl`) |

### 2.3 Functional Financial & Status Colors

Warna fungsional dipertahankan secara eksplisit dan **tidak boleh berdiri sendiri**—selalu pasangkan dengan tanda (`+`, `−`, `⇄`), ikon, atau label teks status:

| Makna | Dark Mode | Light Mode | Pendamping Wajib |
| :--- | :--- | :--- | :--- |
| **Income / Surplus / Aman / Sync Connected** | `#34D399` (`emerald-400`) | `#15803D` (`emerald-700` / `emerald-600`) | Tanda `+`, ikon `TrendingUp`, label `"Aman"`, atau dot status hijau |
| **Expense / Defisit / Over-Budget / Hapus** | `#FB7185` (`rose-400`) | `#BE123C` (`rose-700` / `rose-500`) | Tanda `−`, ikon `TrendingDown` / `MinusCircle`, label `"Melebihi Batas"` |
| **Warning / Connecting / Security Notice / Pindah Buku** | `#FBBF24` (`amber-400`) | `#B45309` (`amber-700` / `amber-600`) | Label `"Peringatan"`, `"File Lokal Hilang"`, `"Menghubungkan..."`, atau garis batas anggaran |
| **Transfer Antar-Akun** | `#38BDF8` (`sky-400`) | `#0369A1` (`sky-700`) | Tanda `⇄` / panah `→`, label `"Transfer"` |

### 2.4 Implementasi Token di `src/index.css`

```css
@layer base {
  :root {
    color-scheme: light;
    --color-background: #fafafa;
    --color-card: rgba(255, 255, 255, 0.85);
    --color-card-contrast: #18181b;
    --color-border: rgba(24, 24, 27, 0.1);
    --color-foreground: #09090b;
    --color-primary: #27272a;
    --color-primary-foreground: #ffffff;
    --color-cta-surface: #09090b;
    --color-cta-foreground: #ffffff;
    --color-dock: rgba(255, 255, 255, 0.9);
    --color-muted: rgba(24, 24, 27, 0.06);
    --color-muted-foreground: #52525b;
    --color-floating-surface: #ffffff;
    --canvas-gradient: linear-gradient(180deg, #fafafa 0%, #f5f5f7 52%, #f1f1f3 100%);
  }

  .dark {
    color-scheme: dark;
    --color-background: #09090b;
    --color-card: rgba(255, 255, 255, 0.055);
    --color-card-contrast: rgba(20, 20, 24, 0.92);
    --color-border: rgba(255, 255, 255, 0.11);
    --color-foreground: #fafafa;
    --color-primary: #e4e4e7;
    --color-primary-foreground: #09090b;
    --color-cta-surface: #ffffff;
    --color-cta-foreground: #09090b;
    --color-dock: rgba(15, 15, 18, 0.88);
    --color-muted: rgba(255, 255, 255, 0.06);
    --color-muted-foreground: rgba(255, 255, 255, 0.68);
    --color-floating-surface: #121216;
    --canvas-gradient: linear-gradient(180deg, #09090b 0%, #111114 50%, #16161a 100%);
  }

  body {
    background-color: var(--color-background);
    background-image: var(--canvas-gradient);
    background-attachment: fixed;
    color: var(--color-foreground);
  }
}
```

> **Catatan `index.html` & `applyTheme` (`src/lib/utils.ts`):** `<meta name="theme-color">` disinkronkan ke `#09090b` pada mode gelap dan `#fafafa` pada mode terang agar *status bar* PWA/Android menyatu mulus dengan ujung atas kanvas.

---

## 3. Typography & Format Angka

### 3.1 Font Stack (Local Bundled)
Tetap gunakan font lokal tanpa request eksternal (memenuhi CSP Tauri dan mode offline):
* **UI & Display (`--font-sans`):** `"Geist", "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif`
* **Angka & Kode (`--font-mono`):** `"Geist Mono", "JetBrains Mono", ui-monospace, monospace` *(atau `font-sans tabular-nums` untuk nominal hero agar tampilan tetap modern dan bulat)*

### 3.2 Skala Tipografi

| Level | Ukuran (Mobile → Desktop) | Weight & Tracking | Penggunaan di Proyek |
| :--- | :--- | :--- | :--- |
| **Hero Balance** | `2.25rem` → `2.5rem` (`36px–40px`) | `font-extrabold tracking-tight tabular-nums leading-none` | Total saldo buku di `DashboardPage` (`Rp 49.188.000`) |
| **App / Page Title** | `1.375rem` → `1.5rem` (`22px–24px`) | `font-extrabold tracking-tight` | Nama buku aktif di header (`Kas Pribadi`) / judul halaman `BookSwitcherPage` |
| **Section & Card Metric** | `1rem` → `1.125rem` (`16px–18px`) | `font-bold tracking-tight tabular-nums` | Persentase target (`42%`), ringkasan `Pemasukan / Pengeluaran` |
| **Card Title & Body** | `0.875rem` → `0.9375rem` (`14px–15px`) | `font-semibold` (judul) / `font-normal` (isi) | Judul kartu (`Rekening & Dompet`), deskripsi kartu edukasi |
| **Label & Metadata** | `0.75rem` (`12px`) | `font-medium` | Label atas hero (`Total kekayaan buku`), badge status, subtitle middot |
| **Nav & Micro Caption** | `0.625rem` → `0.6875rem` (`10px–11px`) | `font-medium tracking-tight` | Label ikon `FloatingNavbar`, teks di bawah bar progres |

### 3.3 Aturan Wajib Input & Format Uang
1. **Formatting:** Gunakan `formatRupiah` / `formatSignedRupiah` dari `src/lib/utils.ts` (`Intl.NumberFormat("id-ID")`), serta format ringkas opsional (`Rp 51,66 jt`) khusus untuk slot metrik sekunder yang sempit di mobile.
2. **Tabular Numerals:** Semua nominal wajib memakai `tabular-nums` agar digit tidak bergeser saat data berubah atau saat *scroll* tabel transaksi.
3. **Currency Input:** Tetap wajib membungkus `react-number-format` melalui `src/components/ui/currency-input.tsx`. Tombol operator kalkulator internal (`+ − × ÷`) memakai kapsul netral (`bg-primary/12 text-foreground hover:bg-primary/20`) dan tombol konfirmasi `"Selesai"` memakai `bg-cta-surface text-cta-foreground`.

---

## 4. Layout, Spacing, Shape & Elevation

### 4.1 Struktur & Margin Container
* **Mobile-First Single Column:** Padding horizontal utama `px-5` (`20px`) dengan jarak vertikal antar-seksi `space-y-5` (`20px`).
* **Desktop / Tablet Adaptation:** Pada layar lebar (`lg+`), batasi konten utama dalam container terpusat (`mx-auto max-w-4xl` atau `max-w-5xl` untuk `TransactionTable` dan `MonthlyReportPage`) agar proporsi kartu tetap nyaman dibaca.
* **Safe Area Bawah:** Pertahankan jarak aman di bagian bawah `<main>` (`pb-32` / `calc(6.5rem + env(safe-area-inset-bottom, 24px))`) agar kartu paling bawah tidak tertutup *Floating Pill Navbar*.

### 4.2 Hierarki Kelengkungan (*Border Radius*)
* **Floating Bottom Dock & Pill Badges/Buttons:** `rounded-full` (`9999px`)
* **Primary Glass Cards & Contrast Cards:** `rounded-[22px]` atau `rounded-3xl` (`22px–24px`)
* **Banner & Vaul Drawers (Top Corners):** `rounded-2xl` / `rounded-t-3xl` (`16px–24px`)
* **Icon Thumbnails / Input Fields:** `rounded-xl` (`12px`)
* **Segmented Progress Ticks:** `rounded-[3px]` atau `rounded-full`

### 4.3 Kebijakan Shadow & Focus Ring
* **Kartu & Input (Flat Glass):** Tetap **tanpa drop-shadow** (`shadow-none`). Pemisahan visual dibangun dari tingkat opasitas kaca + *hairline border* `1px`.
* **Pengecualian Terkontrol (Floating Layers Only):** Hanya elemen yang benar-benar mengambang di atas konten—yakni `FloatingNavbar` dock (`.floating-navbar-pill`), tombol tengah `FAB +` (`.floating-navbar-fab`), `Dialog`/`Drawer` (`[data-floating-surface="true"]`), dan `Sonner` toast—yang diizinkan memakai bayangan netral lembut (`rgba(9, 9, 11, ...)` / `rgba(0, 0, 0, ...)`) + `backdrop-blur-xl`.
* **Focus Accessibility:** Tetap gunakan `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary` (hindari `ring-*`).

---

## 5. Komponen Inti (`p2p-money-manager`)

Berikut arsitektur komponen visual nyata di dalam `src/components/`:

### 5.1 Top App Bar (`src/components/layout/BookLayout.tsx`)
* **Kiri:** Tombol kembali kompak (`←`) dan pembuka *Book Switcher* dengan nama buku aktif (`bookMeta.name`, mis. `"Kas Pribadi"`).
* **Kanan:** Deretan tombol lingkaran kaca (`h-9 w-9 rounded-full border border-border bg-card backdrop-blur-sm`):
  1. **Sync Status / Notification Trigger:** Menampilkan ikon aktivitas sync dengan dot status semantik (`bg-emerald-400` terhubung, `bg-amber-400 animate-pulse` menyinkronkan, `bg-rose-400` error) menuju `/books/$bookId/sync`.
  2. **Theme Toggle:** Tombol lingkaran `Sun` (`text-amber-400` di Dark Mode) / `Moon` (`text-zinc-700` di Light Mode).
  3. **Device Badge Avatar:** Lingkaran netral (`bg-cta-surface text-cta-foreground font-bold border border-border`) berisi inisial `device_name` pengguna.

### 5.2 Hero Balance & Privacy Eye Toggle (`src/components/dashboard/DashboardPage.tsx`)
* **Baris Atas (Meta Row):**
  * Kiri: Label `"Total saldo saat ini"` + tombol ikon mata (`Eye` / `EyeOff`, `h-4 w-4`) untuk toggle penyamaran angka (*privacy mode*, state `isBalanceHidden` di `useUiStore`).
  * Kanan: *Status Pill* (`rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium`) berisi titik hijau `#34D399` + periode aktif.
* **Baris Utama (Hero Display):**
  * `formatRupiah(totalBalance)` dalam `text-4xl font-extrabold tracking-tight tabular-nums text-foreground`.
  * Jika `isBalanceHidden === true`, tampilkan `"Rp ••••••••"`.

### 5.3 Segmented Progress Meter (`src/components/budgets/BudgetProgressBar.tsx`)
* **Header Bar:** Nama target/anggaran di kiri + persentase tebal di kanan.
* **Visualisasi Batang (24 Segmen):**
  * Segmen terisi: warna semantik (`bg-emerald-500`/`emerald-400` `OK`, `bg-amber-500`/`amber-400` `WARNING`, `bg-rose-500`/`rose-400` `OVER`).
  * Segmen sisa: `bg-black/[0.08] dark:bg-white/[0.14]`.
* **Caption Bawah:** Nominal terpakai & sisa + badge label status eksplisit (`Aman`, `Peringatan`, `Melebihi Batas`).

### 5.4 Glass Summary Card (`DashboardPage`, `AccountsPage`, `BookSwitcherPage`)
* **Container:** `.glass-card` (`rounded-[22px] border border-border bg-card p-4 sm:p-5 backdrop-blur-md`).
* **Ikon Utama Kartu:** `bg-cta-surface text-cta-foreground` agar kontras monokromnya seragam di Mode Terang dan Gelap.
* **Contrast Card (`.contrast-card`):** Kartu gelap pekat (`#18181b` / `rgba(20, 20, 24, 0.92)`) dengan ikon lingkaran putih `bg-white text-zinc-950` untuk insight penting, peringatan CRDT permanen, atau catatan keamanan.

### 5.5 Empty State Illustrations (`src/components/ui/EmptyStateIllustration.tsx`)
* Seluruh 6 varian SVG (`monthly-history`, `recent-transactions`, `monthly-budget`, `transaction-filter`, `category-filter`, `active-budget-period`) memakai skala **Neutral Zinc** (`fill-white`/`fill-zinc-900`, `stroke-zinc-300`/`stroke-white/15`, aksen `zinc-800`/`zinc-200`) yang otomatis beradaptasi pada Light & Dark Mode via kelas Tailwind `dark:`.

### 5.6 Floating Pill Bottom Navigation (`src/components/layout/FloatingNavbar.tsx`)
* **Wadah Luar:** `fixed inset-x-0 bottom-3.5 z-40 mx-auto w-[calc(100%-2rem)] max-w-md`
* **Kapsul Dock:** `rounded-full border border-border bg-[var(--color-dock)] px-3 py-2 backdrop-blur-xl floating-navbar-pill`
* **Center FAB `+`:** Tombol lingkaran netral kontras tinggi (`h-12 w-12 rounded-full bg-cta-surface text-cta-foreground floating-navbar-fab active:scale-90 transition-transform`).

---

## 6. Panduan Adaptasi per Halaman

| Halaman / Route | Ringkasan Gaya Neutral Zinc Glass |
| :--- | :--- |
| **`BookSwitcherPage` (`/`)** | Header `"Daftar Buku Keuangan"` + CTA netral `bg-cta-surface`; daftar buku memakai *Glass Summary Cards* yang dapat diklik langsung; aksi **Ubah Nama** dan **Hapus Buku** (+ konfirmasi *Vaul Drawer*) berada di `SettingsPage`. |
| **`DashboardPage` (`/dashboard`)** | Top Bar → Banner status sync/offline → Hero Total Saldo + Privacy Eye Toggle → Segmented Budget Progress → Glass Card *"Rekening & Dompet"* (`bg-cta-surface`) → Glass Card *Transaksi Terbaru* → Dark Contrast Insight Card. |
| **`TransactionTable` (`/transactions`)** | Daftar transaksi dengan *infinite scroll pagination* (IntersectionObserver), search bar & filter kapsul netral (`bg-cta-surface`), angka `tabular-nums`, dan warna semantik pemasukan/pengeluaran. |
| **`BudgetsPage` (`/budgets`)** | Pemilih bulan *capsule pill* netral; item anggaran memakai `BudgetProgressBar` 24 segmen dengan badge `Aman` / `Peringatan` / `Melebihi Batas`. |
| **`MonthlyReportPage` (`/reports`)** | `InteractiveCashFlowChart` dan `InteractiveCategoryChart` memakai warna semantik Pemasukan `#34D399`, Pengeluaran `#FB7185`, garis batas anggaran `#F59E0B`, serta highlight kolom/hover hari berbasis Neutral Zinc (`rgba(161, 161, 170, ...)`). |
| **`SyncPage` & `BackupPage`** | QR Code undangan diletakkan di atas wadah putih bersih (`bg-white p-4 rounded-2xl`), didampingi *Contrast Warning Card* mengenai kerahasiaan `book_key` dan status sync foreground. |

---

## 7. Microcopy & UX Writing Standards

* **Ringkas & Manusiawi:** Gunakan bahasa Indonesia sehari-hari yang jelas dan tidak kaku (hindari jargon teknis berlebih di UI utama—mis. *"Perubahan tersimpan & tersinkron"*).
* **Middot Separator (`·`):** Gunakan karakter `·` dengan spasi di kiri-kanan untuk metadata ringkas dalam satu baris:
  * `3 rekening · 18 transaksi · 2 perangkat`
  * `Target Rp 5 jt · Nov 2026`
  * `09 Nov · BCA · Makan Siang`
* **Kejujuran Status P2P:** Kondisi tanpa peer online ditampilkan sebagai kondisi normal yang menenangkan (`"Tersimpan aman di perangkat ini"`), bukan status error merah.

---

## 8. Checklist Kepatuhan Implementasi

- [x] **Kanvas & Token:** `src/index.css`, `index.html`, dan `applyTheme` (`src/lib/utils.ts`) menggunakan kanvas Neutral Zinc (`#09090b → #111114 → #16161a` Dark, `#fafafa → #f5f5f7 → #f1f1f3` Light).
- [x] **Aksen & CTA Netral:** `--color-primary` (`#e4e4e7` / `#27272a`) dan `--color-cta-surface` (`#ffffff` / `#09090b`) menjaga antarmuka bebas bias warna merek.
- [x] **Kontras WCAG AA:** Teks `foreground` (`#fafafa` / `#09090b`) dan `cta-foreground` memenuhi rasio kontras standar di kedua mode.
- [x] **Semantic Colors Intact:** Pemasukan (Emerald), Pengeluaran/Hapus (Rose), Peringatan/Batas Anggaran/Pindah Buku (Amber), dan Transfer (Sky) tetap dipertahankan secara konsisten dengan pendamping label teks/ikon.
- [x] **Currency Input & Accessibility:** Seluruh input nominal memakai `CurrencyInput` (`react-number-format`), `EmptyStateIllustration` beradaptasi via `dark:`, dan transisi menghormati `useReducedMotion()`.
