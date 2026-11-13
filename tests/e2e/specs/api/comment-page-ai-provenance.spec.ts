import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  expectStatus,
  type Json,
  type Project,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// Reading a long discussion one page at a time, and the AI-generated label a
// page carries after someone accepts AI-written text in the live editor. The
// label is recorded without calling a model, so it works with AI off.

type Comment = {
  id: string;
  taskId: string;
  userId: string | null;
  content: string;
  parentId: string | null;
  createdAt: string;
};
type CommentPage = { items: Comment[]; nextCursor: string | null };
type AiProvenance = {
  source: "assist" | "agent";
  feature: string | null;
  model: string | null;
  agentId: string | null;
  agentName: string | null;
  requestedById: string | null;
  generatedAt: string;
  editedById: string | null;
  editedByName: string | null;
  editedAt: string | null;
};
type Page = Json & { title: string; aiProvenance: AiProvenance | null };

let world: World;
let project: Project;
let otherWorld: World;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Comment paging");
  project = await createProject(world.as("owner"), world.workspace.id);
  otherWorld = await createWorld("Comment paging other");
});

test.afterAll(async () => {
  await world?.dispose();
  await otherWorld?.dispose();
});

test(
  "task comments page oldest first with a cursor, threads included",
  covers("getTaskCommentPage"),
  async () => {
    const member = world.as("member");
    const task = await createTask(member, project.id);
    const posted: Comment[] = [];
    for (const content of ["First", "Second", "Third"]) {
      posted.push(
        await expectJson<Comment>(
          await member.post(`/api/comment/${task.id}`, {
            data: { content: `${content} ${uniqueName("note")}` },
          }),
        ),
      );
    }
    const reply = await expectJson<Comment>(
      await world.as("admin").post(`/api/comment/${task.id}`, {
        data: { content: "A reply", parentId: posted[0]?.id },
      }),
    );
    const expected = [...posted.map((comment) => comment.id), reply.id];

    // Viewers read too.
    const viewer = world.as("viewer");
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: CommentPage = await expectJson<CommentPage>(
        await viewer.get(`/api/comment/${task.id}/page`, {
          params: cursor ? { limit: "3", cursor } : { limit: "3" },
        }),
      );
      expect(page.items.length).toBeLessThanOrEqual(3);
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 5);
    expect(pages).toBe(2);
    expect(ids).toEqual(expected);

    // The default page holds them all, and matches the unpaged list.
    const whole = await expectJson<CommentPage>(
      await viewer.get(`/api/comment/${task.id}/page`),
    );
    expect(whole.nextCursor).toBeNull();
    expect(whole.items.map((item) => item.id)).toEqual(expected);
    expect(whole.items[3]).toMatchObject({
      taskId: task.id,
      parentId: posted[0]?.id,
      content: "A reply",
      userId: world.users.admin.id,
    });
    const unpaged = await expectJson<Comment[]>(
      await viewer.get(`/api/comment/${task.id}`),
    );
    expect(new Set(unpaged.map((item) => item.id))).toEqual(new Set(expected));

    // An exact fit ends without a cursor.
    const exact = await expectJson<CommentPage>(
      await viewer.get(`/api/comment/${task.id}/page`, {
        params: { limit: "4" },
      }),
    );
    expect(exact.items).toHaveLength(4);
    expect(exact.nextCursor).toBeNull();

    for (const params of <Record<string, string>[]>[
      { limit: "0" },
      { limit: "101" },
      { limit: "ten" },
      { cursor: "not-a-cursor" },
      {
        cursor: Buffer.from(JSON.stringify(["yesterday", "x"])).toString(
          "base64url",
        ),
      },
    ]) {
      await expectStatus(
        await viewer.get(`/api/comment/${task.id}/page`, { params }),
        400,
      );
    }
    await expectStatus(
      await world.as("anonymous").get(`/api/comment/${task.id}/page`),
      401,
    );
    await expectStatus(
      await otherWorld.as("owner").get(`/api/comment/${task.id}/page`),
      [403, 404],
    );
    await expectStatus(
      await viewer.get("/api/comment/e2e-no-such-task/page"),
      404,
    );
  },
);

