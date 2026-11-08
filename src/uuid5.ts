/**
 * A name-based UUID (RFC 4122 version 5): the same name in the same namespace is always the same id, on every device. It is what lets two devices
 * that each make "the book" (DESIGN.md §5.3) or "the next occurrence" (§8.2) make the same row, which then arrives once.
 *
 * SHA-1 is written out here, synchronously, since the actions that need it are pure functions and WebCrypto's digest is not synchronous. It is used as
 * RFC 4122 uses it, to make an id from a name, and for nothing a collision or a forgery would matter to: it is not a signature or a secret.
 */
export function uuid5(name: string, namespace: string): string {
  const space = bytesOfUuid(namespace);
  const body = new TextEncoder().encode(name);
  const message = new Uint8Array(space.length + body.length);
  message.set(space, 0);
  message.set(body, space.length);

  const hash = sha1(message).slice(0, 16);
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50; // version 5
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80; // the RFC variant
  const hex = [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** This app's own namespace: ids made from names here are not ids another app made from the same name. */
export const LEDGER_NAMESPACE = '3b8f6c52-1d4a-5e07-8a39-c2f57d9e1b04';

function bytesOfUuid(value: string): Uint8Array {
  const hex = value.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error('not a UUID');
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}

function sha1(message: Uint8Array): Uint8Array {
  const rotate = (value: number, bits: number) => ((value << bits) | (value >>> (32 - bits))) >>> 0;
  const length = message.length;
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(message, 0);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((length * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (length * 8) >>> 0);

  let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i++)
      w[i] = rotate((w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0), 1);
    let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) [f, k] = [(b & c) | (~b & d), 0x5a827999];
      else if (i < 40) [f, k] = [b ^ c ^ d, 0x6ed9eba1];
      else if (i < 60) [f, k] = [(b & c) | (b & d) | (c & d), 0x8f1bbcdc];
      else [f, k] = [b ^ c ^ d, 0xca62c1d6];
      const next = (rotate(a, 5) + (f >>> 0) + e + k + (w[i] ?? 0)) >>> 0;
      [a, b, c, d, e] = [next, a, rotate(b, 30), c, d];
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((word, i) => outView.setUint32(i * 4, word));
  return out;
}
