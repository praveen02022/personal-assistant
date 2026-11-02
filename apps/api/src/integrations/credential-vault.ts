import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";

export type Sealed = { keyVersion: number; iv: Uint8Array<ArrayBuffer>; authTag: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> };

/**
 * Encrypts provider credentials at rest with AES-256-GCM.
 *  - fresh 96-bit IV per encryption (never reused with the same key)
 *  - the GCM auth tag detects any tampering with ciphertext, IV or AAD
 *  - AAD binds a ciphertext to its record id, so rows can't be swapped between users
 *  - keyVersion is stored with each record; rotation = add a key, re-encrypt, retire the old one
 * Production: replace the env key with a KMS/Key Vault-wrapped data key; callers don't change.
 */
@Injectable()
export class CredentialVault {
  private readonly keys = new Map<number, Buffer>();
  private readonly currentVersion: number;

  constructor(@Inject(ENV) env: Env) {
    this.currentVersion = env.CREDENTIAL_KEY_VERSION;
    if (env.CREDENTIAL_ENCRYPTION_KEY) this.keys.set(env.CREDENTIAL_KEY_VERSION, Buffer.from(env.CREDENTIAL_ENCRYPTION_KEY, "base64"));
  }

  isConfigured() {
    return this.keys.has(this.currentVersion);
  }

  seal(plaintext: string, recordId: string): Sealed {
    const key = this.key(this.currentVersion);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(recordId, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return { keyVersion: this.currentVersion, iv: new Uint8Array(iv), authTag: new Uint8Array(cipher.getAuthTag()), ciphertext: new Uint8Array(ciphertext) };
  }

  open(sealed: { keyVersion: number; iv: Uint8Array; authTag: Uint8Array; ciphertext: Uint8Array }, recordId: string): string {
    const decipher = createDecipheriv("aes-256-gcm", this.key(sealed.keyVersion), sealed.iv);
    decipher.setAAD(Buffer.from(recordId, "utf8"));
    decipher.setAuthTag(sealed.authTag);
    return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8"); // throws if tampered
  }

  /** Compact string form for short-lived secrets stored in a text column (e.g. PKCE verifier). */
  sealToString(plaintext: string, recordId: string): string {
    const s = this.seal(plaintext, recordId);
    return [s.keyVersion, Buffer.from(s.iv).toString("base64url"), Buffer.from(s.authTag).toString("base64url"), Buffer.from(s.ciphertext).toString("base64url")].join(".");
  }

  openString(value: string, recordId: string): string {
    const [v, iv, tag, ct] = value.split(".");
    if (!v || !iv || !tag || !ct) throw new Error("malformed sealed value");
    return this.open({ keyVersion: Number(v), iv: Buffer.from(iv, "base64url"), authTag: Buffer.from(tag, "base64url"), ciphertext: Buffer.from(ct, "base64url") }, recordId);
  }

  private key(version: number) {
    const key = this.keys.get(version);
    if (!key) throw new Error(`credential key version ${version} is not available`);
    return key;
  }
}
