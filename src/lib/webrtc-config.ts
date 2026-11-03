export interface WebRtcIceConfig {
  signalingUrl: string;
  stunUrls: string[];
  turnUrls: string[];
  turnUsername?: string;
  turnCredential?: string;
  iceServersJson?: string;
}

export interface WebRtcRuntimeOverride {
  signalingUrl?: string;
  stunUrls?: string[];
  turnUrls?: string[];
  turnUsername?: string;
  turnCredential?: string;
}

export interface IceConnectivityReport {
  signalingUrl: string;
  signalingReachable: boolean;
  signalingLatencyMs: number | null;
  signalingError: string | null;
  gatheredCandidateTypes: Array<"host" | "srflx" | "prflx" | "relay" | "unknown">;
  hasStunCandidate: boolean;
  hasTurnRelayCandidate: boolean;
  candidates: Array<{
    type: string;
    protocol: string;
    address?: string;
    port?: number;
    raw: string;
  }>;
  iceGatheringState: string;
}

const RUNTIME_OVERRIDE_STORAGE_KEY = "dmm.webrtc.config.v1";

export const DEFAULT_STUN_URLS: readonly string[] = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
  "stun:stun.cloudflare.com:3478",
];

function splitCsvUrls(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function getDefaultSignalingUrl(): string {
  if (typeof globalThis !== "undefined" && "location" in globalThis && globalThis.location) {
    const loc = globalThis.location;
    if (loc.protocol === "http:" || loc.protocol === "https:") {
      const wsProto = loc.protocol === "https:" ? "wss:" : "ws:";
      return `${wsProto}//${loc.host}/__dmm_signal`;
    }
  }
  return "ws://localhost:8787";
}

export function loadWebRtcRuntimeOverride(): WebRtcRuntimeOverride | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(RUNTIME_OVERRIDE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WebRtcRuntimeOverride;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveWebRtcRuntimeOverride(override: WebRtcRuntimeOverride): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(RUNTIME_OVERRIDE_STORAGE_KEY, JSON.stringify(override));
}

export function clearWebRtcRuntimeOverride(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(RUNTIME_OVERRIDE_STORAGE_KEY);
}

export function getWebRtcConfig(
  envOverrides?: Record<string, string | undefined>,
): WebRtcIceConfig {
  const metaEnv: Record<string, string | undefined> =
    envOverrides ??
    ((typeof import.meta !== "undefined" &&
      (import.meta as unknown as { env?: Record<string, string | undefined> }).env) ||
      {});

  const runtime = loadWebRtcRuntimeOverride();

  const signalingUrl = (
    runtime?.signalingUrl?.trim() ||
    metaEnv.VITE_SIGNALING_URL?.trim() ||
    getDefaultSignalingUrl()
  ).replace(/\/+$/, "");

  const envStunUrls = splitCsvUrls(metaEnv.VITE_STUN_URLS);
  const stunUrls =
    runtime?.stunUrls && runtime.stunUrls.length > 0
      ? runtime.stunUrls
      : envStunUrls.length > 0
        ? envStunUrls
        : [...DEFAULT_STUN_URLS];

  const envTurnUrls = splitCsvUrls(metaEnv.VITE_TURN_URLS);
  const turnUrls =
    runtime?.turnUrls && runtime.turnUrls.length > 0 ? runtime.turnUrls : envTurnUrls;

  const turnUsername =
    runtime?.turnUsername?.trim() || metaEnv.VITE_TURN_USERNAME?.trim() || undefined;
  const turnCredential =
    runtime?.turnCredential?.trim() || metaEnv.VITE_TURN_CREDENTIAL?.trim() || undefined;
  const iceServersJson = metaEnv.VITE_ICE_SERVERS_JSON?.trim() || undefined;

  return {
    signalingUrl,
    stunUrls,
    turnUrls,
    turnUsername,
    turnCredential,
    iceServersJson,
  };
}

export function buildRtcConfiguration(config?: WebRtcIceConfig): RTCConfiguration {
  const resolved = config ?? getWebRtcConfig();

  if (resolved.iceServersJson) {
    try {
      const parsed = JSON.parse(resolved.iceServersJson) as RTCIceServer[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return {
          iceServers: parsed,
          iceCandidatePoolSize: 4,
        };
      }
    } catch {
      // Fall back to structured STUN/TURN lists if JSON is malformed
    }
  }

  const iceServers: RTCIceServer[] = [];

  if (resolved.stunUrls.length > 0) {
    iceServers.push({
      urls: resolved.stunUrls.length === 1 ? resolved.stunUrls[0] : resolved.stunUrls,
    });
  }

  if (resolved.turnUrls.length > 0) {
    const turnEntry: RTCIceServer = {
      urls: resolved.turnUrls.length === 1 ? resolved.turnUrls[0] : resolved.turnUrls,
    };
    if (resolved.turnUsername) {
      turnEntry.username = resolved.turnUsername;
    }
    if (resolved.turnCredential) {
      turnEntry.credential = resolved.turnCredential;
    }
    iceServers.push(turnEntry);
  }

  return {
    iceServers,
    iceCandidatePoolSize: 4,
  };
}

export function buildSignalingRoomUrl(
  baseUrl: string,
  roomType: "invite" | "topic",
  roomId: string,
): string {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const safeRoomId = encodeURIComponent(roomId.trim());
  const httpNormalized = normalizedBase
    .replace(/^http:\/\//i, "ws://")
    .replace(/^https:\/\//i, "wss://");

  if (httpNormalized.endsWith(`/ws/${roomType}/${safeRoomId}`)) {
    return httpNormalized;
  }
  if (httpNormalized.endsWith("/ws")) {
    return `${httpNormalized}/${roomType}/${safeRoomId}`;
  }
  return `${httpNormalized}/ws/${roomType}/${safeRoomId}`;
}

export function parseIceCandidateSummary(candidateStr: string): {
  type: "host" | "srflx" | "prflx" | "relay" | "unknown";
  protocol: string;
  address?: string;
  port?: number;
} {
  const tokens = candidateStr.trim().split(/\s+/);
  const protocol = (tokens[2] || "udp").toLowerCase();
  const address = tokens[4];
  const portNum = tokens[5] ? Number.parseInt(tokens[5], 10) : undefined;
  const typIdx = tokens.indexOf("typ");
  const rawType = typIdx >= 0 && tokens[typIdx + 1] ? tokens[typIdx + 1].toLowerCase() : "unknown";

  const type =
    rawType === "host" || rawType === "srflx" || rawType === "prflx" || rawType === "relay"
      ? rawType
      : "unknown";

  return {
    type,
    protocol,
    address,
    port: Number.isFinite(portNum) ? portNum : undefined,
  };
}

export async function checkSignalingReachability(
  signalingBaseUrl: string,
  timeoutMs = 4000,
): Promise<{ reachable: boolean; latencyMs: number | null; error: string | null }> {
  if (typeof WebSocket === "undefined") {
    return {
      reachable: false,
      latencyMs: null,
      error: "WebSocket API is not available in this runtime",
    };
  }

  const probeRoomId = `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const url = buildSignalingRoomUrl(signalingBaseUrl, "invite", probeRoomId);
  const startedAt = Date.now();

  return await new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket | null = null;

    const finish = (reachable: boolean, latencyMs: number | null, error: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        // Ignore close errors
      }
      resolve({ reachable, latencyMs, error });
    };

    const timer = setTimeout(() => {
      finish(false, null, `Signaling connection timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    try {
      ws = new WebSocket(url);
    } catch (err) {
      finish(false, null, err instanceof Error ? err.message : String(err));
      return;
    }

    ws.onopen = () => {
      try {
        ws?.send(JSON.stringify({ type: "ping", ts: startedAt }));
      } catch (err) {
        finish(false, null, err instanceof Error ? err.message : String(err));
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data)) as { type?: string };
        if (data.type === "pong" || data.type === "joined") {
          finish(true, Math.max(1, Date.now() - startedAt), null);
        }
      } catch {
        finish(true, Math.max(1, Date.now() - startedAt), null);
      }
    };

    ws.onerror = () => {
      finish(false, null, `Failed to connect to signaling server at ${url}`);
    };

    ws.onclose = (ev) => {
      if (!settled) {
        finish(
          false,
          null,
          `Signaling WebSocket closed unexpectedly (code ${ev.code}${ev.reason ? `: ${ev.reason}` : ""})`,
        );
      }
    };
  });
}

