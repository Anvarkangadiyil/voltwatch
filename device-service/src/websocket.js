'use strict';

// Minimal RFC 6455 server helpers: handshake, unfragmented text frames out,
// frame parsing in. Enough for a telemetry push channel without pulling in a
// dependency on a constrained device.

const crypto = require('node:crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') return false;
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setNoDelay(true);
  return true;
}

function encodeTextFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Parses as many complete (client-masked) frames as the buffer holds. */
function decodeFrames(buf) {
  const frames = [];
  let offset = 0;
  while (buf.length - offset >= 2) {
    const opcode = buf[offset] & 0x0f;
    const masked = (buf[offset + 1] & 0x80) !== 0;
    let len = buf[offset + 1] & 0x7f;
    let pos = offset + 2;
    if (len === 126) {
      if (buf.length < pos + 2) break;
      len = buf.readUInt16BE(pos);
      pos += 2;
    } else if (len === 127) {
      if (buf.length < pos + 8) break;
      len = Number(buf.readBigUInt64BE(pos));
      pos += 8;
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length < pos + maskLen + len) break;
    const payload = Buffer.from(buf.subarray(pos + maskLen, pos + maskLen + len));
    if (masked) {
      const mask = buf.subarray(pos, pos + 4);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }
    frames.push({ opcode, payload });
    offset = pos + maskLen + len;
  }
  return { frames, rest: buf.subarray(offset) };
}

module.exports = { acceptUpgrade, encodeTextFrame, decodeFrames };
