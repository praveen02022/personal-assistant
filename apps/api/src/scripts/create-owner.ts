/**
 * Creates the single owner account (or resets its password with --reset-password).
 *   OWNER_EMAIL=... OWNER_NAME=... OWNER_PASSWORD=... pnpm --filter @personalos/api owner:create
 * The password is read from the environment, never from argv (argv shows up in `ps` and shell history).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../auth/crypto.js";
import { PrismaClient } from "../generated/prisma/client.js";

const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
const displayName = process.env.OWNER_NAME?.trim() || "Owner";
const password = process.env.OWNER_PASSWORD;
const reset = process.argv.includes("--reset-password");

if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error("OWNER_EMAIL is required");
if (!password || password.length < 12) throw new Error("OWNER_PASSWORD must be at least 12 characters");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
try {
  const existing = await prisma.user.findUnique({ where: { email } });
  const others = await prisma.user.count({ where: { email: { not: email } } });
  if (others > 0) throw new Error("A different owner already exists. PersonalOS is single-user for now.");
  if (existing && !reset) throw new Error("Owner exists. Use --reset-password to change the password.");

  const passwordHash = await hashPassword(password);
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { passwordHash } });
    await prisma.authSession.deleteMany({ where: { userId: existing.id } }); // revoke all sessions
    console.log(`Password reset for ${email}; all sessions revoked.`);
  } else {
    const user = await prisma.user.create({ data: { email, displayName, passwordHash, preference: { create: {} } } });
    await prisma.auditLog.create({ data: { userId: user.id, action: "user.owner_created", resourceType: "user", resourceId: user.id } });
    console.log(`Owner created: ${email}`);
  }
} finally {
  await prisma.$disconnect();
}
