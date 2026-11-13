import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  createProject,
  createWorld,
  expectJson,
  expectStatus,
  type Project,
  type World,
} from "../../helpers/api-kit";
import { E2E_API_URL, E2E_WEB_URL } from "../../helpers/env";
import { createApiContext } from "../../helpers/http";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// Where intake requests come from besides the app: email (a forwarding
// address, sender filters and an optional project mailbox) and the public
// request form. On this instance there is no base intake address, no shared
// mailbox and no inbound webhook secret, so the forwarding address stays null
// and the inbound webhook answers 404. The mailbox test signs in to a closed
// local port, which fails at once without any network.

type EmailSettings = {
  projectId: string;
  enabled: boolean;
  address: string | null;
  instance: { address: boolean; mailbox: boolean; webhook: boolean };
  allowedDomains: string[];
  blockedDomains: string[];
  imap: {
    enabled: boolean;
    host: string | null;
    port: number | null;
    security: "tls" | "starttls";
    username: string | null;
    folder: string;
    hasPassword: boolean;
  };
  limits: {
    maxMessageBytes: number;
    maxAttachmentBytes: number;
    maxAttachments: number;
  };
  lastPolledAt: string | null;
  lastReceivedAt: string | null;
  lastError: string | null;
};
type FormSettings = {
  projectId: string;
  enabled: boolean;
  path: string | null;
  title: string | null;
  intro: string | null;
  descriptionField: "off" | "optional" | "required";
  emailField: "off" | "optional" | "required";
  nameField: "off" | "optional" | "required";
  customFieldIds: string[];
  confirmationMessage: string | null;
  publicSharingAllowed: boolean;
};
type PublicForm = {
  title: string | null;
  intro: string | null;
  fields: { description: string; email: string; name: string };
  customFields: unknown[];
  confirmationMessage: string | null;
};
type IntakePage = {
  items: { id: string; source: string; task?: { title?: string } }[];
};

const MAILBOX_PASSWORD = "e2e-mailbox-password-not-real";

