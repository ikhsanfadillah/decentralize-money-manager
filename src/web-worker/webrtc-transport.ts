import type { CrdtOp } from "./crdt-merge";
import { buildRtcConfiguration, getWebRtcConfig } from "../lib/webrtc-config";

export const CHUNK_SIZE_BYTES = 32 * 1024; // 32 KiB SCTP chunks
export const MAX_WIRE_FRAME_BYTES = 512 * 1024; // 512 KiB maximum single frame
export const BUFFERED_AMOUNT_LOW_THRESHOLD = 64 * 1024; // 64 KiB backpressure threshold

export type WebRtcWireMessage =
  | {
      type: "hello";
      bookId: string;
      nodeId: string;
      deviceId: string;
    }
  | {
      type: "frontier";
      frontier: Record<string, string>;
    }
  | {
      type: "delta";
      ops: CrdtOp[];
      isFinal: boolean;
    }
  | {
      type: "sync_ack";
      ok: boolean;
    }
  | {
      type: "push_ops";
      ops: CrdtOp[];
    }
  | {
      type: "heartbeat";
      frontier: Record<string, string>;
    };

/**
 * Splits a byte frame into 32 KiB chunks prefixed with a 4-byte big-endian frame length.
 */
export function encodeFramedChunks(payload: Uint8Array): Uint8Array[] {
  if (payload.length > MAX_WIRE_FRAME_BYTES) {
    throw new Error(
      `Frame size ${payload.length} exceeds MAX_WIRE_FRAME_BYTES (${MAX_WIRE_FRAME_BYTES})`,
    );
  }

  const totalLen = payload.length;
  const framed = new Uint8Array(4 + totalLen);
  const view = new DataView(framed.buffer);
  view.setUint32(0, totalLen, false); // Big-endian 4-byte length
  framed.set(payload, 4);

  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < framed.length; offset += CHUNK_SIZE_BYTES) {
    chunks.push(framed.subarray(offset, Math.min(framed.length, offset + CHUNK_SIZE_BYTES)));
  }
  return chunks;
}

/**
 * Stateful reassembly buffer for incoming 32 KiB chunks.
 */
export class FrameReassembler {
  private buffer: Uint8Array = new Uint8Array(0);

  feedChunk(chunk: Uint8Array): Uint8Array[] {
    const combined = new Uint8Array(this.buffer.length + chunk.length);
    combined.set(this.buffer, 0);
    combined.set(chunk, this.buffer.length);
    this.buffer = combined;

    const frames: Uint8Array[] = [];

    while (this.buffer.length >= 4) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
      const expectedPayloadLen = view.getUint32(0, false);

      if (expectedPayloadLen > MAX_WIRE_FRAME_BYTES) {
        this.buffer = new Uint8Array(0);
        throw new Error(
          `Received invalid frame length ${expectedPayloadLen} > MAX_WIRE_FRAME_BYTES`,
        );
      }

      const totalFrameBytes = 4 + expectedPayloadLen;
      if (this.buffer.length < totalFrameBytes) {
        // Need more chunks
        break;
      }

      const payload = this.buffer.slice(4, totalFrameBytes);
      frames.push(payload);
      this.buffer = this.buffer.slice(totalFrameBytes);
    }

    return frames;
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
  }
}

export interface SignalingTransportCallbacks {
  onPeerJoined: (peerId: string) => void;
  onOffer: (fromPeerId: string, offer: RTCSessionDescriptionInit) => void;
  onAnswer: (fromPeerId: string, answer: RTCSessionDescriptionInit) => void;
  onIceCandidate: (fromPeerId: string, candidate: RTCIceCandidateInit) => void;
  onPeerLeft: (peerId: string) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
}

export class WebRtcSignalingClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private joined = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    public readonly signalingRoomUrl: string,
    public readonly localPeerId: string,
    private readonly callbacks: SignalingTransportCallbacks,
  ) {}

  connect(): Promise<void> {
    if (typeof WebSocket === "undefined") {
      return Promise.reject(new Error("WebSocket not supported in this runtime"));
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.signalingRoomUrl);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      const timeoutTimer = setTimeout(() => {
        if (!this.joined && !this.closed) {
          this.close();
          reject(new Error(`Signaling connection timed out for ${this.signalingRoomUrl}`));
        }
      }, 8000);

      this.ws.onopen = () => {
        try {
          this.ws?.send(
            JSON.stringify({
              type: "join",
              peerId: this.localPeerId,
            }),
          );
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            type: string;
            peerId?: string;
            fromPeerId?: string;
            peers?: string[];
            sdp?: RTCSessionDescriptionInit;
            candidate?: RTCIceCandidateInit;
            error?: string;
            message?: string;
          };

          switch (msg.type) {
            case "joined":
              this.joined = true;
              clearTimeout(timeoutTimer);
              if (!this.pingInterval) {
                this.pingInterval = setInterval(() => {
                  if (!this.closed && this.ws?.readyState === WebSocket.OPEN) {
                    try {
                      this.ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
                    } catch {
                      // Ignore
                    }
                  }
                }, 25000);
              }
              resolve();
              if (Array.isArray(msg.peers)) {
                for (const p of msg.peers) {
                  if (p && p !== this.localPeerId) {
                    this.callbacks.onPeerJoined(p);
                  }
                }
              }
              break;

            case "peer-joined":
              if (msg.peerId && msg.peerId !== this.localPeerId) {
                this.callbacks.onPeerJoined(msg.peerId);
              }
              break;

            case "offer":
              if (msg.fromPeerId && msg.sdp) {
                this.callbacks.onOffer(msg.fromPeerId, msg.sdp);
              }
              break;

            case "answer":
              if (msg.fromPeerId && msg.sdp) {
                this.callbacks.onAnswer(msg.fromPeerId, msg.sdp);
              }
              break;

            case "ice-candidate":
              if (msg.fromPeerId && msg.candidate) {
                this.callbacks.onIceCandidate(msg.fromPeerId, msg.candidate);
              }
              break;

            case "peer-left":
              if (msg.peerId) {
                this.callbacks.onPeerLeft(msg.peerId);
              }
              break;

            case "error":
              this.callbacks.onError?.(new Error(msg.message || "Signaling error"));
              break;
          }
        } catch (err) {
          this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      };

      this.ws.onerror = () => {
        if (!this.joined) {
          clearTimeout(timeoutTimer);
          reject(new Error(`Failed to connect to signaling URL: ${this.signalingRoomUrl}`));
        }
      };

      this.ws.onclose = () => {
        this.closed = true;
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        this.callbacks.onClose?.();
      };
    });
  }

  sendSignal(payload: Record<string, unknown>): void {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      this.ws.send(JSON.stringify(payload));
    } catch {
      // Ignore
    }
  }

  close(): void {
    this.closed = true;
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    try {
      this.ws?.close();
    } catch {
      // Ignore
    }
    this.ws = null;
  }
}

