import * as React from "react";
import type {
  AccountView,
  CategoryView,
  TransactionFilter,
} from "../../lib/tauri-api";
import { CurrencyInput } from "../ui/currency-input";
import { Input } from "../ui/input";

export interface FilterFormProps {
  filter: TransactionFilter;
  accounts: AccountView[];
  categories: CategoryView[];
  onFilterChange: (
    updater:
      | TransactionFilter
      | ((prev: TransactionFilter) => TransactionFilter)
  ) => void;
}

export const FilterForm: React.FC<FilterFormProps> = ({
  filter,
  accounts,
  categories,
  onFilterChange,
}) => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    {/* 1. Pencarian Kata Kunci */}
    <div className="space-y-1 sm:col-span-2">
      <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Pencarian Kata Kunci
      </label>
      <Input
        placeholder="Cari catatan / akun / kategori..."
        value={filter.search ?? ""}
        onChange={(e) =>
          onFilterChange((prev) => ({
            ...prev,
            search: e.target.value || null,
            offset: 0,
          }))
        }
      />
    </div>

    {/* 2. Filter Akun */}
    <div className="space-y-1.5">
      <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Filter Akun
      </label>
      <select
        value={filter.account_id ?? ""}
        onChange={(e) =>
          onFilterChange((prev) => ({
            ...prev,
            account_id: e.target.value || null,
            offset: 0,
          }))
        }
        className="flex h-10 w-full rounded-xl border border-border bg-black/[0.03] dark:bg-white/[0.06] px-3.5 py-2 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
      >
        <option value="">Semua Akun</option>
        {accounts
          .filter((a) => a.merged_into_id === null)
          .map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.name}
            </option>
          ))}
      </select>
    </div>

    {/* 3. Filter Kategori */}
    <div className="space-y-1.5">
      <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Filter Kategori
      </label>
      <select
        value={filter.category_id ?? ""}
        onChange={(e) =>
          onFilterChange((prev) => ({
            ...prev,
            category_id: e.target.value || null,
            offset: 0,
          }))
        }
        className="flex h-10 w-full rounded-xl border border-border bg-black/[0.03] dark:bg-white/[0.06] px-3.5 py-2 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
      >
        <option value="">Semua Kategori</option>
        {categories
          .filter((c) => c.merged_into_id === null)
          .map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name} ({cat.kind === "EXPENSE" ? "Pengeluaran" : "Pemasukan"})
            </option>
          ))}
      </select>
    </div>

    {/* 4. Tipe Transaksi */}
    <div className="space-y-1.5 sm:col-span-2">
      <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Jenis Transaksi
      </label>
      <select
        value={filter.tx_type ?? ""}
        onChange={(e) =>
          onFilterChange((prev) => ({
            ...prev,
            tx_type:
              (e.target.value as TransactionFilter["tx_type"]) || null,
            offset: 0,
          }))
        }
        className="flex h-10 w-full rounded-xl border border-border bg-black/[0.03] dark:bg-white/[0.06] px-3.5 py-2 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
      >
        <option value="">Semua Jenis Transaksi</option>
        <option value="EXPENSE">Pengeluaran</option>
        <option value="INCOME">Pemasukan</option>
        <option value="TRANSFER">Pindah Saldo Antar Rekening</option>
      </select>
    </div>

    {/* 5. Dari Tanggal */}
    <div className="space-y-1">
      <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Dari Tanggal
      </label>
      <Input
        type="date"
        value={filter.start_date ?? ""}
        onChange={(e) =>
          onFilterChange((prev) => ({
            ...prev,
            start_date: e.target.value || null,
            offset: 0,
          }))
        }
        className="font-mono tabular-nums tracking-tight"
      />
    </div>

    {/* 6. Sampai Tanggal */}
    <div className="space-y-1">
      <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Sampai Tanggal
      </label>
      <Input
        type="date"
        value={filter.end_date ?? ""}
        onChange={(e) =>
          onFilterChange((prev) => ({
            ...prev,
            end_date: e.target.value || null,
            offset: 0,
          }))
        }
        className="font-mono tabular-nums tracking-tight"
      />
    </div>

    {/* 7. Nominal Minimum */}
    <div className="space-y-1">
      <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Nominal Minimum
      </label>
      <CurrencyInput
        aria-label="Filter Nominal Minimum"
        placeholder="Rp Min"
        value={filter.min_amount ?? null}
        onValueChange={(val) =>
          onFilterChange((prev) => ({
            ...prev,
            min_amount: val,
            offset: 0,
          }))
        }
      />
    </div>

    {/* 8. Nominal Maksimum */}
    <div className="space-y-1">
      <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Nominal Maksimum
      </label>
      <CurrencyInput
        aria-label="Filter Nominal Maksimum"
        placeholder="Rp Maks"
        value={filter.max_amount ?? null}
        onValueChange={(val) =>
          onFilterChange((prev) => ({
            ...prev,
            max_amount: val,
            offset: 0,
          }))
        }
      />
    </div>
  </div>
);

