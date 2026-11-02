/**
 * Mints the credential an OpenClaw Gateway uses to call PersonalOS tools (MCP), for the owner.
 *   pnpm --filter @personalos/api agent-token:create [--scopes calendar:read] [--revoke-others]
 * Prints the token ONCE (stdout). Only its SHA-256 is stored. Put it in infra/openclaw/.env as
 * PERSONALOS_MCP_TOKEN; OpenClaw passes it to the MCP bridge through an env SecretRef.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { hashAgentToken, newAgentToken } from "../mcp/agent-token.js";

const scopesArg = process.argv.indexOf("--scopes");
const scopes = scopesArg > 0 ? (process.argv[scopesArg + 1] ?? "").split(",").filter(Boolean) : ["calendar:read"];
const ALLOWED = new Set(["calendar:read"]);
if (!scopes.length || scopes.some((s) => !ALLOWED.has(s))) throw new Error(`scopes must be from: ${[...ALLOWED].join(", ")}`);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
try {
  const owner = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  if (process.argv.includes("--revoke-others")) {
    const { count } = await prisma.agentAccessToken.updateMany({ where: { userId: owner.id, revokedAt: null }, data: { revokedAt: new Date() } });
    console.error(`revoked ${count} previous token(s)`);
  }
  const token = newAgentToken();
  await prisma.agentAccessToken.create({ data: { userId: owner.id, name: "openclaw-gateway", tokenHash: hashAgentToken(token), scopes } });
  await prisma.auditLog.create({ data: { userId: owner.id, action: "agent_token.created", resourceType: "agent_token", metadata: { scopes } } });
  process.stdout.write(token);
} finally {
  await prisma.$disconnect();
}