export async function checkIceAndSignalConnectivity(options?: {
  config?: WebRtcIceConfig;
  timeoutMs?: number;
}): Promise<IceConnectivityReport> {
  const config = options?.config ?? getWebRtcConfig();
  const timeoutMs = options?.timeoutMs ?? 4500;

  const sigResult = await checkSignalingReachability(config.signalingUrl, timeoutMs);

  if (typeof RTCPeerConnection === "undefined") {
    return {
      signalingUrl: config.signalingUrl,
      signalingReachable: sigResult.reachable,
      signalingLatencyMs: sigResult.latencyMs,
      signalingError: sigResult.error,
      gatheredCandidateTypes: [],
      hasStunCandidate: false,
      hasTurnRelayCandidate: false,
      candidates: [],
      iceGatheringState: "unsupported",
    };
  }

  const rtcConfig = buildRtcConfiguration(config);
  const pc = new RTCPeerConnection(rtcConfig);
  const candidates: IceConnectivityReport["candidates"] = [];
  const candidateTypeSet = new Set<"host" | "srflx" | "prflx" | "relay" | "unknown">();

  try {
    pc.createDataChannel("dmm-ice-probe");

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };

      const timer = setTimeout(finish, timeoutMs);

      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          finish();
          return;
        }
        const raw = event.candidate.candidate;
        if (!raw) return;
        const parsed = parseIceCandidateSummary(raw);
        candidateTypeSet.add(parsed.type);
        candidates.push({
          ...parsed,
          raw,
        });
      };

      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") {
          finish();
        }
      };

      void pc
        .createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => finish());
    });

    const gatheredCandidateTypes = Array.from(candidateTypeSet);
    return {
      signalingUrl: config.signalingUrl,
      signalingReachable: sigResult.reachable,
      signalingLatencyMs: sigResult.latencyMs,
      signalingError: sigResult.error,
      gatheredCandidateTypes,
      hasStunCandidate: candidateTypeSet.has("srflx") || candidateTypeSet.has("prflx"),
      hasTurnRelayCandidate: candidateTypeSet.has("relay"),
      candidates,
      iceGatheringState: pc.iceGatheringState,
    };
  } finally {
    try {
      pc.close();
    } catch {
      // Ignore close errors
    }
  }
}

