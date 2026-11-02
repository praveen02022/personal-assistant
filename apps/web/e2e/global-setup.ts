import fs from "node:fs";
import path from "node:path";
import { request } from "@playwright/test";

/** Logs in once per run (the API allows 5 logins/minute) and saves the session for all tests. */
export const STORAGE_STATE = path.join(import.meta.dirname, ".auth", "owner.json");

export default async function globalSetup() {
  const password = fs.readFileSync(path.resolve(import.meta.dirname, "../../../.secrets/owner-password.txt"), "utf8").trim();
  const ctx = await request.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" });
  const res = await ctx.post("/api/auth/login", { data: { email: "kalam@madhifoundation.org", password }, headers: { Origin: "http://localhost:3000" } });
  if (res.status() !== 204) throw new Error(`e2e login failed: ${res.status()} ${await res.text()}`);
  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true, mode: 0o700 });
  await ctx.storageState({ path: STORAGE_STATE });
  fs.chmodSync(STORAGE_STATE, 0o600);
  await ctx.dispose();
}
