import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";

/**
 * Argon2id with OWASP's baseline parameters (19 MiB, t=2, p=1). The PHC string
 * stores algorithm, parameters and salt, so parameters can be raised later and
 * old hashes still verify (and can be rehashed on next login).
 */
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => argon2.hash(password, ARGON2_OPTIONS);

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** Precomputed hash used when the email is unknown, so both paths cost one Argon2 verify. */
let dummyHash: Promise<string> | undefined;
export const timingSafeDummyVerify = async (password: string) => {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(await dummyHash, password);
};

/** 256-bit opaque session token for the cookie. */
export const newSessionToken = () => randomBytes(32).toString("base64url");

/** Only the SHA-256 of the token is stored: a database leak does not yield usable cookies. */
export const hashSessionToken = (token: string) => createHash("sha256").update(token).digest("hex");
