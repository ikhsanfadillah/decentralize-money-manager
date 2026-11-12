import type { Database } from "@sqlite.org/sqlite-wasm";
import { TauriCommandError } from "../../lib/tauri-api";
import { nowIso8601, randomHex } from "../../lib/web-core";

export function getOrCreateBookKeyInDb(db: Database): string {
  let key = db.selectValue(
    "SELECT value FROM meta WHERE key = 'book_key'"
  ) as string | undefined;

  if (!key || key.trim().length !== 64) {
    key = randomHex(32);
    db.exec({
      sql: `INSERT INTO meta (key, value) VALUES ('book_key', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      bind: [key],
    });
  }
  return key;
}

export function setPreferredHubInDb(
  db: Database,
  hubNodeId: string | null
): void {
  const cleanHub =
    hubNodeId && hubNodeId.trim() !== "" ? hubNodeId.trim() : null;
  if (cleanHub) {
    db.exec({
      sql: `INSERT INTO meta (key, value) VALUES ('preferred_hub_node_id', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      bind: [cleanHub],
    });
  } else {
    db.exec("DELETE FROM meta WHERE key = 'preferred_hub_node_id'");
  }
}

export function recordPeerSeenInDb(
  writeDb: Database,
  args: {
    nodeId: string;
    deviceId?: string | null;
    deviceName?: string | null;
  }
): void {
  writeDb.exec({
    sql: `INSERT INTO sync_peers (node_id, device_id, last_seen_at, device_name)
          VALUES (?1, ?2, ?3, ?4)
          ON CONFLICT(node_id) DO UPDATE SET
             device_id = COALESCE(excluded.device_id, sync_peers.device_id),
             last_seen_at = excluded.last_seen_at,
             device_name = COALESCE(excluded.device_name, sync_peers.device_name)`,
    bind: [
      args.nodeId,
      args.deviceId ?? null,
      nowIso8601(),
      args.deviceName ?? null,
    ],
  });
}

export function getSyncPeersInDb(db: Database): Array<{
  node_id: string;
  device_id: string | null;
  last_seen_at: string | null;
  device_name: string | null;
  custom_alias: string | null;
}> {
  const rows = db.selectArrays(
    "SELECT node_id, device_id, last_seen_at, device_name, custom_alias FROM sync_peers ORDER BY last_seen_at DESC"
  );
  return rows.map((r) => ({
    node_id: String(r[0]),
    device_id: r[1] !== null ? String(r[1]) : null,
    last_seen_at: r[2] !== null ? String(r[2]) : null,
    device_name: r[3] !== null ? String(r[3]) : null,
    custom_alias: r[4] !== null ? String(r[4]) : null,
  }));
}

export function getDeviceIdentityInDb(db: Database): {
  device_id: string;
  device_name: string;
} {
  const deviceId =
    (db.selectValue("SELECT value FROM meta WHERE key = 'device_id'") as string) ||
    "00000000";
  const deviceName =
    (db.selectValue(
      "SELECT value FROM meta WHERE key = 'device_name'"
    ) as string) || "Perangkat Ini";
  return { device_id: deviceId, device_name: deviceName };
}

export function setDeviceNameInDb(writeDb: Database, deviceName: string): void {
  const trimmed = deviceName.trim();
  if (!trimmed) {
    throw new TauriCommandError(
      "VALIDATION_ERROR",
      "Nama perangkat tidak boleh kosong"
    );
  }
  if (trimmed.length > 64) {
    throw new TauriCommandError(
      "VALIDATION_ERROR",
      "Nama perangkat maksimal 64 karakter"
    );
  }
  writeDb.exec({
    sql: `INSERT INTO meta (key, value) VALUES ('device_name', ?1)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    bind: [trimmed],
  });
}

export function setPeerCustomAliasInDb(
  writeDb: Database,
  nodeId: string,
  customAlias: string | null
): void {
  const trimmedNode = nodeId.trim();
  const sanitizedAlias = customAlias?.trim() ? customAlias.trim() : null;
  if (sanitizedAlias && sanitizedAlias.length > 64) {
    throw new TauriCommandError(
      "VALIDATION_ERROR",
      "Nama alias maksimal 64 karakter"
    );
  }
  writeDb.exec({
    sql: "UPDATE sync_peers SET custom_alias = ?1 WHERE node_id = ?2",
    bind: [sanitizedAlias, trimmedNode],
  });
}

