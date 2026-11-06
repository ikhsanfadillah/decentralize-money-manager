import { describe, expect, it } from "vitest";
import { WebSyncEngine } from "../web-sync-engine";
import { tauriApi } from "../tauri-api";
import { listenAppEvent, EVENT_CRDT_SYNCED } from "../event-bus";
import { buildSignalingRoomUrl, getWebRtcConfig } from "../webrtc-config";
import {
  decodeInviteToken,
  encodeInviteToken,
  toCompactInvitePayload,
  buildInviteShareUrl,
  newUuidV7,
  HlcTimestamp,
} from "../web-core";

describe("WebSyncEngine (Main Thread WebRTC & CRDT Event Bus)", () => {
  it("encodes and decodes shareable invite URLs and Base64URL tokens correctly", () => {
    const payload = {
      v: 1,
      book_id: "book-test-123",
      book_name: "Keuangan Bisnis",
      book_key: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      inviter_node_addr: {
        node_id: "node-test-xyz",
        relay_url: "wss://dmm-webrtc-signaling.workers.dev/ws/invite/inv-123",
        direct_addrs: ["webrtc:v1"],
      },
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    };

    const token = encodeInviteToken(payload);
    expect(typeof token).toBe("string");
    expect(token).not.toContain(" ");
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");

    const shareUrl = buildInviteShareUrl(payload, "https://money-manager.decentsoft.workers.dev");
    expect(shareUrl).toContain("https://money-manager.decentsoft.workers.dev/#/invite?d=");

    // Decode from full URL
    const decodedFromUrl = decodeInviteToken(shareUrl);
    expect(decodedFromUrl.v).toBe(1);
    expect(decodedFromUrl.book_id).toBe("book-test-123");
    expect(decodedFromUrl.book_name).toBe("Keuangan Bisnis");

    // Decode from raw token
    const decodedFromToken = decodeInviteToken(token);
    expect(decodedFromToken.book_id).toBe("book-test-123");

    // Decode from legacy raw JSON
    const decodedFromJson = decodeInviteToken(JSON.stringify(payload));
    expect(decodedFromJson.book_id).toBe("book-test-123");
  });

  it("encodes compact format v2 tokens, reducing payload size while preserving full compatibility", () => {
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    const defaultRelayUrl = buildSignalingRoomUrl(
      getWebRtcConfig().signalingUrl,
      "invite",
      "inv-room12345678"
    );
    const payload = {
      v: 2,
      book_id: "book-compact-456",
      book_name: "Kas Pribadi Minimalis",
      book_key: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      inviter_node_addr: {
        node_id: "node-inviter-compact-999",
        relay_url: defaultRelayUrl,
        direct_addrs: ["webrtc:v1"],
      },
      expires_at: expiresAt,
    };

    // Compact token encoding
    const compactObj = toCompactInvitePayload(payload);
    expect(compactObj.v).toBe(2);
    expect(compactObj.b).toBe("book-compact-456");
    expect(compactObj.r).toBe("inv-room12345678");
    expect(compactObj.u).toBeUndefined(); // default signaling is omitted to save bytes!

    const compactToken = encodeInviteToken(compactObj);
    const legacyToken = encodeInviteToken({ ...payload, v: 1 });

    // Verify significant payload reduction (>40% smaller token)
    expect(compactToken.length).toBeLessThan(legacyToken.length * 0.7);

    // Decode from compact URL
    const compactUrl = buildInviteShareUrl(compactObj, "https://money-manager.decentsoft.workers.dev");
    const decodedFromUrl = decodeInviteToken(compactUrl);
    expect(decodedFromUrl.v).toBe(1);
    expect(decodedFromUrl.book_id).toBe("book-compact-456");
    expect(decodedFromUrl.book_name).toBe("Kas Pribadi Minimalis");
    expect(decodedFromUrl.book_key).toBe(payload.book_key);
    expect(decodedFromUrl.inviter_node_addr.relay_url).toContain("/ws/invite/inv-room12345678");
    expect(decodedFromUrl.inviter_node_addr.node_id).toBe("node-inviter-compact-999");

    // Also verify custom relay preserves its full URL in compact format
    const customPayload = {
      ...payload,
      inviter_node_addr: {
        ...payload.inviter_node_addr,
        relay_url: "wss://my-custom-private-relay.org/ws/invite/inv-custom999",
      },
    };
    const customCompact = toCompactInvitePayload(customPayload);
    expect(customCompact.u).toBe("wss://my-custom-private-relay.org/ws/invite/inv-custom999");
    const decodedCustom = decodeInviteToken(encodeInviteToken(customCompact));
    expect(decodedCustom.inviter_node_addr.relay_url).toBe(
      "wss://my-custom-private-relay.org/ws/invite/inv-custom999"
    );

    // Decode from compact raw JSON
    const decodedFromCompactJson = decodeInviteToken(JSON.stringify(compactObj));
    expect(decodedFromCompactJson.book_id).toBe("book-compact-456");
    expect(decodedFromCompactJson.book_name).toBe("Kas Pribadi Minimalis");
  });

  it("generates invite URL and allows another tab/session to join book", async () => {
    // 1. Create a book via tauriApi
    const book = await tauriApi.createBook("Tab Regular Book", "PERSONAL");
    expect(book.id).toBeDefined();

    const syncEngine = new WebSyncEngine("node-host-111122223333444455556666");

    // 2. Host creates QR invite
    const invite = await syncEngine.createInvite(book.id, 600);
    expect(invite.qr_json).toBeDefined();
    expect(invite.invite_url).toBeDefined();
    expect(invite.qr_json).toContain("#/invite?d=");
    expect(invite.node_id).toBe("node-host-111122223333444455556666");

    const parsed = decodeInviteToken(invite.invite_url || invite.qr_json);
    expect(parsed.v).toBe(1);
    expect(parsed.book_id).toBe(book.id);
    expect(parsed.book_name).toBe("Tab Regular Book");
    expect(parsed.inviter_node_addr.relay_url).toContain("/ws/invite/inv-");

    // 3. Incognito client joins the book using the shareable link URL
    const incognitoSyncEngine = new WebSyncEngine("node-joiner-999988887777666655554444");
    const joined = await incognitoSyncEngine.joinBookFromInvite(invite.qr_json, "PERSONAL");

    expect(joined.id).toBe(book.id);
    expect(joined.name).toBe("Tab Regular Book");

    // 4. Check initial sync status
    const status = incognitoSyncEngine.getSyncStatus(book.id);
    expect(status.book_id).toBe(book.id);
    expect(status.state).toBe("idle");
  });

  it("dispatches EVENT_CRDT_SYNCED to React EventTarget when delta ops are applied", async () => {
    const book = await tauriApi.createBook("Sync Event Test Book", "PERSONAL");
    const syncEngine = new WebSyncEngine("node-test-peer-0000111122223333");

    let receivedSyncedEvent: { book_id: string; tables: string[] } | null = null;
    const unsub = await listenAppEvent<{ book_id: string; tables: string[] }>(
      EVENT_CRDT_SYNCED,
      (evt) => {
        receivedSyncedEvent = evt.payload;
      }
    );

    const devId = "99887766";
    const hlc = new HlcTimestamp(1_000_000, 0, devId).toString();
    const accId = newUuidV7();

    const remoteOp = {
      hlc_timestamp: hlc,
      table_name: "accounts",
      row_id: accId,
      device_id: devId,
      payload_json: JSON.stringify({
        op: "upsert",
        row: {
          id: accId,
          name: "Tabungan Darurat",
          account_type: "BANK",
          initial_balance: 10_000_000,
          merged_into_id: null,
          is_deleted: 0,
          updated_hlc: hlc,
        },
      }),
    };

    // Simulate incoming delta message
    const mockSession = {
      remotePeerId: "peer-remote-xyz",
      sendWireMessage: async () => {},
    } as unknown as Parameters<WebSyncEngine["handleIncomingWireMessage"]>[3];

    // Call private handleIncomingWireMessage via type assertion
    const engineInternal = syncEngine as unknown as {
      handleIncomingWireMessage: (
        bookId: string,
        fromPeerId: string,
        msg: unknown,
        session: unknown
      ) => Promise<void>;
    };

    await engineInternal.handleIncomingWireMessage(
      book.id,
      "peer-remote-xyz",
      {
        type: "delta",
        ops: [remoteOp],
        isFinal: true,
      },
      mockSession
    );

    expect(receivedSyncedEvent).not.toBeNull();
    expect(receivedSyncedEvent!.book_id).toBe(book.id);
    expect(receivedSyncedEvent!.tables).toContain("accounts");

    // Verify account exists in DB
    const accounts = await tauriApi.listAccounts(book.id);
    const found = accounts.find((a) => a.id === accId);
    expect(found).toBeDefined();
    expect(found!.name).toBe("Tabungan Darurat");
    expect(found!.initial_balance).toBe(10_000_000);

    unsub();
  });
});

