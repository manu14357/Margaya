import { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// Intake sources of a project (#8): the email settings and the public
// request form, plus the public form itself (no sign-in).

const emailRoute = () => client["intake-email"].project[":projectId"];
const formRoute = () => client["intake-form"].project[":projectId"];

export type IntakeEmailSettings = InferResponseType<
  ReturnType<typeof emailRoute>["$get"],
  200
>;
export type IntakeEmailSettingsPatch = InferRequestType<
  ReturnType<typeof emailRoute>["$put"]
>["json"];
export type IntakeFormSettings = InferResponseType<
  ReturnType<typeof formRoute>["$get"],
  200
>;
export type IntakeFormSettingsPatch = InferRequestType<
  ReturnType<typeof formRoute>["$put"]
>["json"];
export type PublicIntakeForm = InferResponseType<
  (typeof client)["public-form"][":token"]["$get"],
  200
>;
export type PublicIntakeFormSubmission = InferRequestType<
  (typeof client)["public-form"][":token"]["$post"]
>["json"];

async function assertOk(response: {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}) {
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
}

export async function getIntakeEmailSettings(
  projectId: string,
  signal?: AbortSignal,
): Promise<IntakeEmailSettings> {
  const response = await emailRoute().$get(
    { param: { projectId } },
    { init: { signal } },
  );
  await assertOk(response);
  return (await response.json()) as IntakeEmailSettings;
}

export async function updateIntakeEmailSettings(
  projectId: string,
  patch: IntakeEmailSettingsPatch,
): Promise<IntakeEmailSettings> {
  const response = await emailRoute().$put({
    param: { projectId },
    json: patch,
  });
  await assertOk(response);
  return (await response.json()) as IntakeEmailSettings;
}

export async function rotateIntakeEmailAddress(
  projectId: string,
): Promise<IntakeEmailSettings> {
  const response = await emailRoute().rotate.$post({ param: { projectId } });
  await assertOk(response);
  return (await response.json()) as IntakeEmailSettings;
}

export async function testIntakeEmailMailbox(projectId: string) {
  const response = await emailRoute().test.$post({ param: { projectId } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function getIntakeFormSettings(
  projectId: string,
  signal?: AbortSignal,
): Promise<IntakeFormSettings> {
  const response = await formRoute().$get(
    { param: { projectId } },
    { init: { signal } },
  );
  await assertOk(response);
  return (await response.json()) as IntakeFormSettings;
}

export async function updateIntakeFormSettings(
  projectId: string,
  patch: IntakeFormSettingsPatch,
): Promise<IntakeFormSettings> {
  const response = await formRoute().$put({
    param: { projectId },
    json: patch,
  });
  await assertOk(response);
  return (await response.json()) as IntakeFormSettings;
}

export async function rotateIntakeFormLink(
  projectId: string,
): Promise<IntakeFormSettings> {
  const response = await formRoute().rotate.$post({ param: { projectId } });
  await assertOk(response);
  return (await response.json()) as IntakeFormSettings;
}

export async function getPublicIntakeForm(
  token: string,
  signal?: AbortSignal,
): Promise<PublicIntakeForm> {
  const response = await client["public-form"][":token"].$get(
    { param: { token } },
    { init: { signal } },
  );
  await assertOk(response);
  return (await response.json()) as PublicIntakeForm;
}

export async function submitPublicIntakeForm(
  token: string,
  submission: PublicIntakeFormSubmission,
) {
  const response = await client["public-form"][":token"].$post({
    param: { token },
    json: submission,
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
