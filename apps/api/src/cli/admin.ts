import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, asc, eq, sql } from "drizzle-orm";
import db, { getDatabasePool } from "../database";
import { accountTable, sessionTable, userTable } from "../database/schema";
import {
  type InstanceAuditAction,
  recordInstanceAudit,
} from "../instance-admin/audit";
import {
  activeInstanceAdmin,
  INSTANCE_ADMIN_LOCK_ID,
} from "../utils/instance-admins";
import { nonAnonymousUser } from "../utils/instance-bootstrap";
import { checkNewPassword } from "../utils/password-policy";

// Offline recovery for instance admins. It talks to the database directly
// and needs no running server, SMTP or session, so it bypasses sign-in by
// design: whoever can run it already has shell and database access.
//
//   node apps/api/dist/cli/admin.js <command> [email]
//   (development: pnpm --filter @margaya/api admin <command> [email])

const USAGE = `Margaya admin recovery

Usage: margaya-admin <command> [email]

Commands:
  list-admins            List instance admins
  promote-admin <email>  Make an existing account an instance admin
  demote-admin <email>   Make an instance admin a regular account (never the last one)
  reset-password <email> Set a new password and sign the account out everywhere.
                         Uses MARGAYA_NEW_PASSWORD when set, otherwise prints a
                         generated one.
  unban-user <email>     Lift a ban so the account can sign in again
`;

class CliError extends Error {}

const CLI_ACTOR = { system: true, name: "Recovery CLI" } as const;

async function findUser(email: string | undefined) {
  if (!email?.trim()) throw new CliError("An email address is required.");
  const [user] = await db
    .select({
      id: userTable.id,
      email: userTable.email,
      name: userTable.name,
      role: userTable.role,
      banned: userTable.banned,
    })
    .from(userTable)
    .where(
      and(
        sql`lower(${userTable.email}) = ${email.trim().toLowerCase()}`,
        nonAnonymousUser,
      ),
    )
    .limit(1);
  if (!user) throw new CliError(`No account uses ${email.trim()}.`);
  return user;
}

async function audit(
  action: InstanceAuditAction,
  user: { id: string; email: string },
) {
  await recordInstanceAudit({
    action,
    target: { type: "user", id: user.id, label: user.email },
    actor: CLI_ACTOR,
  });
}

async function listAdmins() {
  const admins = await db
    .select({
      email: userTable.email,
      name: userTable.name,
      banned: userTable.banned,
    })
    .from(userTable)
    .where(and(eq(userTable.role, "admin"), nonAnonymousUser))
    .orderBy(asc(userTable.email));
  if (admins.length === 0) {
    console.log("No instance admins. Use promote-admin <email>.");
    return;
  }
  for (const admin of admins) {
    console.log(
      `${admin.email}\t${admin.name}${admin.banned ? "\t(banned)" : ""}`,
    );
  }
}

async function promoteAdmin(email: string | undefined) {
  const user = await findUser(email);
  if (user.role === "admin") {
    console.log(`${user.email} is already an instance admin.`);
    return;
  }
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${INSTANCE_ADMIN_LOCK_ID})`,
    );
    await tx
      .update(userTable)
      .set({ role: "admin" })
      .where(eq(userTable.id, user.id));
  });
  await audit("cli.admin_promoted", user);
  console.log(`${user.email} is now an instance admin.`);
}

async function demoteAdmin(email: string | undefined) {
  const user = await findUser(email);
  if (user.role !== "admin") {
    throw new CliError(`${user.email} isn't an instance admin.`);
  }
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${INSTANCE_ADMIN_LOCK_ID})`,
    );
    const others = await tx
      .select({ id: userTable.id })
      .from(userTable)
      .where(and(activeInstanceAdmin, sql`${userTable.id} <> ${user.id}`))
      .limit(1);
    if (others.length === 0) {
      throw new CliError("There must be at least one instance admin.");
    }
    await tx
      .update(userTable)
      .set({ role: "user" })
      .where(eq(userTable.id, user.id));
  });
  await audit("cli.admin_demoted", user);
  console.log(`${user.email} is no longer an instance admin.`);
}

function generatedPassword() {
  // 24 characters from a URL-safe alphabet: about 144 bits.
  return randomBytes(18).toString("base64url");
}

async function resetPassword(email: string | undefined) {
  const user = await findUser(email);
  const supplied = process.env.MARGAYA_NEW_PASSWORD;
  const password = supplied || generatedPassword();
  const violation = checkNewPassword(password, { email: user.email });
  if (violation) throw new CliError(violation.message);

  const hash = await bcrypt.hash(password, 10);
  await db.transaction(async (tx) => {
    const [credential] = await tx
      .select({ id: accountTable.id })
      .from(accountTable)
      .where(
        and(
          eq(accountTable.userId, user.id),
          eq(accountTable.providerId, "credential"),
        ),
      )
      .limit(1);
    if (credential) {
      await tx
        .update(accountTable)
        .set({ password: hash, updatedAt: new Date() })
        .where(eq(accountTable.id, credential.id));
    } else {
      await tx.insert(accountTable).values({
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: hash,
        updatedAt: new Date(),
      });
    }
    await tx.delete(sessionTable).where(eq(sessionTable.userId, user.id));
  });
  await audit("cli.password_reset", user);
  console.log(`Password set for ${user.email}; every session was signed out.`);
  if (!supplied) {
    console.log("New password (shown once, change it after signing in):");
    console.log(password);
  }
}

async function unbanUser(email: string | undefined) {
  const user = await findUser(email);
  await db
    .update(userTable)
    .set({ banned: false, banReason: null, banExpires: null })
    .where(eq(userTable.id, user.id));
  await audit("cli.user_unbanned", user);
  console.log(`${user.email} can sign in again.`);
}

const COMMANDS: Record<string, (email?: string) => Promise<void>> = {
  "list-admins": listAdmins,
  "promote-admin": promoteAdmin,
  "demote-admin": demoteAdmin,
  "reset-password": resetPassword,
  "unban-user": unbanUser,
};

export async function runAdminCli(argv: string[]): Promise<number> {
  const [command, email] = argv;
  const run = command ? COMMANDS[command] : undefined;
  if (!run) {
    console.log(USAGE);
    return command && command !== "help" && command !== "--help" ? 1 : 0;
  }
  try {
    await run(email);
    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

const isEntrypoint = process.argv[1]
  ? /[\\/]cli[\\/]admin\.(?:ts|js|mjs)$/.test(process.argv[1])
  : false;

if (isEntrypoint) {
  runAdminCli(process.argv.slice(2))
    .then(async (code) => {
      await getDatabasePool().end();
      process.exit(code);
    })
    .catch(async (error) => {
      console.error(error);
      await getDatabasePool()
        .end()
        .catch(() => {});
      process.exit(1);
    });
}
