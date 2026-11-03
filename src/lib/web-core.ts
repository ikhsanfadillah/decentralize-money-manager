import { TauriCommandError } from "./tauri-api";

export const SCHEMA_VERSION = 1;

export const APP_NAMESPACE_BYTES = new Uint8Array([
  0x6d, 0x6f, 0x6e, 0x65, 0x79, 0x2d, 0x6d, 0x67, 0x72, 0x2d, 0x76, 0x31, 0x2d,
  0x70, 0x32, 0x70,
]);

export const DEFAULT_CASH_ACCOUNT_ID = "00000000-0000-7000-8000-000000000001";
export const SYSTEM_CATEGORY_PRIVE_ID = "00000000-0000-7000-8000-000000000010";
export const SYSTEM_CATEGORY_PRIVE_NAME = "Prive/Penarikan";
export const SYSTEM_CATEGORY_MODAL_ID = "00000000-0000-7000-8000-000000000011";
export const SYSTEM_CATEGORY_MODAL_NAME = "Bagi Hasil/Injeksi Modal";

export const MAX_WALL_MS = 9_999_999_999_999;
export const MAX_COUNTER = 99_999;
export const MAX_DRIFT_MS = 24 * 60 * 60 * 1_000;
export const MAX_REMOTE_BATCH_OPS = 500;