export interface PeerSessionCallbacks {
  onConnected: () => void;
  onMessage: (msg: WebRtcWireMessage) => void;
  onDisconnected: () => void;
}

/**
 * Manages an individual WebRTC RTCPeerConnection and RTCDataChannel session.
 */
export class WebRtcPeerSession {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private reassembler = new FrameReassembler();
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private closed = false;

  constructor(
    public readonly remotePeerId: string,
    private readonly isInitiator: boolean,
    private readonly signaling: WebRtcSignalingClient,
    private readonly callbacks: PeerSessionCallbacks,
  ) {}

  async initialize(): Promise<void> {
    if (typeof RTCPeerConnection === "undefined") {
      throw new Error("RTCPeerConnection is not supported in this runtime");
    }

    const rtcConfig = buildRtcConfiguration(getWebRtcConfig());
    this.pc = new RTCPeerConnection(rtcConfig);

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candidateObj =
          typeof event.candidate.toJSON === "function"
            ? event.candidate.toJSON()
            : {
                candidate: event.candidate.candidate,
                sdpMid: event.candidate.sdpMid,
                sdpMLineIndex: event.candidate.sdpMLineIndex,
              };
        this.signaling.sendSignal({
          type: "ice-candidate",
          targetPeerId: this.remotePeerId,
          candidate: candidateObj,
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      if (state === "failed" || state === "closed") {
        this.close();
      }
    };

    if (this.isInitiator) {
      // Initiator creates the DataChannel
      const dc = this.pc.createDataChannel("fmm-sync-1", { ordered: true });
      this.bindDataChannel(dc);

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      this.signaling.sendSignal({
        type: "offer",
        targetPeerId: this.remotePeerId,
        sdp: offer,
      });
    } else {
      // Responder waits for remote DataChannel
      this.pc.ondatachannel = (ev) => {
        this.bindDataChannel(ev.channel);
      };
    }
  }

  async handleRemoteOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    await this.drainPendingCandidates();

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    this.signaling.sendSignal({
      type: "answer",
      targetPeerId: this.remotePeerId,
      sdp: answer,
    });
  }

  async handleRemoteAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    await this.drainPendingCandidates();
  }

  async handleRemoteIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) return;
    if (!this.pc.remoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Ignore stale ICE candidates
    }
  }

  private async drainPendingCandidates(): Promise<void> {
    if (!this.pc) return;
    while (this.pendingCandidates.length > 0) {
      const cand = this.pendingCandidates.shift()!;
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch {
        // Ignore
      }
    }
  }

  private bindDataChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    this.channel.binaryType = "arraybuffer";
    this.channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW_THRESHOLD;

    this.channel.onopen = () => {
      if (!this.closed) {
        this.callbacks.onConnected();
      }
    };

    this.channel.onclose = () => {
      this.close();
    };

    this.channel.onerror = () => {
      this.close();
    };

    this.channel.onmessage = (event) => {
      try {
        const rawChunk = new Uint8Array(event.data as ArrayBuffer);
        const completeFrames = this.reassembler.feedChunk(rawChunk);
        for (const frame of completeFrames) {
          const text = new TextDecoder().decode(frame);
          const msg = JSON.parse(text) as WebRtcWireMessage;
          this.callbacks.onMessage(msg);
        }
      } catch (err) {
        console.warn("[webrtc-transport] Failed to process message frame:", err);
      }
    };
  }

  async sendWireMessage(msg: WebRtcWireMessage): Promise<void> {
    if (this.closed || !this.channel || this.channel.readyState !== "open") {
      throw new Error("Cannot send frame: DataChannel is not open");
    }

    const payloadText = JSON.stringify(msg);
    const payloadBytes = new TextEncoder().encode(payloadText);
    const chunks = encodeFramedChunks(payloadBytes);

    for (const chunk of chunks) {
      if (this.channel.bufferedAmount > BUFFERED_AMOUNT_LOW_THRESHOLD) {
        await new Promise<void>((resolve) => {
          const onLow = () => {
            this.channel?.removeEventListener("bufferedamountlow", onLow);
            resolve();
          };
          this.channel?.addEventListener("bufferedamountlow", onLow);
        });
      }
      (this.channel as unknown as { send(data: unknown): void }).send(chunk);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.reassembler.reset();
    try {
      this.channel?.close();
    } catch {
      // Ignore
    }
    this.channel = null;
    try {
      this.pc?.close();
    } catch {
      // Ignore
    }
    this.pc = null;
    this.callbacks.onDisconnected();
  }
}
