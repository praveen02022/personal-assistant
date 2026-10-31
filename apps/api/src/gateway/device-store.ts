import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Persists this API's Gateway device identity (Ed25519) and the device token the
 * Gateway issues after pairing. File-backed (0700 dir, 0600 files) for local/VM
 * deployments; swap for a secret-manager implementation without touching callers.
 */
export type DeviceIdentity = { deviceId: string; publicKeyPem: string; privateKeyPem: string };
type TokenRecord = { token: string; scopes: string[] };

const ED25519_SPKI_PREFIX_LEN = 12; // DER SPKI header before the 32-byte raw Ed25519 key
const b64url = (b: Buffer) => b.toString("base64url");

export function rawPublicKey(publicKeyPem: string): Buffer {
  return crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" }).subarray(ED25519_SPKI_PREFIX_LEN);
}
export const publicKeyRawBase64Url = (pem: string) => b64url(rawPublicKey(pem));
export const signPayload = (privateKeyPem: string, payload: string) =>
  b64url(crypto.sign(null, Buffer.from(payload, "utf8"), crypto.createPrivateKey(privateKeyPem)));

export class FileDeviceStore {
  private readonly identityFile: string;
  private readonly tokenFile: string;

  constructor(dir: string) {
    const abs = path.resolve(dir);
    fs.mkdirSync(abs, { recursive: true, mode: 0o700 });
    this.identityFile = path.join(abs, "device-identity.json");
    this.tokenFile = path.join(abs, "device-token.json");
  }

  loadOrCreateIdentity(): DeviceIdentity {
    if (fs.existsSync(this.identityFile)) return JSON.parse(fs.readFileSync(this.identityFile, "utf8")) as DeviceIdentity;
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    // Gateway convention: deviceId = sha256(raw public key), hex.
    const deviceId = crypto.createHash("sha256").update(rawPublicKey(publicKeyPem)).digest("hex");
    const identity = { deviceId, publicKeyPem, privateKeyPem };
    fs.writeFileSync(this.identityFile, JSON.stringify(identity), { mode: 0o600, flag: "wx" });
    return identity;
  }

  private readAll(): Record<string, TokenRecord> {
    return fs.existsSync(this.tokenFile) ? (JSON.parse(fs.readFileSync(this.tokenFile, "utf8")) as Record<string, TokenRecord>) : {};
  }

  private writeAll(all: Record<string, TokenRecord>) {
    const tmp = `${this.tokenFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
    fs.renameSync(tmp, this.tokenFile); // atomic replace
  }

  loadToken(deviceId: string, role: string): TokenRecord | null {
    return this.readAll()[`${deviceId}:${role}`] ?? null;
  }

  /** Honors the client's optimistic-concurrency contract (expectedToken). */
  storeToken(deviceId: string, role: string, record: TokenRecord, expectedToken?: string | null) {
    const all = this.readAll();
    const key = `${deviceId}:${role}`;
    const current = all[key]?.token;
    if (expectedToken === null && current !== undefined) return;
    if (typeof expectedToken === "string" && current !== expectedToken) return;
    all[key] = record;
    this.writeAll(all);
  }

  clearToken(deviceId: string, role: string, expectedToken?: string) {
    const all = this.readAll();
    const key = `${deviceId}:${role}`;
    if (expectedToken !== undefined && all[key]?.token !== expectedToken) return;
    delete all[key];
    this.writeAll(all);
  }
}