let world: World;
let project: Project;
let anonymous: APIRequestContext;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Intake sources");
  project = await createProject(world.as("owner"), world.workspace.id);
  // A documentation address per run (the API trusts X-Forwarded-For from
  // loopback), so the public form's per-IP limits start fresh each run.
  const ip = `198.18.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;
  anonymous = await createApiContext({
    apiURL: E2E_API_URL,
    clientURL: E2E_WEB_URL,
    extraHTTPHeaders: { "X-Forwarded-For": ip },
  });
});

test.afterAll(async () => {
  await anonymous?.dispose();
  await world?.dispose();
});

const emailBase = () => `/api/intake-email/project/${project.id}`;
const formBase = () => `/api/intake-form/project/${project.id}`;

test("both settings stay closed until the Intake feature is on", async () => {
  const owner = world.as("owner");
  // Intake is off in a new project.
  await expectStatus(await owner.get(emailBase()), 403);
  await expectStatus(await owner.get(formBase()), 403);
  await expectJson(
    await owner.patch(`/api/project/${project.id}/features`, {
      data: { intakeEnabled: true },
    }),
  );
});

test(
  "email intake: settings for sharers, filters, mailbox and a new address",
  covers(
    "getIntakeEmailSettings",
    "updateIntakeEmailSettings",
    "rotateIntakeEmailAddress",
    "testIntakeEmailMailbox",
  ),
  async () => {
    const admin = world.as("admin");
    const initial = await expectJson<EmailSettings>(
      await admin.get(emailBase()),
    );
    expect(initial).toMatchObject({
      projectId: project.id,
      enabled: false,
      address: null,
      // Nothing set up on this instance.
      instance: { address: false, mailbox: false, webhook: false },
      allowedDomains: [],
      blockedDomains: [],
      imap: {
        enabled: false,
        host: null,
        port: null,
        security: "tls",
        folder: "INBOX",
        hasPassword: false,
      },
      lastPolledAt: null,
      lastError: null,
    });
    expect(initial.limits.maxAttachments).toBeGreaterThan(0);

    // Members and viewers lack project:share.
    for (const actor of ["member", "viewer"] as const) {
      await expectStatus(await world.as(actor).get(emailBase()), 403);
      await expectStatus(
        await world.as(actor).put(emailBase(), { data: { enabled: true } }),
        403,
      );
      await expectStatus(
        await world.as(actor).post(`${emailBase()}/rotate`),
        403,
      );
      await expectStatus(
        await world.as(actor).post(`${emailBase()}/test`),
        403,
      );
    }
    await expectStatus(await world.as("anonymous").get(emailBase()), 401);
    await expectStatus(
      await admin.get("/api/intake-email/project/e2e-no-such-project"),
      404,
    );

    // Nothing to rotate or test before the first save.
    await expectStatus(await admin.post(`${emailBase()}/rotate`), 404);
    await expectStatus(await admin.post(`${emailBase()}/test`), 400);

    for (const data of [
      { allowedDomains: ["not a domain"] },
      { blockedDomains: ["exa mple.com"] },
      // A mailbox needs a server, a user name and a password.
      { imap: { enabled: true, host: "127.0.0.1" } },
      { imap: { port: 70000 } },
      { imap: { security: "ssl" } },
      { enabled: true, extra: 1 },
    ]) {
      await expectStatus(await admin.put(emailBase(), { data }), 400);
    }
    expect(
      (await expectJson<EmailSettings>(await admin.get(emailBase()))).enabled,
    ).toBe(false);

    const saved = await expectJson<EmailSettings>(
      await admin.put(emailBase(), {
        data: {
          enabled: true,
          allowedDomains: ["Example.COM", "@partner.example", "example.com"],
          blockedDomains: ["*.spam.example"],
          // Saved but not polled: imap.enabled stays off.
          imap: {
            host: "127.0.0.1",
            port: 1,
            security: "tls",
            username: "e2e-intake",
            password: MAILBOX_PASSWORD,
            folder: "Requests",
          },
        },
      }),
    );
    expect(saved).toMatchObject({
      enabled: true,
      allowedDomains: ["example.com", "partner.example"],
      blockedDomains: ["spam.example"],
      imap: {
        enabled: false,
        host: "127.0.0.1",
        port: 1,
        username: "e2e-intake",
        folder: "Requests",
        hasPassword: true,
      },
    });
    // Without INTAKE_EMAIL_ADDRESS there is no address to show.
    expect(saved.address).toBeNull();
    expect(JSON.stringify(saved)).not.toContain(MAILBOX_PASSWORD);

    // The closed local port refuses at once: a failed sign-in, not a 500.
    const tested = await expectJson<{
      ok: boolean;
      unread: number | null;
      error: string | null;
    }>(await world.as("owner").post(`${emailBase()}/test`));
    expect(tested.ok).toBe(false);
    expect(tested.unread).toBeNull();
    expect(tested.error).toMatch(/\S/);
    expect(tested.error).not.toContain(MAILBOX_PASSWORD);

    const rotated = await expectJson<EmailSettings>(
      await admin.post(`${emailBase()}/rotate`),
    );
    expect(rotated).toMatchObject({ projectId: project.id, enabled: true });

    // Omitted fields keep their value; null removes the password.
    const cleared = await expectJson<EmailSettings>(
      await admin.put(emailBase(), {
        data: { enabled: false, imap: { password: null, host: null } },
      }),
    );
    expect(cleared).toMatchObject({
      enabled: false,
      allowedDomains: ["example.com", "partner.example"],
      imap: { host: null, hasPassword: false, username: "e2e-intake" },
    });
    await expectStatus(await admin.post(`${emailBase()}/test`), 400);
  },
);

test(
  "the inbound mail webhook is off without a secret: always 404",
  covers("receiveIntakeEmail"),
  async () => {
    const mail = {
      from: "Requester <someone@example.com>",
      to: "requests+e2etoken@example.com",
      subject: uniqueName("Inbound request"),
      text: "Please look at this.",
    };
    // Signed in or not, with a secret or a signature or none: the route
    // does not exist on this instance.
    for (const headers of <Record<string, string>[]>[
      {},
      { Authorization: "Bearer e2e-inbound-secret-not-configured" },
      { "X-Margaya-Signature": `sha256=${"0".repeat(64)}` },
    ]) {
      await expectStatus(
        await anonymous.post("/api/intake-email/inbound", {
          data: mail,
          headers,
        }),
        404,
      );
    }
    await expectStatus(
      await world.as("owner").post("/api/intake-email/inbound", { data: mail }),
      404,
    );
  },
);

test(
  "request form: sharers set it up; anyone with the link sends a request",
  covers(
    "getIntakeFormSettings",
    "updateIntakeFormSettings",
    "rotateIntakeFormLink",
    "getPublicIntakeForm",
    "submitPublicIntakeForm",
  ),
  async () => {
    const owner = world.as("owner");
    const initial = await expectJson<FormSettings>(await owner.get(formBase()));
    expect(initial).toMatchObject({
      projectId: project.id,
      enabled: false,
      path: null,
      title: null,
      descriptionField: "optional",
      emailField: "required",
      nameField: "optional",
      customFieldIds: [],
    });
    test.skip(
      !initial.publicSharingAllowed,
      "Public sharing is turned off on this instance",
    );

    for (const actor of ["member", "viewer"] as const) {
      await expectStatus(await world.as(actor).get(formBase()), 403);
      await expectStatus(
        await world.as(actor).put(formBase(), { data: { enabled: true } }),
        403,
      );
      await expectStatus(
        await world.as(actor).post(`${formBase()}/rotate`),
        403,
      );
    }
    await expectStatus(await world.as("anonymous").get(formBase()), 401);
    await expectStatus(await owner.post(`${formBase()}/rotate`), 404);
    for (const data of [
      { customFieldIds: ["e2e-not-a-field-of-this-project"] },
      { emailField: "sometimes" },
      { title: "x".repeat(201) },
      { enabled: true, slug: "nope" },
    ]) {
      await expectStatus(await owner.put(formBase(), { data }), 400);
    }

    const title = uniqueName("Report a problem");
    const form = await expectJson<FormSettings>(
      await world.as("admin").put(formBase(), {
        data: {
          enabled: true,
          title,
          intro: "  Tell us what went wrong.  ",
          descriptionField: "required",
          emailField: "required",
          nameField: "off",
          confirmationMessage: "Thanks, we got it.",
        },
      }),
    );
    expect(form).toMatchObject({
      enabled: true,
      title,
      intro: "Tell us what went wrong.",
      descriptionField: "required",
      emailField: "required",
      nameField: "off",
      confirmationMessage: "Thanks, we got it.",
    });
    expect(form.path).toMatch(/^\/request-form\/\S+$/);
    const token = form.path?.split("/").pop() ?? "";

    // Public: no sign-in, only the form's own copy and fields.
    const publicForm = await expectJson<PublicForm>(
      await anonymous.get(`/api/public-form/${token}`),
    );
    expect(publicForm).toEqual({
      title,
      intro: "Tell us what went wrong.",
      fields: { description: "required", email: "required", name: "off" },
      customFields: [],
      confirmationMessage: "Thanks, we got it.",
    });
    expect(JSON.stringify(publicForm)).not.toContain(project.id);
    expect(JSON.stringify(publicForm)).not.toContain(world.workspace.id);
    await expectStatus(
      await anonymous.get("/api/public-form/not-a-token"),
      404,
    );

    // A required field left empty, then a real request.
    await expectStatus(
      await anonymous.post(`/api/public-form/${token}`, {
        data: { title: "Missing email", description: "No address given." },
      }),
      400,
    );
    const requestTitle = uniqueName("Form request");
    expect(
      await expectJson(
        await anonymous.post(`/api/public-form/${token}`, {
          data: {
            title: requestTitle,
            description: "The export button does nothing.",
            email: "Requester@Example.com",
            elapsedMs: 8000,
          },
        }),
      ),
    ).toEqual({ confirmationMessage: "Thanks, we got it." });
    // The spam trap answers the same and files nothing.
    const trapTitle = uniqueName("Trapped request");
    expect(
      await expectJson(
        await anonymous.post(`/api/public-form/${token}`, {
          data: {
            title: trapTitle,
            description: "Automated.",
            email: "bot@example.com",
            website: "https://spam.example",
          },
        }),
      ),
    ).toEqual({ confirmationMessage: "Thanks, we got it." });

    const queue = await expectJson<IntakePage>(
      await owner.get(`/api/intake/project/${project.id}`),
    );
    const filed = queue.items.filter((item) =>
      [requestTitle, trapTitle].includes(item.task?.title ?? ""),
    );
    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({
      source: "form",
      task: { title: requestTitle },
    });

    // A new link: the old one stops working at once.
    const rotated = await expectJson<FormSettings>(
      await owner.post(`${formBase()}/rotate`),
    );
    expect(rotated.path).not.toBe(form.path);
    expect(rotated.title).toBe(title);
    const newToken = rotated.path?.split("/").pop() ?? "";
    await expectStatus(await anonymous.get(`/api/public-form/${token}`), 404);
    await expectJson(await anonymous.get(`/api/public-form/${newToken}`));

    // Closing the form, or turning Intake off, hides it.
    const closed = await expectJson<FormSettings>(
      await owner.put(formBase(), { data: { enabled: false } }),
    );
    expect(closed).toMatchObject({ enabled: false, path: rotated.path });
    await expectStatus(
      await anonymous.get(`/api/public-form/${newToken}`),
      404,
    );
    await expectJson(await owner.put(formBase(), { data: { enabled: true } }));
    await expectJson(await anonymous.get(`/api/public-form/${newToken}`));
    await expectJson(
      await owner.patch(`/api/project/${project.id}/features`, {
        data: { intakeEnabled: false },
      }),
    );
    await expectStatus(
      await anonymous.get(`/api/public-form/${newToken}`),
      404,
    );
  },
);