export const ACCOUNT_ROOTS_CTE_SQL = `
WITH RECURSIVE walk(start_id, curr_id, next_id, depth, path) AS (
    SELECT id, id, merged_into_id, 0, ',' || id || ','
    FROM accounts
    UNION ALL
    SELECT w.start_id, a.id, a.merged_into_id, w.depth + 1, w.path || a.id || ','
    FROM walk w
    JOIN accounts a ON a.id = w.next_id
    WHERE w.depth < 16
      AND instr(w.path, ',' || w.next_id || ',') = 0
),
terminal AS (
    SELECT w.start_id, w.curr_id, w.next_id, w.depth AS max_depth, w.path
    FROM walk w
    WHERE w.depth = (SELECT MAX(w2.depth) FROM walk w2 WHERE w2.start_id = w.start_id)
),
cycle_entry AS (
    SELECT t.start_id,
           t.curr_id AS term_curr_id,
           w_cycle.depth AS cycle_start_depth
    FROM terminal t
    LEFT JOIN walk w_cycle
      ON w_cycle.start_id = t.start_id
     AND w_cycle.curr_id = t.next_id
),
account_roots AS (
    SELECT ce.start_id AS account_id,
           CASE
               WHEN ce.cycle_start_depth IS NOT NULL THEN (
                   SELECT MIN(w3.curr_id)
                   FROM walk w3
                   WHERE w3.start_id = ce.start_id
                     AND w3.depth >= ce.cycle_start_depth
               )
               ELSE ce.term_curr_id
           END AS root_id
    FROM cycle_entry ce
)`;

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function randomHex(bytesLen: number): string {
  const bytes = new Uint8Array(bytesLen);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function sha256Hex(textOrBytes: string | Uint8Array): Promise<string> {
  const bytes =
    typeof textOrBytes === "string" ? new TextEncoder().encode(textOrBytes) : textOrBytes;
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return bytesToHex(new Uint8Array(hashBuf));
}

function formatUuidBytes(b: Uint8Array): string {
  const hex = bytesToHex(b);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Generates an RFC 9562 UUIDv7 matching `Uuid::now_v7()` in Rust.
 */
export function newUuidV7(nowMs: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const ts = BigInt(Math.max(0, Math.floor(nowMs)));
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);

  // Version 7 (0111)
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Variant RFC 4122 / 9562 (10xx)
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return formatUuidBytes(bytes);
}

/**
 * Synchronous SHA-1 implementation for RFC 4122 UUIDv5 generation.
 */
function sha1Bytes(message: Uint8Array): Uint8Array {
  const ml = message.length * 8;
  const padLen = ((message.length + 8) >> 6) * 64 + 64;
  const padded = new Uint8Array(padLen);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 8, Math.floor(ml / 0x100000000), false);
  view.setUint32(padLen - 4, ml >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Uint32Array(80);
  const rotl = (n: number, b: number) => ((n << b) | (n >>> (32 - b))) >>> 0;

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f = 0;
      let k = 0;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  return out;
}

/**
 * Computes deterministic budget UUIDv5 identical to `db::deterministic_budget_id` in Rust.
 */
export function deterministicBudgetId(
  categoryId: string | null | undefined,
  period: string
): string {
  const catPart = categoryId && categoryId.trim() !== "" ? categoryId : "ALL";
  const nameBytes = new TextEncoder().encode(`${catPart}:${period}`);
  const combined = new Uint8Array(APP_NAMESPACE_BYTES.length + nameBytes.length);
  combined.set(APP_NAMESPACE_BYTES, 0);
  combined.set(nameBytes, APP_NAMESPACE_BYTES.length);

  const hash = sha1Bytes(combined);
  const uuidBytes = hash.slice(0, 16);
  // Set version 5 (0101)
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x50;
  // Set RFC 4122 variant (10xx)
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;

  return formatUuidBytes(uuidBytes);
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateBookId(bookId: string): string {
  const trimmed = bookId.trim().toLowerCase();
  if (!UUID_REGEX.test(trimmed)) {
    throw new TauriCommandError(
      "INVALID_BOOK_ID",
      `Invalid book_id format: ${bookId}`
    );
  }
  return trimmed;
}

/**
 * Normalizes category name identically to Rust (`db::normalize_category_name`):
 * Unicode NFKC -> lowercase -> retain only alphanumeric characters.
 */
export function normalizeCategoryName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function generateDeviceId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function nowIso8601(): string {
  return new Date().toISOString();
}

export function systemNowMs(): number {
  return Date.now();
}

export class HlcTimestamp {
  public wall_ms: number;
  public counter: number;
  public device_id: string;

  constructor(wallMs: number, counter: number, deviceId: string) {
    HlcTimestamp.validateParts(wallMs, counter, deviceId);
    this.wall_ms = wallMs;
    this.counter = counter;
    this.device_id = deviceId;
  }

  static zero(deviceId: string): HlcTimestamp {
    return new HlcTimestamp(0, 0, deviceId);
  }

  static validateParts(
    wallMs: number,
    counter: number,
    deviceId: string
  ): void {
    if (!Number.isInteger(wallMs) || wallMs < 0 || wallMs > MAX_WALL_MS) {
      throw new TauriCommandError(
        "INVALID_HLC",
        `wall_ms ${wallMs} exceeds maximum 13-digit limit`
      );
    }
    if (!Number.isInteger(counter) || counter < 0 || counter > MAX_COUNTER) {
      throw new TauriCommandError(
        "INVALID_HLC",
        `counter ${counter} exceeds maximum 5-digit limit`
      );
    }
    if (
      !deviceId ||
      deviceId.length > 32 ||
      !/^[a-zA-Z0-9]+$/.test(deviceId)
    ) {
      throw new TauriCommandError(
        "INVALID_HLC",
        `invalid device_id '${deviceId}' in HLC`
      );
    }
  }

  static parse(raw: string): HlcTimestamp {
    const firstDash = raw.indexOf("-");
    if (firstDash === -1) {
      throw new TauriCommandError(
        "INVALID_HLC",
        `missing wall_ms in '${raw}'`
      );
    }
    const secondDash = raw.indexOf("-", firstDash + 1);
    if (secondDash === -1) {
      throw new TauriCommandError(
        "INVALID_HLC",
        `missing counter in '${raw}'`
      );
    }

    const wallStr = raw.slice(0, firstDash);
    const counterStr = raw.slice(firstDash + 1, secondDash);
    const deviceId = raw.slice(secondDash + 1);

    if (wallStr.length !== 13 || !/^\d{13}$/.test(wallStr)) {
      throw new TauriCommandError(
        "INVALID_HLC",
        `wall_ms must be 13 decimal digits in '${raw}'`
      );
    }
    if (counterStr.length !== 5 || !/^\d{5}$/.test(counterStr)) {
      throw new TauriCommandError(
        "INVALID_HLC",
        `counter must be 5 decimal digits in '${raw}'`
      );
    }

    const wallMs = Number(wallStr);
    const counter = Number(counterStr);
    return new HlcTimestamp(wallMs, counter, deviceId);
  }

  verifyDrift(nowMs: number): void {
    const maxAllowed = nowMs + MAX_DRIFT_MS;
    if (this.wall_ms > maxAllowed) {
      throw new TauriCommandError(
        "CLOCK_DRIFT_EXCEEDED",
        `remote wall_ms ${this.wall_ms} exceeds now_ms ${nowMs} + 24h (${maxAllowed})`
      );
    }
  }

  toString(): string {
    return `${this.wall_ms.toString().padStart(13, "0")}-${this.counter
      .toString()
      .padStart(5, "0")}-${this.device_id}`;
  }
}

export class HlcClock {
  private lastTs: HlcTimestamp;

  constructor(last: HlcTimestamp) {
    this.lastTs = new HlcTimestamp(last.wall_ms, last.counter, last.device_id);
  }

  static fromDeviceId(deviceId: string): HlcClock {
    return new HlcClock(HlcTimestamp.zero(deviceId));
  }

  last(): HlcTimestamp {
    return this.lastTs;
  }

  deviceId(): string {
    return this.lastTs.device_id;
  }

  tick(nowMs: number = systemNowMs()): HlcTimestamp {
    if (nowMs > MAX_WALL_MS) {
      throw new TauriCommandError(
        "INVALID_HLC",
        "now_ms exceeds 13-digit limit"
      );
    }
    if (nowMs > this.lastTs.wall_ms) {
      this.lastTs.wall_ms = nowMs;
      this.lastTs.counter = 0;
    } else if (this.lastTs.counter >= MAX_COUNTER) {
      this.lastTs.wall_ms += 1;
      if (this.lastTs.wall_ms > MAX_WALL_MS) {
        throw new TauriCommandError("INVALID_HLC", "HLC wall_ms overflow");
      }
      this.lastTs.counter = 0;
    } else {
      this.lastTs.counter += 1;
    }
    return new HlcTimestamp(
      this.lastTs.wall_ms,
      this.lastTs.counter,
      this.lastTs.device_id
    );
  }

  receive(remote: HlcTimestamp, nowMs: number = systemNowMs()): HlcTimestamp {
    remote.verifyDrift(nowMs);

    if (nowMs > this.lastTs.wall_ms && nowMs > remote.wall_ms) {
      this.lastTs.wall_ms = nowMs;
      this.lastTs.counter = 0;
    } else if (this.lastTs.wall_ms === remote.wall_ms) {
      const nextCounter = Math.max(this.lastTs.counter, remote.counter) + 1;
      if (nextCounter > MAX_COUNTER) {
        this.lastTs.wall_ms += 1;
        this.lastTs.counter = 0;
      } else {
        this.lastTs.counter = nextCounter;
      }
    } else if (remote.wall_ms > this.lastTs.wall_ms) {
      this.lastTs.wall_ms = remote.wall_ms;
      const nextCounter = remote.counter + 1;
      if (nextCounter > MAX_COUNTER) {
        this.lastTs.wall_ms += 1;
        this.lastTs.counter = 0;
      } else {
        this.lastTs.counter = nextCounter;
      }
    } else {
      const nextCounter = this.lastTs.counter + 1;
      if (nextCounter > MAX_COUNTER) {
        this.lastTs.wall_ms += 1;
        this.lastTs.counter = 0;
      } else {
        this.lastTs.counter = nextCounter;
      }
    }

    return new HlcTimestamp(
      this.lastTs.wall_ms,
      this.lastTs.counter,
      this.lastTs.device_id
    );
  }
}

export function validateIsoDate(dateStr: string): void {
  if (dateStr.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new TauriCommandError(
      "VALIDATION_ERROR",
      `Invalid date format '${dateStr}', expected YYYY-MM-DD`
    );
  }
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  if (month < 1 || month > 12) {
    throw new TauriCommandError(
      "VALIDATION_ERROR",
      `Invalid calendar date '${dateStr}', expected valid YYYY-MM-DD`
    );
  }
  const maxDay = daysInYearMonth(year, month);
  if (day < 1 || day > maxDay) {
    throw new TauriCommandError(
      "VALIDATION_ERROR",
      `Invalid calendar date '${dateStr}', expected valid YYYY-MM-DD`
    );
  }
}

export function daysInYearMonth(year: number, monthNum: number): number {
  switch (monthNum) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
    default:
      return 30;
  }
}

export function parseMonthBounds(month: string): [string, string] {
  const trimmed = month.trim();
  if (trimmed.length !== 7 || trimmed[4] !== "-") {
    throw new TauriCommandError(
      "VALIDATION_ERROR",
      `Invalid month format '${month}', expected YYYY-MM`
    );
  }
  const year = Number(trimmed.slice(0, 4));
  const monthNum = Number(trimmed.slice(5, 7));
  if (!Number.isInteger(year) || !Number.isInteger(monthNum)) {
    throw new TauriCommandError(
      "VALIDATION_ERROR",
      `Invalid year or month in '${month}'`
    );
  }
  if (monthNum < 1 || monthNum > 12) {
    throw new TauriCommandError(
      "VALIDATION_ERROR",
      `Month number must be between 01 and 12 in '${month}'`
    );
  }
  const startDate = `${year.toString().padStart(4, "0")}-${monthNum
    .toString()
    .padStart(2, "0")}-01`;
  const endDate =
    monthNum === 12
      ? `${(year + 1).toString().padStart(4, "0")}-01-01`
      : `${year.toString().padStart(4, "0")}-${(monthNum + 1)
          .toString()
          .padStart(2, "0")}-01`;
  return [startDate, endDate];
}

export function previousYearMonth(month: string): string {
  const trimmed = month.trim();
  parseMonthBounds(trimmed);
  const year = Number(trimmed.slice(0, 4));
  const monthNum = Number(trimmed.slice(5, 7));
  if (monthNum === 1) {
    return `${(year - 1).toString().padStart(4, "0")}-12`;
  }
  return `${year.toString().padStart(4, "0")}-${(monthNum - 1)
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Encrypts a SQLite snapshot byte array using Web Crypto PBKDF2-SHA256 + AES-256-GCM.
 * Format: [8B magic "DMMWEB01" | 16B salt | 12B iv | ciphertext+tag]
 */
export async function encryptBookSnapshotBytes(
  plainBytes: Uint8Array,
  passphrase: string
): Promise<Uint8Array> {
  if (passphrase.length < 8) {
    throw new TauriCommandError(
      "VALIDATION_ERROR",
      "Export passphrase must be at least 8 characters"
    );
  }
  const enc = new TextEncoder();
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(salt);
  crypto.getRandomValues(iv);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 210_000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plainBytes as unknown as BufferSource
  );
  const cipherBytes = new Uint8Array(cipherBuf);
  const header = enc.encode("DMMWEB01");
  const out = new Uint8Array(8 + 16 + 12 + cipherBytes.length);
  out.set(header, 0);
  out.set(salt, 8);
  out.set(iv, 24);
  out.set(cipherBytes, 36);
  return out;
}

/**
 * Decrypts a `DMMWEB01` encrypted backup byte array back to raw SQLite bytes.
 */
export async function decryptBookSnapshotBytes(
  encryptedBytes: Uint8Array,
  passphrase: string
): Promise<Uint8Array> {
  if (encryptedBytes.length < 36) {
    throw new TauriCommandError(
      "VALIDATION_ERROR",
      "File cadangan tidak valid atau rusak"
    );
  }
  const magic = new TextDecoder().decode(encryptedBytes.slice(0, 8));
  if (magic !== "DMMWEB01") {
    throw new TauriCommandError(
      "CRYPTO_ERROR",
      `Format header cadangan '${magic}' tidak dikenali di mode Web`
    );
  }

  const salt = encryptedBytes.slice(8, 24);
  const iv = encryptedBytes.slice(24, 36);
  const ciphertext = encryptedBytes.slice(36);

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 210_000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  try {
    const plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    return new Uint8Array(plainBuf);
  } catch {
    throw new TauriCommandError(
      "CRYPTO_ERROR",
      "Kata sandi cadangan salah atau file telah berubah"
    );
  }
}

export interface InviteTokenPayload {
  v: number;
  book_id: string;
  book_name: string;
  book_key: string;
  inviter_node_addr: {
    node_id: string;
    relay_url: string | null;
    direct_addrs: string[];
  };
  expires_at: string;
}

/**
 * Returns the current application base URL dynamically (e.g. http://localhost:1420/ or https://money-manager.decentsoft.workers.dev/)
 * prioritizing runtime window location, then import.meta.env.VITE_APP_URL, then fallback.
 */
export function getAppBaseUrl(): string {
  if (typeof window !== "undefined" && window.location) {
    const origin = window.location.origin;
    const pathname = window.location.pathname.replace(/\/+$/, "");
    return `${origin}${pathname}/`;
  }
  return (
    (typeof import.meta !== "undefined" &&
      (import.meta as unknown as { env?: Record<string, string | undefined> })
        .env?.VITE_APP_URL) || "http://localhost:1420/"
  );
}

/**
 * Encodes an invite payload into a compact, URL-safe Base64URL string.
 */
export function encodeInviteToken(payload: InviteTokenPayload): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Decodes an invite from either:
 * 1. A full URL (e.g. `https://domain.com/#/invite?d=...` or `http://localhost:1420/#/invite?d=...`)
 * 2. A raw base64url token string
 * 3. A legacy raw JSON string (`{"v":1,"book_id":...}`)
 */
export function decodeInviteToken(tokenOrUrlOrJson: string): InviteTokenPayload {
  let cleaned = tokenOrUrlOrJson.trim();
  if (!cleaned) {
    throw new TauriCommandError("INVITE_INVALID", "Kode undangan tidak boleh kosong");
  }

  // Check if it's a URL containing ?d= or #/invite?d=
  if (cleaned.includes("d=")) {
    try {
      const hashPart = cleaned.includes("#") ? cleaned.split("#")[1] : cleaned;
      const qIdx = hashPart.indexOf("?");
      if (qIdx >= 0) {
        const params = new URLSearchParams(hashPart.slice(qIdx));
        const d = params.get("d");
        if (d && d.trim().length > 0) {
          cleaned = d.trim();
        }
      }
    } catch {
      // Continue to try raw decoding
    }
  }

  // Check if it's a raw JSON string
  if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
    try {
      const parsed = JSON.parse(cleaned) as InviteTokenPayload;
      if (parsed.v === 1 && parsed.book_id && parsed.book_name) {
        return parsed;
      }
    } catch {
      throw new TauriCommandError("INVITE_INVALID", "Format JSON undangan tidak valid");
    }
  }

  // Decode base64url
  try {
    let b64 = cleaned.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) {
      b64 += "=";
    }
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as InviteTokenPayload;
    if (parsed.v === 1 && parsed.book_id && parsed.book_name) {
      return parsed;
    }
    throw new Error("Payload missing required fields");
  } catch {
    throw new TauriCommandError("INVITE_INVALID", "Format kode atau link undangan tidak valid");
  }
}

/**
 * Builds the full shareable invite URL (e.g. `https://<domain>/#/invite?d=<token>`).
 */
export function buildInviteShareUrl(
  payload: InviteTokenPayload,
  customBaseUrl?: string
): string {
  const token = encodeInviteToken(payload);
  const baseUrl = (customBaseUrl ?? getAppBaseUrl()).replace(/\/+$/, "");
  return `${baseUrl}/#/invite?d=${token}`;
}
