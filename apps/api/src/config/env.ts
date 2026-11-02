import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/** Validated, typed environment. The process refuses to start on invalid config. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  WEB_ORIGIN: z.url(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(168),
  COOKIE_SECURE: z.stringbool().default(true),
  OPENCLAW_GATEWAY_URL: z.string().regex(/^wss?:\/\//),
  /** Bootstrap credential, used only until this API's device is paired and holds a device token. */
  OPENCLAW_GATEWAY_TOKEN: z.string().min(16).optional(),
  OPENCLAW_GATEWAY_TOKEN_FILE: z.string().optional(),
  OPENCLAW_AGENT_ID: z.string().regex(/^[a-z0-9-]+$/).default("personalos"),
  OPENCLAW_DEVICE_DIR: z.string().min(1),
  /** Azure Speech (STT + TTS). Optional: voice endpoints report VOICE_UNAVAILABLE without them. */
  AZURE_SPEECH_KEY: z.string().min(16).optional(),
  AZURE_SPEECH_REGION: z.string().regex(/^[a-z0-9]+$/).optional(),
  /** Integration credential vault (AES-256-GCM). Base64 of exactly 32 bytes. */
  CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be base64 of 32 bytes")
    .optional(),
  CREDENTIAL_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  /** Microsoft 365 calendar (Entra app registration). Optional: the integration is hidden without them. */
  MS_TENANT_ID: z.string().min(1).optional(),
  MS_CLIENT_ID: z.guid().optional(), // Entra application (client) ID
  MS_CLIENT_SECRET: z.string().min(8).optional(),
  MS_REDIRECT_URI: z.url().optional(),
  /** Hard ceiling for one agent run before the sweeper aborts it. */
  TASK_MAX_RUNTIME_SECONDS: z.coerce.number().int().min(30).default(900),
});

export type Env = z.infer<typeof EnvSchema> & { gatewayToken: string | undefined };

export const ENV = Symbol("ENV");

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  const env = parsed.data;
  return { ...env, gatewayToken: env.OPENCLAW_GATEWAY_TOKEN ?? readTokenFile(env.OPENCLAW_GATEWAY_TOKEN_FILE) };
}

/** Reads OPENCLAW_GATEWAY_TOKEN=... from a dotenv-style file without exporting it to process.env. */
function readTokenFile(file: string | undefined): string | undefined {
  if (!file) return undefined;
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) return undefined;
  const match = fs.readFileSync(resolved, "utf8").match(/^OPENCLAW_GATEWAY_TOKEN=(.+)$/m);
  return match?.[1]?.trim();
}
