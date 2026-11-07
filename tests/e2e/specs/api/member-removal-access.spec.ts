import { expect, test } from "../../fixtures";
import {
  addMember,
  createWorkspace,
  expectJson,
  expectStatus,
  headerContext,
  signUpUser,
} from "../../helpers/api-kit";

// What removing someone does to their sessions and API keys. Everything runs
// on fresh accounts and workspaces this file creates.

async function createKey(user: Awaited<ReturnType<typeof signUpUser>>) {
  const created = await expectJson<{ key: string }>(
    await user.ctx.post("/api/api-key", {
      data: { name: "Removal key", expiresIn: null, access: "full" },
    }),
  );
  return headerContext({ "x-api-key": created.key });
}

test("removal from someone's only workspace ends their session and keys", async () => {
  const owner = await signUpUser("Removal owner");
  const person = await signUpUser("Removal person");
  const workspace = await createWorkspace(owner.ctx);
  await addMember(owner.ctx, workspace.id, person, "member");
  const viaKey = await createKey(person);
  const params = { workspaceId: workspace.id };
  await expectJson(await viaKey.get("/api/project", { params }));

  await expectJson(
    await owner.ctx.post("/api/auth/organization/remove-member", {
      data: { memberIdOrEmail: person.email, organizationId: workspace.id },
    }),
  );

  await expectStatus(await person.ctx.get("/api/project", { params }), 401);
  await expectStatus(await viaKey.get("/api/project", { params }), 401);
  expect(
    await (await person.ctx.get("/api/auth/get-session")).json(),
  ).toBeNull();

  // The account itself is untouched: they can sign in and start again.
  await expectJson(
    await person.ctx.post("/api/auth/sign-in/email", {
      data: { email: person.email, password: person.password },
    }),
  );
  await expectStatus(await person.ctx.get("/api/project", { params }), 403);

  await Promise.all([
    owner.ctx.dispose(),
    person.ctx.dispose(),
    viaKey.dispose(),
  ]);
});

test("removal keeps what still reaches another workspace", async () => {
  const owner = await signUpUser("Removal owner two");
  const person = await signUpUser("Removal person two");
  const removedFrom = await createWorkspace(owner.ctx, "Removed from");
  const stays = await createWorkspace(owner.ctx, "Stays in");
  await addMember(owner.ctx, removedFrom.id, person, "member");
  await addMember(owner.ctx, stays.id, person, "member");
  const viaKey = await createKey(person);

  await expectJson(
    await owner.ctx.post("/api/auth/organization/remove-member", {
      data: { memberIdOrEmail: person.email, organizationId: removedFrom.id },
    }),
  );

  for (const ctx of [person.ctx, viaKey]) {
    await expectStatus(
      await ctx.get("/api/project", {
        params: { workspaceId: removedFrom.id },
      }),
      403,
    );
    await expectJson(
      await ctx.get("/api/project", { params: { workspaceId: stays.id } }),
    );
  }

  await Promise.all([
    owner.ctx.dispose(),
    person.ctx.dispose(),
    viaKey.dispose(),
  ]);
});
