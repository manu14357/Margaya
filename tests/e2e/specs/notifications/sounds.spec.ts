import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  eventually,
  expectJson,
  type Project,
  type World,
} from "../../helpers/api-kit";
import {
  browserContextFor,
  listNotifications,
  mention,
  openApp,
  UI_TIMEOUT,
  waitForNotification,
} from "../../helpers/notifications";
import { uniqueName } from "../../helpers/ui";

// Notification sounds in the browser: a stand-in AudioContext records every
// sound the app schedules (its first note's pitch tells which sound it is),
// so the spec checks what plays without speakers.

type Played = { volume: number; freqs: number[] };

const CHIME = 880;
const BELL = 784;

let world: World;
let project: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Sounds");
  project = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

function recordSounds(context: BrowserContext) {
  return context.addInitScript(() => {
    const played: { volume: number; freqs: number[] }[] = [];
    (window as unknown as { __sounds: typeof played }).__sounds = played;
    class Param {
      value = 0;
      constructor(private onSet?: (value: number) => void) {}
      setValueAtTime(value: number) {
        this.onSet?.(value);
      }
      linearRampToValueAtTime() {}
      exponentialRampToValueAtTime() {}
    }
    class FakeContext {
      state = "suspended";
      currentTime = 0;
      destination = {};
      resume() {
        this.state = "running";
        return Promise.resolve();
      }
      createGain() {
        const context = this;
        return {
          gain: new Param(),
          connect(target: unknown) {
            // The master gain of a new sound connects to the speakers.
            if (target === context.destination) {
              played.push({ volume: this.gain.value, freqs: [] });
            }
          },
        };
      }
      createOscillator() {
        return {
          type: "sine",
          frequency: new Param((value) => {
            const sound = played[played.length - 1];
            if (sound && sound.freqs.length < 8) sound.freqs.push(value);
          }),
          connect() {},
          start() {},
          stop() {},
        };
      }
    }
    Object.defineProperty(window, "AudioContext", { value: FakeContext });
  });
}

const sounds = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __sounds: Played[] }).__sounds.slice(),
  );

/** Opens the app as the member, with audio started by a key press. */
async function memberPage(browser: Browser, path: string) {
  const context = await browserContextFor(browser, world.users.member);
  await recordSounds(context);
  const page = await context.newPage();
  const userSocket = page.waitForEvent("websocket", {
    predicate: (ws) => ws.url().includes("/ws/user"),
    timeout: UI_TIMEOUT,
  });
  await openApp(page, path);
  await userSocket;
  // Let the socket finish opening before anything is sent to it.
  await page.waitForTimeout(1_000);
  // Browsers start audio only after a gesture; any key press counts.
  await page.keyboard.press("Shift");
  return { context, page };
}

async function mentionMember(taskId: string) {
  const before = (await listNotifications(world.as("member"))).length;
  await expectJson(
    await world.as("owner").post(`/api/comment/${taskId}`, {
      data: { content: `<p>${mention(world.users.member)} have a look</p>` },
    }),
  );
  await eventually(
    async () =>
      (await listNotifications(world.as("member"))).length > before ||
      undefined,
    { timeoutMs: 20_000, intervalMs: 250, what: "the member's mention" },
  );
}

/** Lets a later notification play: one sound per 4 s burst. */
const pastBurst = (page: Page) => page.waitForTimeout(4_500);

test("a mention plays the mention sound, once per burst; other updates stay silent", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const task = await createTask(world.as("owner"), project.id, {
    title: uniqueName("Sound check"),
    assigneeIds: [world.users.member.id],
  });
  const { context, page } = await memberPage(browser, "/dashboard");
  try {
    await mentionMember(task.id);
    await expect.poll(() => sounds(page), { timeout: 30_000 }).toHaveLength(1);
    const [first] = await sounds(page);
    expect(first?.freqs[0]).toBe(CHIME);
    // Volume 70 by default, on a squared curve.
    expect(first?.volume).toBeCloseTo(0.245);

    // A second mention right away is part of the same burst.
    await mentionMember(task.id);
    await page.waitForTimeout(1_500);
    expect(await sounds(page)).toHaveLength(1);

    // A status change is "Everything else", silent by default.
    await pastBurst(page);
    await expectJson(
      await world.as("owner").put(`/api/task/status/${task.id}`, {
        data: { status: "in-progress" },
      }),
    );
    await waitForNotification(
      world.as("member"),
      (entry) =>
        entry.resourceId === task.id && entry.type === "task_status_changed",
      "the status change",
    );
    await page.waitForTimeout(1_500);
    expect(await sounds(page)).toHaveLength(1);

    // The next mention after the burst plays again.
    await mentionMember(task.id);
    await expect.poll(() => sounds(page), { timeout: 30_000 }).toHaveLength(2);
  } finally {
    await context.close();
  }
});

test("a sound chosen in settings is previewed, saved to the account and used; muting this device silences it", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const task = await createTask(world.as("owner"), project.id, {
    title: uniqueName("Sound settings"),
  });
  const { context, page } = await memberPage(
    browser,
    "/dashboard/settings/account/notifications",
  );
  try {
    await expect(
      page.getByRole("heading", { name: "Sounds", exact: true }),
    ).toBeVisible({ timeout: UI_TIMEOUT });

    // Choosing a sound previews it.
    await page
      .getByRole("combobox", { name: "Mentions and assignments" })
      .click();
    await page.getByRole("option", { name: "Soft bell" }).click();
    await expect.poll(() => sounds(page)).toHaveLength(1);
    expect((await sounds(page))[0]?.freqs[0]).toBe(BELL);

    // The play button previews the current choice.
    await page.getByRole("button", { name: "Play Soft bell" }).click();
    await expect.poll(() => sounds(page)).toHaveLength(2);

    // Saved to the account, so other browsers get it.
    await eventually(
      async () => {
        const body = await expectJson<{
          preferences: { notificationSound?: { mentions: string } } | null;
        }>(await world.as("member").get("/api/user/preferences"));
        return body.preferences?.notificationSound?.mentions === "bell"
          ? true
          : undefined;
      },
      { timeoutMs: 15_000, intervalMs: 300, what: "the saved sound" },
    );

    // A mention now rings the bell.
    await pastBurst(page);
    await mentionMember(task.id);
    await expect.poll(() => sounds(page), { timeout: 30_000 }).toHaveLength(3);
    expect((await sounds(page))[2]?.freqs[0]).toBe(BELL);

    // Muted on this device: silence, and the account setting is untouched.
    await page
      .getByRole("switch", { name: "Mute sounds on this device" })
      .click();
    await pastBurst(page);
    await mentionMember(task.id);
    await page.waitForTimeout(2_000);
    expect(await sounds(page)).toHaveLength(3);
    const after = await expectJson<{
      preferences: { notificationSound?: { enabled: boolean } } | null;
    }>(await world.as("member").get("/api/user/preferences"));
    expect(after.preferences?.notificationSound?.enabled).toBe(true);
  } finally {
    await context.close();
  }
});