test(
  "a page is labelled AI-generated; a later edit names the person",
  covers("markPageAiGenerated"),
  async () => {
    const member = world.as("member");
    const page = await expectJson<Page>(
      await member.post(`/api/page/project/${project.id}`, {
        data: { title: uniqueName("AI page"), content: "Draft." },
      }),
    );
    expect(page.aiProvenance).toBeNull();

    const before = Date.now();
    const marked = await expectJson<{ aiProvenance: AiProvenance }>(
      await member.post(`/api/page/${page.id}/ai-provenance`, {
        data: { feature: "editor_assist" },
      }),
    );
    expect(marked.aiProvenance).toMatchObject({
      source: "assist",
      feature: "editor_assist",
      agentId: null,
      requestedById: world.users.member.id,
      editedById: null,
    });
    expect(new Date(marked.aiProvenance.generatedAt).getTime()).toBeGreaterThan(
      before - 60_000,
    );
    const read = await expectJson<Page>(
      await world.as("viewer").get(`/api/page/${page.id}`),
    );
    expect(read.aiProvenance).toEqual(marked.aiProvenance);

    for (const data of [
      {},
      { feature: "made_up_feature" },
      { feature: "summarize", model: "anything" },
    ]) {
      await expectStatus(
        await member.post(`/api/page/${page.id}/ai-provenance`, { data }),
        400,
      );
    }
    await expectStatus(
      await world.as("viewer").post(`/api/page/${page.id}/ai-provenance`, {
        data: { feature: "summarize" },
      }),
      403,
    );
    await expectStatus(
      await world.as("anonymous").post(`/api/page/${page.id}/ai-provenance`, {
        data: { feature: "summarize" },
      }),
      401,
    );
    await expectStatus(
      await otherWorld.as("owner").post(`/api/page/${page.id}/ai-provenance`, {
        data: { feature: "summarize" },
      }),
      [403, 404],
    );
    await expectStatus(
      await member.post("/api/page/e2e-no-such-page/ai-provenance", {
        data: { feature: "summarize" },
      }),
      404,
    );

    // A locked page takes no edits, labelled or not.
    await expectJson(await member.post(`/api/page/${page.id}/lock`));
    await expectStatus(
      await member.post(`/api/page/${page.id}/ai-provenance`, {
        data: { feature: "summarize" },
      }),
      409,
    );
    await expectJson(await member.delete(`/api/page/${page.id}/lock`));

    // A save right after the label (15-second grace) is part of the AI
    // write: the label stays as it was.
    await expectJson(
      await member.put(`/api/page/${page.id}/content`, {
        data: { markdown: "Draft, as the assistant wrote it." },
      }),
    );
    expect(
      (await expectJson<Page>(await member.get(`/api/page/${page.id}`)))
        .aiProvenance,
    ).toEqual(marked.aiProvenance);

    // After that, a person's edit keeps the label and names them.
    const graceEnds =
      new Date(marked.aiProvenance.generatedAt).getTime() + 15_500;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, graceEnds - Date.now())),
    );
    await expectJson(
      await world.as("admin").put(`/api/page/${page.id}/content`, {
        data: { markdown: "Draft, reviewed by a person." },
      }),
    );
    const edited = await expectJson<Page>(
      await member.get(`/api/page/${page.id}`),
    );
    expect(edited.aiProvenance).toMatchObject({
      source: "assist",
      feature: "editor_assist",
      requestedById: world.users.member.id,
      editedById: world.users.admin.id,
      editedByName: world.users.admin.name,
    });

    // Labelling again starts a fresh generation by the new caller.
    const again = await expectJson<{ aiProvenance: AiProvenance }>(
      await world.as("admin").post(`/api/page/${page.id}/ai-provenance`, {
        data: { feature: "summarize" },
      }),
    );
    expect(again.aiProvenance).toMatchObject({
      feature: "summarize",
      requestedById: world.users.admin.id,
      editedById: null,
    });
  },
);
