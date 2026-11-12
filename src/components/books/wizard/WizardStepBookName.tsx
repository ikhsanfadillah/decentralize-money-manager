import * as React from "react";
import { Input } from "../../ui/input";
import { BOOK_NAME_SUGGESTIONS } from "./wizard-presets";

export interface WizardStepBookNameProps {
  bookName: string;
  onBookNameChange: (name: string) => void;
  onEnterNext: () => void;
}

export const WizardStepBookName: React.FC<WizardStepBookNameProps> = ({
  bookName,
  onBookNameChange,
  onEnterNext,
}) => (
  <div className="space-y-4" data-testid="wizard-step-1">
    <div className="space-y-1.5">
      <label
        htmlFor="new-book-name"
        className="block text-xs font-medium text-foreground"
      >
        Nama Buku Keuangan
      </label>
      <Input
        id="new-book-name"
        value={bookName}
        onChange={(e) => onBookNameChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnterNext();
          }
        }}
        placeholder="Contoh: Uang Rumah Tangga, Tabungan, Usaha..."
        autoFocus
      />
    </div>

    {/* Quick Name Suggestions */}
    <div className="space-y-2">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Ide Nama Cepat
      </p>
      <div className="flex flex-wrap gap-1.5">
        {BOOK_NAME_SUGGESTIONS.map((suggestion) => {
          const isSelected = bookName.trim() === suggestion;
          return (
            <button
              key={suggestion}
              type="button"
              onClick={() => onBookNameChange(suggestion)}
              className={`nav-touch-item inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                isSelected
                  ? "border-zinc-900 bg-zinc-900 font-semibold text-white dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  : "border-border bg-white/80 text-muted-foreground hover:bg-muted hover:text-foreground dark:bg-white/[0.04]"
              }`}
            >
              <span>{suggestion}</span>
            </button>
          );
        })}
      </div>
    </div>

    {/* Setup Overview Card */}
    <div className="rounded-2xl border border-border/80 bg-black/[0.02] p-3.5 dark:bg-white/[0.04]">
      <p className="text-xs font-semibold text-foreground">
        Setup Cepat dalam 3 Langkah Berikutnya (Opsional)
      </p>
      <ul className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
        <li className="flex items-center gap-2">
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-900 font-mono text-[10px] font-bold text-white dark:bg-zinc-800 dark:text-white">
            1
          </span>
          <span>Pilih rekening bank, e-wallet, dan dompet tunai Anda</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-900 font-mono text-[10px] font-bold text-white dark:bg-zinc-800 dark:text-white">
            2
          </span>
          <span>Pilih kategori pengeluaran &amp; pemasukan sehari-hari</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-900 font-mono text-[10px] font-bold text-white dark:bg-zinc-800 dark:text-white">
            3
          </span>
          <span>Atur target anggaran bulanan dengan Smart Auto-Split</span>
        </li>
      </ul>
    </div>
  </div>
);

