import { randomBytes } from "node:crypto";

/**
 * RFC 9562 UUIDv7: 48-bit Unix ms timestamp + random. Time-ordered, so B-tree
 * inserts stay append-mostly. Used where the app needs an id before INSERT
 * (e.g. to derive the OpenClaw session key from the conversation id).
 */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
