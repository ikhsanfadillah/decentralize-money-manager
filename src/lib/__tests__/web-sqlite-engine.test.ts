import { describe, expect, it } from "vitest";
import {
  DEFAULT_CASH_ACCOUNT_ID,
  HlcClock,
  deterministicBudgetId,
  normalizeCategoryName,
} from "../web-core";
import { WebSqliteEngine } from "../../web-worker/sqlite-engine";

describe("web-core & WebSqliteEngine (Langkah 1: Browser SQLite WASM)", () => {
  it("normalizes category names with Unicode NFKC and strips non-alphanumeric chars", () => {
    expect(normalizeCategoryName("  Makan & Minum! 🍜 ")).toBe("makanminum");
    expect(normalizeCategoryName("Kopi / Café")).toBe("kopicafé");
  });

  it("generates deterministic UUIDv5 budget IDs matching Rust APP_NAMESPACE", () => {
    const id1 = deterministicBudgetId(null, "MONTHLY");
    const id2 = deterministicBudgetId(null, "MONTHLY");
    const idCat = deterministicBudgetId("cat-123", "MONTHLY");

    expect(id1).toBe(id2);
    expect(id1).not.toBe(idCat);
    expect(id1).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("maintains strict HLC monotonicity and lexicographical order", () => {
    const clock = HlcClock.fromDeviceId("dev00001");
    const generated: string[] = [];

    for (let i = 0; i < 5; i++) {
      generated.push(clock.tick(1_700_000_000_000).toString());
    }
    for (let i = 0; i < 3; i++) {
      generated.push(clock.tick(1_699_999_999_500).toString());
    }
    for (let i = 1; i <= 3; i++) {
      generated.push(clock.tick(1_700_000_000_000 + i * 100).toString());
    }

    for (let i = 1; i < generated.length; i++) {
      expect(generated[i - 1] < generated[i]).toBe(true);
    }
  });

  it("executes full book, account, category, transaction, budget, cross-book transfer, report, and encrypted backup flows in SQLite WASM", async () => {
    const engine = new WebSqliteEngine();
    await engine.init();

    // 1. Create two books
    const personalBook = await engine.createBook("Dompet Pribadi", "PERSONAL");
    const businessBook = await engine.createBook("Toko Kopi", "BUSINESS");

    const books = await engine.listBooks();
    expect(books.length).toBe(2);

    // 2. Verify seeded default cash account
    const accounts = await engine.listAccounts(personalBook.id);
    expect(accounts.length).toBe(1);
    expect(accounts[0].id).toBe(DEFAULT_CASH_ACCOUNT_ID);
    expect(accounts[0].name).toBe("Kas Tunai");

    // 3. Create bank account & merge into another account
    const bankA = await engine.upsertAccount(personalBook.id, {
      name: "BCA Utama",
      account_type: "BANK",
      initial_balance: 5_000_000,
    });
    const bankOld = await engine.upsertAccount(personalBook.id, {
      name: "BCA Lama",
      account_type: "BANK",
      initial_balance: 1_000_000,
    });
    await engine.mergeAccounts(personalBook.id, bankOld.id, bankA.id);

    // 4. Create categories & verify auto-deduplication by normalized_name
    const catFood1 = await engine.upsertCategory(personalBook.id, {
      name: "Makan & Minum",
      kind: "EXPENSE",
    });
    const catFood2 = await engine.upsertCategory(personalBook.id, {
      name: "makan   minum!!",
      kind: "EXPENSE",
    });
    expect(catFood2.canonical_id).toBe(catFood1.canonical_id);

    const catSalary = await engine.upsertCategory(personalBook.id, {
      name: "Gaji Bulanan",
      kind: "INCOME",
    });

    // 5. Add transactions
    await engine.addTransaction(personalBook.id, {
      account_id: bankA.id,
      category_id: catSalary.id,
      amount: 10_000_000,
      tx_type: "INCOME",
      tx_date: "2026-10-05",
      note: "Gaji Oktober",
    });

    await engine.addTransaction(personalBook.id, {
      account_id: bankOld.id, // Merged into bankA!
      category_id: catFood2.id, // Deduplicated into catFood1!
      amount: -250_000,
      tx_type: "EXPENSE",
      tx_date: "2026-10-10",
      note: "Makan malam",
    });

    // 6. Verify balances (initial 5M + 1M + 10M income - 250k expense = 15,750,000)
    const balances = await engine.getAccountBalances(personalBook.id);
    const bcaBalance = balances.find((b) => b.account_id === bankA.id);
    expect(bcaBalance).toBeDefined();
    expect(bcaBalance?.initial_balance).toBe(6_000_000);
    expect(bcaBalance?.current_balance).toBe(15_750_000);
    expect(bcaBalance?.merged_member_ids).toContain(bankOld.id);

    // 7. Cross-book transfer (Personal -> Business)
    const transferRes = await engine.transferBetweenBooks({
      from_book_id: personalBook.id,
      from_account_id: bankA.id,
      to_book_id: businessBook.id,
      to_account_id: DEFAULT_CASH_ACCOUNT_ID,
      amount: 2_000_000,
      tx_date: "2026-10-12",
      note: "Suntik modal usaha",
    });
    expect(transferRes.expense_tx.amount).toBe(-2_000_000);
    expect(transferRes.income_tx.amount).toBe(2_000_000);

    // 8. Budgets: Total Pengeluaran should NOT count Prive/Penarikan cross-book transfer!
    await engine.upsertBudget(personalBook.id, {
      category_id: null,
      period: "MONTHLY",
      amount_limit: 5_000_000,
      alert_threshold_pct: 80,
    });
    const progress = await engine.getBudgetProgress(personalBook.id, "2026-10");
    expect(progress.length).toBe(1);
    expect(progress[0].spent).toBe(250_000);
    expect(progress[0].remaining).toBe(4_750_000);

    // 9. Monthly Report
    const report = await engine.getMonthlyReport(personalBook.id, "2026-10");
    expect(report.operational_income).toBe(10_000_000);
    expect(report.operational_expense).toBe(250_000);
    expect(report.capital_withdrawal).toBe(2_000_000);

    // 10. List Transactions
    const txPage = await engine.listTransactions(personalBook.id, {
      limit: 25,
      offset: 0,
      sort_by: "tx_date",
      sort_dir: "desc",
    });
    expect(txPage.total).toBe(3);
    expect(txPage.items.length).toBe(3);
    expect(txPage.items[0].note).toBe("Suntik modal usaha");

    // 10. Encrypted Backup Export & Restore
    const encryptedBytes = await engine.exportBookEncryptedBytes(
      personalBook.id,
      "passphrase-aman-123"
    );
    expect(encryptedBytes.byteLength).toBeGreaterThan(100);

    await engine.deleteBook(personalBook.id);
    const booksAfterDelete = await engine.listBooks();
    expect(booksAfterDelete.length).toBe(1);

    const restoredMeta = await engine.importBookEncryptedBytes(
      encryptedBytes,
      "passphrase-aman-123"
    );
    expect(restoredMeta.id).toBe(personalBook.id);
    expect(restoredMeta.name).toBe("Dompet Pribadi");

    const restoredBalances = await engine.getAccountBalances(personalBook.id);
    const restoredBca = restoredBalances.find((b) => b.account_id === bankA.id);
    expect(restoredBca?.current_balance).toBe(13_750_000);
  });
});

