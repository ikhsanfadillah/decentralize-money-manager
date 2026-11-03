import { describe, expect, it } from "vitest";
import { resolvePeerDisplayName } from "../tauri-api";
import { WebSqliteEngine } from "../../web-worker/sqlite-engine";

describe("Device Labeling & Resolution", () => {
  it("resolves peer name with correct priority hierarchy", () => {
    // 1. Custom alias takes highest priority
    expect(
      resolvePeerDisplayName({
        node_id: "node12345678",
        device_id: "dev12345",
        device_name: "Laptop Budi",
        custom_alias: "Mas Budi",
      })
    ).toBe("Mas Budi");

    // 2. Broadcast device_name when alias is absent
    expect(
      resolvePeerDisplayName({
        node_id: "node12345678",
        device_id: "dev12345",
        device_name: "Laptop Budi",
        custom_alias: null,
      })
    ).toBe("Laptop Budi");

    // 3. Fallback to device_id when device_name is absent
    expect(
      resolvePeerDisplayName({
        node_id: "node12345678",
        device_id: "05817910",
        device_name: null,
        custom_alias: null,
      })
    ).toBe("Perangkat 05817910");

    // 4. Fallback to node_id slice when device_id is also absent
    expect(
      resolvePeerDisplayName({
        node_id: "abcdef123456",
        device_id: null,
        device_name: null,
        custom_alias: null,
      })
    ).toBe("Perangkat abcdef12");
  });

  it("updates device name and peer custom alias in WebSqliteEngine", async () => {
    const engine = new WebSqliteEngine();
    await engine.init();

    const book = await engine.createBook("Buku Label Test", "PERSONAL");
    const bookId = book.id;

    // Default device identity
    const defaultIdentity = await engine.getDeviceIdentity(bookId);
    expect(defaultIdentity.device_id).toBeDefined();
    expect(defaultIdentity.device_name).toBeDefined();

    // Set custom device name
    const updatedIdentity = await engine.setDeviceName(bookId, "Laptop Kantor");
    expect(updatedIdentity.device_name).toBe("Laptop Kantor");

    const recheckIdentity = await engine.getDeviceIdentity(bookId);
    expect(recheckIdentity.device_name).toBe("Laptop Kantor");

    // Record a peer
    await engine.recordPeerSeen({
      bookId,
      nodeId: "node-remote-123456",
      deviceId: "dev-peer-1",
      deviceName: "HP Xiaomi",
    });

    let peers = await engine.getSyncPeers(bookId);
    expect(peers.length).toBe(1);
    expect(peers[0].device_name).toBe("HP Xiaomi");
    expect(peers[0].custom_alias).toBeNull();

    // Set peer custom alias
    await engine.setPeerCustomAlias(bookId, "node-remote-123456", "HP Toko Utama");
    peers = await engine.getSyncPeers(bookId);
    expect(peers[0].custom_alias).toBe("HP Toko Utama");

    // Reset peer custom alias to null
    await engine.setPeerCustomAlias(bookId, "node-remote-123456", null);
    peers = await engine.getSyncPeers(bookId);
    expect(peers[0].custom_alias).toBeNull();
    expect(peers[0].device_name).toBe("HP Xiaomi");
  });
});

