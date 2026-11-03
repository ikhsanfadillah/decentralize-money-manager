import { describe, expect, it } from "vitest";
import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";
import {
  collectOpsSinceFrontier,
  computeLocalFrontier,
  mergeRemoteOplog,
  type CrdtOp,
} from "../crdt-merge";
import {
  FrameReassembler,
  encodeFramedChunks,
} from "../webrtc-transport";
import { WebSqliteEngine } from "../sqlite-engine";
import { HlcTimestamp, newUuidV7 } from "../../lib/web-core";

describe("Langkah 3: WebRTC Transport Framing & CRDT Sync Engine", () => {
  it("encodes payload into 32 KiB chunks and reassembles multi-chunk frames correctly", () => {
    const originalText = "X".repeat(100 * 1024); // 100 KiB payload
    const originalBytes = new TextEncoder().encode(originalText);

    const chunks = encodeFramedChunks(originalBytes);
    // 100 KiB + 4 bytes header / 32 KiB per chunk = 4 chunks
    expect(chunks.length).toBe(4);
    expect(chunks[0].length).toBe(32 * 1024);

    const reassembler = new FrameReassembler();
    let recoveredFrames: Uint8Array[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const frames = reassembler.feedChunk(chunks[i]);
      if (frames.length > 0) {
        recoveredFrames = recoveredFrames.concat(frames);
      }
    }

    expect(recoveredFrames.length).toBe(1);
    expect(recoveredFrames[0].length).toBe(originalBytes.length);
    const recoveredText = new TextDecoder().decode(recoveredFrames[0]);
    expect(recoveredText).toBe(originalText);
  });

  it("handles multiple back-to-back frames in a single streaming reassembly buffer", () => {
    const reassembler = new FrameReassembler();
    const frameA = new TextEncoder().encode("Hello-Frame-A");
    const frameB = new TextEncoder().encode("Hello-Frame-B");

    const chunksA = encodeFramedChunks(frameA);
    const chunksB = encodeFramedChunks(frameB);

    const combined = new Uint8Array(chunksA[0].length + chunksB[0].length);
    combined.set(chunksA[0], 0);
    combined.set(chunksB[0], chunksA[0].length);

    const extracted = reassembler.feedChunk(combined);
    expect(extracted.length).toBe(2);
    expect(new TextDecoder().decode(extracted[0])).toBe("Hello-Frame-A");
    expect(new TextDecoder().decode(extracted[1])).toBe("Hello-Frame-B");
  });

  it("merges remote CRDT oplog operations and applies Last-Write-Wins (LWW) rules", async () => {
    const sqlite3 = await sqlite3InitModule();
    const db = new sqlite3.oo1.DB(":memory:", "c") as unknown as Database;

    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        account_type TEXT NOT NULL,
        initial_balance INTEGER NOT NULL DEFAULT 0,
        merged_into_id TEXT,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        updated_hlc TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        merged_into_id TEXT,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        updated_hlc TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        to_account_id TEXT,
        category_id TEXT,
        amount INTEGER NOT NULL,
        tx_type TEXT NOT NULL,
        note TEXT,
        tx_date TEXT NOT NULL,
        created_by_device TEXT NOT NULL,
        link_id TEXT,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        updated_hlc TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS budgets (
        id TEXT PRIMARY KEY,
        category_id TEXT,
        period TEXT NOT NULL,
        amount_limit INTEGER NOT NULL,
        alert_threshold_pct INTEGER NOT NULL DEFAULT 80,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        updated_hlc TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS crdt_oplog (
        hlc_timestamp TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        row_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        device_id TEXT NOT NULL
      );
    `);

    const devA = "11112222";
    const devB = "33334444";

    const hlc1 = new HlcTimestamp(1_000_000, 0, devA).toString();
    const hlc2 = new HlcTimestamp(1_000_500, 0, devB).toString();
    const hlcOld = new HlcTimestamp(900_000, 0, devB).toString();

    const accId = newUuidV7();
    const op1: CrdtOp = {
      hlc_timestamp: hlc1,
      table_name: "accounts",
      row_id: accId,
      device_id: devA,
      payload_json: JSON.stringify({
        op: "upsert",
        row: {
          id: accId,
          name: "Bank BCA",
          account_type: "BANK",
          initial_balance: 500_000,
          merged_into_id: null,
          is_deleted: 0,
          updated_hlc: hlc1,
        },
      }),
    };

    const report1 = mergeRemoteOplog(db, [op1]);
    expect(report1.appliedCount).toBe(1);
    expect(report1.tables).toEqual(["accounts"]);

    // Verify account inserted
    const accRow = db.selectArray("SELECT name, initial_balance FROM accounts WHERE id = ?1", [
      accId,
    ]);
    expect(accRow).toEqual(["Bank BCA", 500_000]);

    // Apply newer update from Device B (LWW update)
    const op2: CrdtOp = {
      hlc_timestamp: hlc2,
      table_name: "accounts",
      row_id: accId,
      device_id: devB,
      payload_json: JSON.stringify({
        op: "upsert",
        row: {
          id: accId,
          name: "Bank BCA Rekening Utama",
          account_type: "BANK",
          initial_balance: 750_000,
          merged_into_id: null,
          is_deleted: 0,
          updated_hlc: hlc2,
        },
      }),
    };

    const report2 = mergeRemoteOplog(db, [op2]);
    expect(report2.appliedCount).toBe(1);

    const accRowUpdated = db.selectArray(
      "SELECT name, initial_balance FROM accounts WHERE id = ?1",
      [accId],
    );
    expect(accRowUpdated).toEqual(["Bank BCA Rekening Utama", 750_000]);

    // Apply older update from Device B (must be ignored by LWW)
    const opOld: CrdtOp = {
      hlc_timestamp: hlcOld,
      table_name: "accounts",
      row_id: accId,
      device_id: devB,
      payload_json: JSON.stringify({
        op: "upsert",
        row: {
          id: accId,
          name: "Nama Lama",
          account_type: "BANK",
          initial_balance: 100_000,
          merged_into_id: null,
          is_deleted: 0,
          updated_hlc: hlcOld,
        },
      }),
    };

    const reportOld = mergeRemoteOplog(db, [opOld]);
    expect(reportOld.appliedCount).toBe(0);

    const accRowStillLatest = db.selectArray(
      "SELECT name, initial_balance FROM accounts WHERE id = ?1",
      [accId],
    );
    expect(accRowStillLatest).toEqual(["Bank BCA Rekening Utama", 750_000]);

    // Verify frontiers
    const frontier = computeLocalFrontier(db);
    expect(frontier[devA]).toBe(hlc1);
    expect(frontier[devB]).toBe(hlc2);

    // Collect ops since older frontier
    const missingOps = collectOpsSinceFrontier(db, { [devA]: hlc1 });
    // Device A is up to date, but Device B ops should be returned
    expect(missingOps.length).toBe(2); // op2 and opOld
  });

  it("creates QR invites and joins book from invite through WebSqliteEngine", async () => {
    const engine = new WebSqliteEngine();
    await engine.init();

    const book = await engine.createBook("Kas Rumah Tangga", "PERSONAL");
    expect(book.name).toBe("Kas Rumah Tangga");

    // Create QR invite
    const invite = await engine.createInvite(book.id, 600);
    expect(invite.qr_json).toBeDefined();
    expect(invite.node_id).toBeDefined();

    const parsedInvite = JSON.parse(invite.qr_json) as {
      v: number;
      book_id: string;
      book_name: string;
      inviter_node_addr: { relay_url: string };
    };
    expect(parsedInvite.v).toBe(1);
    expect(parsedInvite.book_id).toBe(book.id);
    expect(parsedInvite.book_name).toBe("Kas Rumah Tangga");
    expect(parsedInvite.inviter_node_addr.relay_url).toContain("/ws/invite/inv-");

    // Another client joins from the QR code
    const engine2 = new WebSqliteEngine();
    await engine2.init();

    const joinedBook = await engine2.joinBookFromInvite(invite.qr_json, "PERSONAL");
    expect(joinedBook.id).toBe(book.id);
    expect(joinedBook.name).toBe("Kas Rumah Tangga");

    const status2 = await engine2.getSyncStatus(book.id);
    expect(status2.book_id).toBe(book.id);
    expect(status2.state).toBe("idle");
  });
});

