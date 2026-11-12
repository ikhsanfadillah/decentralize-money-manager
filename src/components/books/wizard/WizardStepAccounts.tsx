import * as React from "react";
import { Check, Plus } from "lucide-react";
import type { AccountType } from "../../../lib/tauri-api";
import { Input } from "../../ui/input";
import {
  ACCOUNT_GROUP_META,
  type PresetAccountOption,
} from "./wizard-presets";

export interface WizardStepAccountsProps {
  accountOptions: PresetAccountOption[];
  selectedAccountKeys: Set<string>;
  selectedCount: number;
  customAccountGroup: AccountType | null;
  customAccountName: string;
  onToggleAccountKey: (key: string) => void;
  onOpenCustomAccountGroup: (group: AccountType | null) => void;
  onCustomAccountNameChange: (name: string) => void;
  onAddCustomAccount: () => void;
}

export const WizardStepAccounts: React.FC<WizardStepAccountsProps> = ({
  accountOptions,
  selectedAccountKeys,
  selectedCount,
  customAccountGroup,
  customAccountName,
  onToggleAccountKey,
  onOpenCustomAccountGroup,
  onCustomAccountNameChange,
  onAddCustomAccount,
}) => (
  <div className="space-y-4" data-testid="wizard-step-2">
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-muted-foreground">
        Ketuk untuk memilih akun yang aktif dipakai
      </span>
      <span
        data-testid="selected-accounts-count"
        className="rounded-full border border-zinc-900 bg-zinc-900 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-white dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
      >
        {selectedCount} dipilih
      </span>
    </div>

    {ACCOUNT_GROUP_META.map((group) => {
      const GroupIcon = group.icon;
      const groupItems = accountOptions.filter(
        (a) => a.accountType === group.type
      );
      const isAddingCustomHere = customAccountGroup === group.type;

      return (
        <div key={group.type} className="space-y-2">
          <div className="flex items-center gap-1.5 px-0.5">
            <GroupIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.label}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {groupItems.map((item) => {
              const isSelected = selectedAccountKeys.has(item.key);
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={isSelected}
                  data-testid={`wizard-account-chip-${item.key}`}
                  onClick={() => onToggleAccountKey(item.key)}
                  className={`nav-touch-item flex items-center justify-between gap-2 rounded-2xl border px-3 py-2.5 text-left text-xs transition-all focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                    isSelected
                      ? "border-zinc-900 bg-zinc-900 font-semibold text-white dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                      : "border-border bg-white/80 text-muted-foreground hover:bg-muted/60 hover:text-foreground dark:bg-white/[0.04]"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                        isSelected
                          ? "border-white/15 bg-white/15 text-white"
                          : "border-border bg-black/[0.04] text-muted-foreground dark:bg-white/[0.06]"
                      }`}
                    >
                      <GroupIcon className="h-3.5 w-3.5" />
                    </div>
                    <span className="truncate">{item.name}</span>
                  </div>
                  <div
                    className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      isSelected
                        ? "border-white bg-white text-zinc-900"
                        : "border-border/80 bg-transparent"
                    }`}
                  >
                    {isSelected && (
                      <Check className="h-2.5 w-2.5 stroke-[3]" />
                    )}
                  </div>
                </button>
              );
            })}

            {/* "+ Kustom" trigger chip */}
            <button
              type="button"
              data-testid={`wizard-add-custom-account-${group.type}`}
              onClick={() =>
                onOpenCustomAccountGroup(
                  isAddingCustomHere ? null : group.type
                )
              }
              className="nav-touch-item flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border bg-transparent px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>+ Kustom</span>
            </button>
          </div>

          {isAddingCustomHere && (
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-black/[0.03] p-2 dark:bg-white/[0.05]">
              <Input
                value={customAccountName}
                onChange={(e) => onCustomAccountNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAddCustomAccount();
                  }
                }}
                placeholder={`Nama ${group.label} baru...`}
                aria-label={`Nama ${group.label} Kustom`}
                className="h-8 text-xs"
                autoFocus
              />
              <button
                type="button"
                onClick={onAddCustomAccount}
                className="nav-touch-item shrink-0 rounded-xl bg-cta-surface px-3 py-1.5 text-xs font-semibold text-cta-foreground hover:opacity-90"
              >
                Tambah
              </button>
            </div>
          )}
        </div>
      );
    })}
  </div>
);

