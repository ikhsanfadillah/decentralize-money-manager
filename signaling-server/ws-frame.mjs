import crypto from "node:crypto";

const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * Encode an unmasked server-to-client WebSocket frame (RFC 6455).
 * @param {number} opcode 0x1 = text, 0x8 = close, 0x9 = ping, 0xA = pong
 * @param {Buffer} payloadBuf
 */
export function encodeWsFrame(opcode, payloadInput = Buffer.alloc(0)) {
  const payloadBuf = Buffer.isBuffer(payloadInput)
    ? payloadInput
    : Buffer.from(payloadInput);
  const len = payloadBuf.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payloadBuf]);
}

/**
 * Upgrade an incoming Node HTTP upgrade request to an RFC 6455 WebSocket connection.
 */
export function upgradeToWebSocket(req, socket, head, callbacks) {
  const key = req.headers["sec-websocket-key"];
  if (!key || typeof key !== "string") {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return null;
  }

  const acceptKey = crypto
    .createHash("sha1")
    .update(key.trim() + WS_MAGIC_GUID)
    .digest("base64");

  const responseHeaders = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${acceptKey}`,
    "\r\n",
  ].join("\r\n");

  socket.setNoDelay(true);
  socket.write(responseHeaders);

  let closed = false;
  let recvBuffer = head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
  let fragments = [];

  const sendText = (text) => {
    if (closed || socket.destroyed) return;
    const payload = Buffer.from(String(text), "utf8");
    socket.write(encodeWsFrame(0x01, payload));
  };

  const sendClose = (code = 1000, reason = "") => {
    if (closed) return;
    closed = true;
    if (!socket.destroyed) {
      const reasonBuf = Buffer.from(String(reason).slice(0, 120), "utf8");
      const payload = Buffer.alloc(2 + reasonBuf.length);
      payload.writeUInt16BE(code, 0);
      reasonBuf.copy(payload, 2);
      try {
        socket.write(encodeWsFrame(0x08, payload));
        socket.end();
      } catch {
        socket.destroy();
      }
    }
  };

  const processBuffer = () => {
    while (recvBuffer.length >= 2 && !closed) {
      const byte0 = recvBuffer[0];
      const byte1 = recvBuffer[1];
      const fin = (byte0 & 0x80) !== 0;
      const opcode = byte0 & 0x0f;
      const isMasked = (byte1 & 0x80) !== 0;
      let payloadLen = byte1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (recvBuffer.length < 4) return;
        payloadLen = recvBuffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (recvBuffer.length < 10) return;
        const bigLen = recvBuffer.readBigUInt64BE(2);
        if (bigLen > BigInt(1024 * 1024)) {
          sendClose(1009, "Message too big");
          return;
        }
        payloadLen = Number(bigLen);
        offset = 10;
      }

      const maskLen = isMasked ? 4 : 0;
      const totalFrameLen = offset + maskLen + payloadLen;
      if (recvBuffer.length < totalFrameLen) {
        return;
      }

      const maskKey = isMasked ? recvBuffer.subarray(offset, offset + 4) : null;
      const payload = Buffer.from(
        recvBuffer.subarray(offset + maskLen, offset + maskLen + payloadLen),
      );
      recvBuffer = recvBuffer.subarray(totalFrameLen);

      if (isMasked && maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i & 3];
        }
      }

      if (opcode === 0x08) {
        // Close frame
        closed = true;
        try {
          socket.write(encodeWsFrame(0x08, Buffer.alloc(0)));
          socket.end();
        } catch {
          socket.destroy();
        }
        callbacks.onClose?.();
        return;
      }

      if (opcode === 0x09) {
        // Ping -> Pong
        if (!socket.destroyed) {
          socket.write(encodeWsFrame(0x0a, payload));
        }
        continue;
      }

      if (opcode === 0x0a) {
        // Pong -> ignore
        continue;
      }

      if (opcode === 0x01 || opcode === 0x02 || opcode === 0x00) {
        fragments.push(payload);
        if (fin) {
          const fullPayload = Buffer.concat(fragments);
          fragments = [];
          callbacks.onMessage?.(fullPayload.toString("utf8"));
        }
      }
    }
  };

  socket.on("data", (chunk) => {
    recvBuffer = recvBuffer.length === 0 ? chunk : Buffer.concat([recvBuffer, chunk]);
    processBuffer();
  });

  const handleSocketEnd = () => {
    if (!closed) {
      closed = true;
      callbacks.onClose?.();
    }
  };

  socket.on("close", handleSocketEnd);
  socket.on("end", handleSocketEnd);
  socket.on("error", handleSocketEnd);

  if (recvBuffer.length > 0) {
    processBuffer();
  }

  return {
    send: sendText,
    close: sendClose,
  };
}

