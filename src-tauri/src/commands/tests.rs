    use super::*;
    use crate::crdt::{merge_remote_oplog, BudgetRow, CrdtEnvelope, CrdtOp};
    use crate::db::{
        deterministic_budget_id, open_in_memory_book, SYSTEM_CATEGORY_PRIVE_ID,
        SYSTEM_CATEGORY_PRIVE_NAME,
    };
    use rusqlite::params;

    #[test]
    fn test_device_labeling_and_peer_alias() {
        let conn =
            open_in_memory_book("00000000-0000-7000-8000-000000000200", "DeviceTestBook").unwrap();

        // 1. Verify default device_name in meta
        let initial_name: String = conn
            .query_row("SELECT value FROM meta WHERE key = 'device_name'", [], |r| r.get(0))
            .unwrap();
        assert!(!initial_name.is_empty());

        // 2. Update device_name in meta
        conn.execute(
            "INSERT INTO meta (key, value) VALUES ('device_name', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params!["Laptop Kantor Budi"],
        )
        .unwrap();
        let updated_name: String = conn
            .query_row("SELECT value FROM meta WHERE key = 'device_name'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(updated_name, "Laptop Kantor Budi");

        // 3. Insert a peer with broadcasted device_name
        let ticket = crate::sync::transport::NodeTicketAddr {
            node_id: "node_peer_123".into(),
            relay_url: None,
            direct_addrs: vec![],
        };
        crate::sync::protocol::upsert_peer_ticket(
            &conn,
            &ticket,
            Some("dev_05817910"),
            Some("HP Xiaomi Toko"),
            Some("2026-11-03T10:00:00Z"),
        )
        .unwrap();

        let (dev_name, alias): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT device_name, custom_alias FROM sync_peers WHERE node_id = 'node_peer_123'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(dev_name.as_deref(), Some("HP Xiaomi Toko"));
        assert_eq!(alias, None);

        // 4. Update custom_alias
        conn.execute(
            "UPDATE sync_peers SET custom_alias = ?1 WHERE node_id = ?2",
            params!["Mas Budi HP", "node_peer_123"],
        )
        .unwrap();

        let alias2: Option<String> = conn
            .query_row(
                "SELECT custom_alias FROM sync_peers WHERE node_id = 'node_peer_123'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(alias2.as_deref(), Some("Mas Budi HP"));
    }

    #[test]
    fn test_add_transaction_atomicity_on_failure() {
        let mut conn =
            open_in_memory_book("00000000-0000-7000-8000-000000000100", "AtomicBook").unwrap();

        // Trigger on crdt_oplog that aborts when note == 'SIMULATE_OPLOG_FAILURE'
        conn.execute_batch(
            "CREATE TRIGGER abort_on_simulated_failure
             BEFORE INSERT ON crdt_oplog
             WHEN NEW.payload_json LIKE '%SIMULATE_OPLOG_FAILURE%'
             BEGIN
                 SELECT RAISE(ABORT, 'simulated oplog failure');
             END;",
        )
        .unwrap();

        let res = add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: Some("018f0000-0000-7000-8000-000000000999".into()),
                account_id: "00000000-0000-7000-8000-000000000001".into(),
                to_account_id: None,
                category_id: Some("cat-1".into()),
                amount: -50_000,
                tx_type: "EXPENSE".into(),
                note: Some("SIMULATE_OPLOG_FAILURE".into()),
                tx_date: "2026-04-01".into(),
                link_id: None,
            },
        );
        assert!(res.is_err());

        let tx_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0))
            .unwrap();
        let op_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM crdt_oplog WHERE table_name = 'transactions'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tx_count, 0, "No orphan transaction row may remain");
        assert_eq!(op_count, 0, "No oplog entry may remain");
    }

    #[test]
    fn test_get_account_balances_merged_transfers_deleted_and_large_values() {
        let mut conn =
            open_in_memory_book("00000000-0000-7000-8000-000000000100", "BalanceBook").unwrap();

        let acc_root = upsert_account_in_conn(
            &mut conn,
            UpsertAccountInput {
                id: Some("acc-root".into()),
                name: "BCA Utama".into(),
                account_type: "BANK".into(),
                initial_balance: 100_000_000_000_000, // 100 Trillion
            },
        )
        .unwrap();

        let acc_child = upsert_account_in_conn(
            &mut conn,
            UpsertAccountInput {
                id: Some("acc-child".into()),
                name: "BCA Lama".into(),
                account_type: "BANK".into(),
                initial_balance: 50_000_000_000_000, // 50 Trillion
            },
        )
        .unwrap();

        let acc_wallet = upsert_account_in_conn(
            &mut conn,
            UpsertAccountInput {
                id: Some("acc-wallet".into()),
                name: "GoPay".into(),
                account_type: "EWALLET".into(),
                initial_balance: 1_000_000,
            },
        )
        .unwrap();

        // Merge acc_child into acc_root
        merge_accounts_in_conn(&mut conn, &acc_child.id, &acc_root.id).unwrap();

        // Income on merged child account (should credit acc-root)
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc_child.id.clone(),
                to_account_id: None,
                category_id: Some("cat-inc".into()),
                amount: 10_000_000_000_000, // +10 Trillion
                tx_type: "INCOME".into(),
                note: None,
                tx_date: "2026-05-01".into(),
                link_id: None,
            },
        )
        .unwrap();

        // Expense on acc_root
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc_root.id.clone(),
                to_account_id: None,
                category_id: Some("cat-exp".into()),
                amount: -5_000_000,
                tx_type: "EXPENSE".into(),
                note: None,
                tx_date: "2026-05-02".into(),
                link_id: None,
            },
        )
        .unwrap();

        // Transfer from acc_child (merged into acc_root) to acc_wallet
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc_child.id.clone(),
                to_account_id: Some(acc_wallet.id.clone()),
                category_id: None,
                amount: 2_000_000,
                tx_type: "TRANSFER".into(),
                note: None,
                tx_date: "2026-05-03".into(),
                link_id: None,
            },
        )
        .unwrap();

        // Deleted transaction (must be ignored)
        let del_tx = add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc_wallet.id.clone(),
                to_account_id: None,
                category_id: Some("cat-exp".into()),
                amount: -999_999,
                tx_type: "EXPENSE".into(),
                note: None,
                tx_date: "2026-05-04".into(),
                link_id: None,
            },
        )
        .unwrap();
        delete_transaction_in_conn(&mut conn, &del_tx.id).unwrap();

        let balances = get_account_balances_in_conn(&conn).unwrap();
        assert_eq!(balances.len(), 2);

        let bca = balances
            .iter()
            .find(|b| b.account_id == "acc-root")
            .unwrap();
        assert_eq!(bca.initial_balance, 150_000_000_000_000);
        // 150T + 10T - 5M - 2M = 159_999_993_000_000
        assert_eq!(bca.current_balance, 159_999_993_000_000);
        assert_eq!(bca.merged_member_ids, vec!["acc-child".to_string()]);

        let gopay = balances
            .iter()
            .find(|b| b.account_id == "acc-wallet")
            .unwrap();
        assert_eq!(gopay.current_balance, 3_000_000);
    }

    #[test]
    fn test_get_budget_progress_comprehensive() {
        let mut conn =
            open_in_memory_book("00000000-0000-7000-8000-000000000100", "BudgetBook").unwrap();

        let acc = upsert_account_in_conn(
            &mut conn,
            UpsertAccountInput {
                id: Some("acc-1".into()),
                name: "Cash".into(),
                account_type: "CASH".into(),
                initial_balance: 100_000_000,
            },
        )
        .unwrap();
        let acc2 = upsert_account_in_conn(
            &mut conn,
            UpsertAccountInput {
                id: Some("acc-2".into()),
                name: "Bank".into(),
                account_type: "BANK".into(),
                initial_balance: 100_000_000,
            },
        )
        .unwrap();

        // Two duplicate categories ("Makan" & "makan!") that auto-merge into cat_makan_1
        let cat_makan_1 = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("018f0000-0000-7000-8000-000000000001".into()),
                name: "Makan".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();
        let cat_makan_2 = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("018f0000-0000-7000-8000-000000000002".into()),
                name: "makan!".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();
        assert_eq!(cat_makan_2.canonical_id, cat_makan_1.id);

        // Categories for threshold tests: 79% (OK), 80% (WARNING), 100% (WARNING), 101% (OVER), and huge limit
        let cat_79 = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-79".into()),
                name: "Cat79".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();
        let cat_80 = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-80".into()),
                name: "Cat80".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();
        let cat_100 = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-100".into()),
                name: "Cat100".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();
        let cat_101 = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-101".into()),
                name: "Cat101".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();
        let cat_huge = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-huge".into()),
                name: "CatHuge".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();

        // System Prive category (must be excluded from total budget!)
        let cat_prive = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some(SYSTEM_CATEGORY_PRIVE_ID.into()),
                name: SYSTEM_CATEGORY_PRIVE_NAME.into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();

        // Create budgets
        upsert_budget_in_conn(
            &mut conn,
            UpsertBudgetInput {
                category_id: Some(cat_makan_1.id.clone()),
                period: Some("MONTHLY".into()),
                amount_limit: 1_000_000,
                alert_threshold_pct: Some(80),
            },
        )
        .unwrap();
        upsert_budget_in_conn(
            &mut conn,
            UpsertBudgetInput {
                category_id: Some(cat_79.id.clone()),
                period: Some("MONTHLY".into()),
                amount_limit: 1_000,
                alert_threshold_pct: Some(80),
            },
        )
        .unwrap();
        upsert_budget_in_conn(
            &mut conn,
            UpsertBudgetInput {
                category_id: Some(cat_80.id.clone()),
                period: Some("MONTHLY".into()),
                amount_limit: 1_000,
                alert_threshold_pct: Some(80),
            },
        )
        .unwrap();
        upsert_budget_in_conn(
            &mut conn,
            UpsertBudgetInput {
                category_id: Some(cat_100.id.clone()),
                period: Some("MONTHLY".into()),
                amount_limit: 1_000,
                alert_threshold_pct: Some(80),
            },
        )
        .unwrap();
        upsert_budget_in_conn(
            &mut conn,
            UpsertBudgetInput {
                category_id: Some(cat_101.id.clone()),
                period: Some("MONTHLY".into()),
                amount_limit: 1_000,
                alert_threshold_pct: Some(80),
            },
        )
        .unwrap();
        upsert_budget_in_conn(
            &mut conn,
            UpsertBudgetInput {
                category_id: Some(cat_huge.id.clone()),
                period: Some("MONTHLY".into()),
                amount_limit: 500_000_000_000_000, // 500 Trillion
                alert_threshold_pct: Some(80),
            },
        )
        .unwrap();
        // Total budget (category_id = None)
        upsert_budget_in_conn(
            &mut conn,
            UpsertBudgetInput {
                category_id: None,
                period: Some("MONTHLY".into()),
                amount_limit: 10_000_000,
                alert_threshold_pct: Some(80),
            },
        )
        .unwrap();

        // Transactions in Jan 2026 vs Feb 2026
        // 1. Jan 31 on cat_makan_1 (300k) and cat_makan_2 (200k) -> both resolve to cat_makan_1 = 500k
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc.id.clone(),
                to_account_id: None,
                category_id: Some(cat_makan_1.id.clone()),
                amount: -300_000,
                tx_type: "EXPENSE".into(),
                note: None,
                tx_date: "2026-01-31".into(),
                link_id: None,
            },
        )
        .unwrap();
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc.id.clone(),
                to_account_id: None,
                category_id: Some(cat_makan_2.id.clone()),
                amount: -200_000,
                tx_type: "EXPENSE".into(),
                note: None,
                tx_date: "2026-01-31".into(),
                link_id: None,
            },
        )
        .unwrap();
        // Feb 01 transaction on cat_makan_1 (must NOT count in Jan 2026)
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc.id.clone(),
                to_account_id: None,
                category_id: Some(cat_makan_1.id.clone()),
                amount: -400_000,
                tx_type: "EXPENSE".into(),
                note: None,
                tx_date: "2026-02-01".into(),
                link_id: None,
            },
        )
        .unwrap();

        // TRANSFER and INCOME in Jan 2026 (must NOT count in budgets)
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc.id.clone(),
                to_account_id: Some(acc2.id.clone()),
                category_id: None,
                amount: 900_000,
                tx_type: "TRANSFER".into(),
                note: None,
                tx_date: "2026-01-15".into(),
                link_id: None,
            },
        )
        .unwrap();
        let cat_inc = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-inc".into()),
                name: "Gaji".into(),
                kind: "INCOME".into(),
            },
        )
        .unwrap();
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc.id.clone(),
                to_account_id: None,
                category_id: Some(cat_inc.id),
                amount: 5_000_000,
                tx_type: "INCOME".into(),
                note: None,
                tx_date: "2026-01-15".into(),
                link_id: None,
            },
        )
        .unwrap();

        // System Prive expense in Jan 2026 (must NOT count in total budget!)
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc.id.clone(),
                to_account_id: None,
                category_id: Some(cat_prive.id),
                amount: -2_000_000,
                tx_type: "EXPENSE".into(),
                note: None,
                tx_date: "2026-01-20".into(),
                link_id: None,
            },
        )
        .unwrap();

        // Deleted expense in Jan 2026 (must NOT count)
        let del = add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc.id.clone(),
                to_account_id: None,
                category_id: Some(cat_makan_1.id.clone()),
                amount: -100_000,
                tx_type: "EXPENSE".into(),
                note: None,
                tx_date: "2026-01-10".into(),
                link_id: None,
            },
        )
        .unwrap();
        delete_transaction_in_conn(&mut conn, &del.id).unwrap();

        // Exact thresholds: 790/1000 (79%), 800/1000 (80%), 1000/1000 (100%), 1010/1000 (101%)
        for (cat_id, amt) in [
            (&cat_79.id, -790),
            (&cat_80.id, -800),
            (&cat_100.id, -1000),
            (&cat_101.id, -1010),
            (&cat_huge.id, -250_000_000_000_000),
        ] {
            add_transaction_in_conn(
                &mut conn,
                AddTransactionInput {
                    id: None,
                    account_id: acc.id.clone(),
                    to_account_id: None,
                    category_id: Some(cat_id.clone()),
                    amount: amt,
                    tx_type: "EXPENSE".into(),
                    note: None,
                    tx_date: "2026-01-12".into(),
                    link_id: None,
                },
            )
            .unwrap();
        }

        let progress = get_budget_progress_in_conn(&conn, "2026-01").unwrap();

        // Verify sorted descending by pct
        for pair in progress.windows(2) {
            assert!(pair[0].pct >= pair[1].pct);
        }

        let p_101 = progress
            .iter()
            .find(|p| p.category_id.as_deref() == Some("cat-101"))
            .unwrap();
        assert_eq!(p_101.pct, 101);
        assert_eq!(p_101.status, "OVER");
        assert_eq!(p_101.remaining, -10);

        let p_100 = progress
            .iter()
            .find(|p| p.category_id.as_deref() == Some("cat-100"))
            .unwrap();
        assert_eq!(p_100.pct, 100);
        assert_eq!(p_100.status, "WARNING");
        assert_eq!(p_100.remaining, 0);

        let p_80 = progress
            .iter()
            .find(|p| p.category_id.as_deref() == Some("cat-80"))
            .unwrap();
        assert_eq!(p_80.pct, 80);
        assert_eq!(p_80.status, "WARNING");

        let p_79 = progress
            .iter()
            .find(|p| p.category_id.as_deref() == Some("cat-79"))
            .unwrap();
        assert_eq!(p_79.pct, 79);
        assert_eq!(p_79.status, "OK");

        let p_makan = progress
            .iter()
            .find(|p| p.category_id.as_deref() == Some(cat_makan_1.id.as_str()))
            .unwrap();
        assert_eq!(p_makan.spent, 500_000);
        assert_eq!(p_makan.pct, 50);
        assert_eq!(p_makan.status, "OK");

        let p_huge = progress
            .iter()
            .find(|p| p.category_id.as_deref() == Some("cat-huge"))
            .unwrap();
        assert_eq!(p_huge.pct, 50);
        assert_eq!(p_huge.status, "OK");
    }

    #[test]
    fn test_budget_crdt_lww_and_merged_category_dedupe() {
        let mut conn =
            open_in_memory_book("00000000-0000-7000-8000-000000000100", "BudgetCrdt").unwrap();

        // 1. Two devices create budget for the exact same category + period concurrently -> same UUIDv5, LWW wins
        let budget_id = deterministic_budget_id(None, "MONTHLY");
        let b_dev1 = BudgetRow {
            id: budget_id.clone(),
            category_id: None,
            period: "MONTHLY".into(),
            amount_limit: 3_000_000,
            alert_threshold_pct: 80,
            is_deleted: 0,
            updated_hlc: "0000001000000-00001-aaaa1111".into(),
        };
        let b_dev2 = BudgetRow {
            id: budget_id.clone(),
            category_id: None,
            period: "MONTHLY".into(),
            amount_limit: 5_000_000,
            alert_threshold_pct: 85,
            is_deleted: 0,
            updated_hlc: "0000001000005-00001-bbbb2222".into(),
        };

        let op1 = CrdtOp {
            hlc_timestamp: b_dev1.updated_hlc.clone(),
            table_name: "budgets".into(),
            row_id: budget_id.clone(),
            payload_json: serde_json::to_string(&CrdtEnvelope {
                op: "upsert".into(),
                row: b_dev1,
            })
            .unwrap(),
            device_id: "aaaa1111".into(),
        };
        let op2 = CrdtOp {
            hlc_timestamp: b_dev2.updated_hlc.clone(),
            table_name: "budgets".into(),
            row_id: budget_id.clone(),
            payload_json: serde_json::to_string(&CrdtEnvelope {
                op: "upsert".into(),
                row: b_dev2,
            })
            .unwrap(),
            device_id: "bbbb2222".into(),
        };

        merge_remote_oplog(&mut conn, &[op2, op1], 2_000_000).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM budgets WHERE id = ?1", params![budget_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);

        let budgets = list_budgets_in_conn(&conn).unwrap();
        assert_eq!(budgets.len(), 1);
        assert_eq!(budgets[0].amount_limit, 5_000_000);
        assert_eq!(budgets[0].alert_threshold_pct, 85);

        // 2. Two categories ("Transport" and "transport") created on different devices, each with its own budget
        let c1 = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-trans-1".into()),
                name: "Transport".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();
        let c2 = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-trans-2".into()),
                name: "transport!".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();

        upsert_budget_in_conn(
            &mut conn,
            UpsertBudgetInput {
                category_id: Some(c1.id.clone()),
                period: Some("MONTHLY".into()),
                amount_limit: 400_000,
                alert_threshold_pct: Some(80),
            },
        )
        .unwrap();
        // Second budget created later for c2 (which auto-merged into c1) -> higher updated_hlc
        upsert_budget_in_conn(
            &mut conn,
            UpsertBudgetInput {
                category_id: Some(c2.id.clone()),
                period: Some("MONTHLY".into()),
                amount_limit: 750_000,
                alert_threshold_pct: Some(90),
            },
        )
        .unwrap();

        let active_budgets = list_budgets_in_conn(&conn).unwrap();
        // Should only return 2 budgets total: 1 for ALL, and 1 resolved for c1 (with 750_000 from higher HLC)
        assert_eq!(active_budgets.len(), 2);
        let trans_budget = active_budgets
            .iter()
            .find(|b| b.category_id.as_deref() == Some("cat-trans-1"))
            .unwrap();
        assert_eq!(trans_budget.amount_limit, 750_000);
        assert_eq!(trans_budget.alert_threshold_pct, 90);
    }

    #[test]
    fn test_get_monthly_report_comprehensive() {
        let mut conn =
            open_in_memory_book("00000000-0000-7000-8000-000000000105", "MonthlyReportBook")
                .unwrap();

        let acc_bca = upsert_account_in_conn(
            &mut conn,
            UpsertAccountInput {
                id: Some("acc-bca".into()),
                name: "BCA Utama".into(),
                account_type: "BANK".into(),
                initial_balance: 5_000_000,
            },
        )
        .unwrap();

        let acc_cash = upsert_account_in_conn(
            &mut conn,
            UpsertAccountInput {
                id: Some("acc-cash".into()),
                name: "Kas Tunai".into(),
                account_type: "CASH".into(),
                initial_balance: 500_000,
            },
        )
        .unwrap();

        let cat_gaji = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-gaji".into()),
                name: "Gaji Bulanan".into(),
                kind: "INCOME".into(),
            },
        )
        .unwrap();

        let cat_makan = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-makan".into()),
                name: "Makan & Minum".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();

        // Previous month (2026-09) expense: 400_000
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc_bca.id.clone(),
                to_account_id: None,
                category_id: Some(cat_makan.id.clone()),
                amount: -400_000,
                tx_type: "EXPENSE".into(),
                note: Some("Makan Sept".into()),
                tx_date: "2026-09-15".into(),
                link_id: None,
            },
        )
        .unwrap();

        // Current month (2026-10) income: 10_000_000 on 2026-10-01
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc_bca.id.clone(),
                to_account_id: None,
                category_id: Some(cat_gaji.id.clone()),
                amount: 10_000_000,
                tx_type: "INCOME".into(),
                note: Some("Gaji Okt".into()),
                tx_date: "2026-10-01".into(),
                link_id: None,
            },
        )
        .unwrap();

        // Current month (2026-10) expense: 600_000 on 2026-10-05 (+50% vs Sept)
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc_bca.id.clone(),
                to_account_id: None,
                category_id: Some(cat_makan.id.clone()),
                amount: -600_000,
                tx_type: "EXPENSE".into(),
                note: Some("Restoran Keluarga".into()),
                tx_date: "2026-10-05".into(),
                link_id: None,
            },
        )
        .unwrap();

        // Internal transfer BCA -> Cash: 200_000 on 2026-10-10
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc_bca.id.clone(),
                to_account_id: Some(acc_cash.id.clone()),
                category_id: None,
                amount: 200_000,
                tx_type: "TRANSFER".into(),
                note: Some("Tarik Tunai ATM".into()),
                tx_date: "2026-10-10".into(),
                link_id: None,
            },
        )
        .unwrap();

        let report = get_monthly_report_in_conn(&conn, "2026-10").unwrap();
        assert_eq!(report.month, "2026-10");
        assert_eq!(report.prev_month, "2026-09");
        assert_eq!(report.days_in_month, 31);
        assert_eq!(report.operational_income, 10_000_000);
        assert_eq!(report.operational_expense, 600_000);
        assert_eq!(report.operational_net, 9_400_000);
        assert_eq!(report.prev_operational_expense, 400_000);
        assert_eq!(report.savings_rate_bps, 9400); // 94.00%

        // Check MoM category delta
        let makan_item = report
            .category_breakdown
            .iter()
            .find(|c| c.category_id == cat_makan.id)
            .unwrap();
        assert_eq!(makan_item.current_amount, 600_000);
        assert_eq!(makan_item.prev_amount, 400_000);
        assert_eq!(makan_item.delta_amount, 200_000);
        assert_eq!(makan_item.delta_pct, Some(50));

        // Check Account Reconciliation for BCA Utama:
        // Opening (before Oct 1) = 5_000_000 - 400_000 = 4_600_000
        // Oct Inflow = 10_000_000, Oct Outflow = 600_000 (expense) + 200_000 (transfer out) = 800_000
        // Closing = 4_600_000 + 9_200_000 = 13_800_000
        let bca_recon = report
            .account_reconciliation
            .iter()
            .find(|a| a.account_id == acc_bca.id)
            .unwrap();
        assert_eq!(bca_recon.opening_balance, 4_600_000);
        assert_eq!(bca_recon.month_inflow, 10_000_000);
        assert_eq!(bca_recon.month_outflow, 800_000);
        assert_eq!(bca_recon.closing_balance, 13_800_000);
    }

    #[test]
    fn test_get_monthly_report_top_expenses_descending_order() {
        let mut conn =
            open_in_memory_book("00000000-0000-7000-8000-000000000100", "TopExpensesBook").unwrap();

        let acc = upsert_account_in_conn(
            &mut conn,
            UpsertAccountInput {
                id: Some("acc-1".into()),
                name: "Dompet".into(),
                account_type: "CASH".into(),
                initial_balance: 10_000_000,
            },
        )
        .unwrap();

        let cat = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-1".into()),
                name: "Kebutuhan".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();

        // Add 7 expenses with varying amounts
        let expenses = vec![
            (-2_222, "Snack Ringan"),
            (-7_000, "Air Mineral"),
            (-10_000, "Kopi"),
            (-16_000, "Makan Siang"),
            (-25_000, "Transport"),
            (-190_000, "Hiburan"),
            (-200_000, "Tagihan Listrik"),
        ];

        for (amt, note) in expenses {
            add_transaction_in_conn(
                &mut conn,
                AddTransactionInput {
                    id: None,
                    account_id: acc.id.clone(),
                    to_account_id: None,
                    category_id: Some(cat.id.clone()),
                    amount: amt,
                    tx_type: "EXPENSE".into(),
                    note: Some(note.into()),
                    tx_date: "2026-10-15".into(),
                    link_id: None,
                },
            )
            .unwrap();
        }

        let report = get_monthly_report_in_conn(&conn, "2026-10").unwrap();

        // top_expenses must be limited to 5 and sorted DESCENDING by magnitude:
        // 1. 200.000 (Tagihan Listrik)
        // 2. 190.000 (Hiburan)
        // 3. 25.000 (Transport)
        // 4. 16.000 (Makan Siang)
        // 5. 10.000 (Kopi)
        // (7.000 and 2.222 should be excluded because they are lower than the top 5)
        assert_eq!(report.top_expenses.len(), 5);
        assert_eq!(report.top_expenses[0].amount, -200_000);
        assert_eq!(
            report.top_expenses[0].note.as_deref(),
            Some("Tagihan Listrik")
        );
        assert_eq!(report.top_expenses[1].amount, -190_000);
        assert_eq!(report.top_expenses[1].note.as_deref(), Some("Hiburan"));
        assert_eq!(report.top_expenses[2].amount, -25_000);
        assert_eq!(report.top_expenses[3].amount, -16_000);
        assert_eq!(report.top_expenses[4].amount, -10_000);
    }

