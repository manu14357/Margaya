import { readFileSync } from "node:fs";
import path from "node:path";
import { request } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  createWorkspace,
  expectJson,
  expectStatus,
  signUpUser,
  type TestUser,
} from "../../helpers/api-kit";
import { E2E_API_URL, REPO_ROOT } from "../../helpers/env";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";
import { SEED_USERS } from "../../seed/data";

// Connections to an identity provider, and SCIM over real HTTP. No real identity
// provider takes part, so these prove how the server behaves, not that a product
// interoperates. Refused SAML responses are covered against their own database in
// tests/api-integration/saml-sign-in.test.ts.

const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const CERTIFICATE = readFileSync(
  path.join(REPO_ROOT, "tests/api-integration/fixtures/saml/idp.crt"),
  "utf8",
);

type Issued = {
  connection: { id: string; name: string; provisionedUsers: number };
  baseUrl: string;
  token: string;
};

/**
 * Calls as an identity provider does: a bearer token, SCIM's own media type, no
 * session and no Origin, so this proves providers work with origin checks on.
 * The empty storageState matters: a bare request.newContext() inherits the
 * project's signed-in session, and a cookie turns the origin check on.
 */
function identityProvider(token: string) {
  return request.newContext({
    baseURL: E2E_API_URL,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/scim+json",
    },
  });
}

let outsider: TestUser;

test.beforeAll(async () => {
  outsider = await signUpUser("Identity outsider");
});

test.afterAll(async () => {
  await outsider?.ctx.dispose();
});

test(
  "an identity provider adds, deactivates and removes someone",
  covers(
    "listScimConnections",
    "createScimConnection",
    "rotateScimConnectionToken",
    "deleteScimConnection",
  ),
  async ({ api }) => {
    const workspaceOwner = await signUpUser("SCIM workspace owner");
    const workspace = await createWorkspace(workspaceOwner.ctx);
    await expectJson(
      await api.post("/api/instance-admin/reauth", {
        data: { password: SEED_USERS.owner.password },
      }),
    );

    const issued = await expectJson<Issued>(
      await api.post("/api/instance-admin/identity/scim", {
        data: { name: uniqueName("Directory"), workspaceId: workspace.id },
      }),
    );
    expect(issued.token.length).toBeGreaterThan(40);
    const listed = await expectJson<{
      baseUrl: string;
      items: Issued["connection"][];
    }>(await api.get("/api/instance-admin/identity/scim"));
    expect(listed.baseUrl).toBe(issued.baseUrl);
    expect(JSON.stringify(listed)).not.toContain(issued.token);

    const provider = await identityProvider(issued.token);
    const email = `${uniqueName("scim")
      .toLowerCase()
      .replaceAll(/[^a-z0-9]/g, "")}@margaya.test`;
    const created = await expectJson<{ id: string }>(
      await provider.post("/api/auth/scim/v2/Users", {
        data: {
          schemas: [USER_SCHEMA],
          userName: email,
          name: { formatted: "Provisioned Person" },
          emails: [{ value: email, primary: true }],
        },
      }),
      201,
    );

    await expectStatus(
      await provider.patch(`/api/auth/scim/v2/Users/${created.id}`, {
        data: {
          schemas: [PATCH_SCHEMA],
          Operations: [{ op: "Replace", path: "active", value: "False" }],
        },
      }),
      204,
    );
    const read = await expectJson<{ active: boolean }>(
      await provider.get(`/api/auth/scim/v2/Users/${created.id}`),
    );
    expect(read.active).toBe(false);

    await expectStatus(
      await provider.delete(`/api/auth/scim/v2/Users/${created.id}`),
      204,
    );
    await expectStatus(
      await provider.get(`/api/auth/scim/v2/Users/${created.id}`),
      404,
    );

    // A new token replaces the old one at once.
    const rotated = await expectJson<Issued>(
      await api.post(
        `/api/instance-admin/identity/scim/${issued.connection.id}/rotate`,
      ),
    );
    expect(rotated.token).not.toBe(issued.token);
    await expectStatus(await provider.get("/api/auth/scim/v2/Users"), 401);
    await provider.dispose();

    const current = await identityProvider(rotated.token);
    await expectJson(await current.get("/api/auth/scim/v2/Users"));

    // Removing the connection ends the token too.
    await expectJson(
      await api.delete(
        `/api/instance-admin/identity/scim/${issued.connection.id}`,
      ),
    );
    await expectStatus(await current.get("/api/auth/scim/v2/Users"), 401);
    await current.dispose();
    await workspaceOwner.ctx.dispose();
  },
);

test("the identity provider's post reaches the plugin past the origin checks", async ({
  api,
}) => {
  // A browser with a session here, posting from the identity provider's page.
  // The response is refused for what it is, not for where it came from.
  const response = await api.post(
    "/api/auth/sso/saml2/sp/acs/saml_unknown_connection",
    {
      maxRedirects: 0,
      headers: { Origin: "https://idp.margaya.test" },
      form: { SAMLResponse: Buffer.from("not xml").toString("base64") },
    },
  );
  expect(response.status()).toBe(302);
  expect(response.headers().location).toContain("error=");
});

test(
  "SAML connections are made, changed and removed by instance admins only",
  covers(
    "listSamlConnections",
    "draftSamlConnection",
    "createSamlConnection",
    "updateSamlConnection",
    "deleteSamlConnection",
  ),
  async ({ api, apiAs }) => {
    await expectJson(
      await api.post("/api/instance-admin/reauth", {
        data: { password: SEED_USERS.owner.password },
      }),
    );
    const draft = await expectJson<{
      key: string;
      acsUrl: string;
      entityId: string;
    }>(await api.get("/api/instance-admin/identity/saml/new"));

    const domain = `${uniqueName("saml")
      .toLowerCase()
      .replaceAll(/[^a-z0-9]/g, "")}.margaya.test`;
    const created = await expectJson<{
      id: string;
      domains: string[];
      acsUrl: string;
      entityId: string;
      certificateFingerprint: string;
    }>(
      await api.post("/api/instance-admin/identity/saml", {
        data: {
          name: uniqueName("Company sign-in"),
          domains: [domain],
          issuer: "https://idp.margaya.test/entity",
          entryPoint: "https://idp.margaya.test/sso",
          certificate: CERTIFICATE,
          key: draft.key,
        },
      }),
    );
    try {
      expect(created.acsUrl).toBe(draft.acsUrl);
      expect(created.entityId).toBe(draft.entityId);
      expect(created.certificateFingerprint).toContain(":");

      const config = await expectJson<{ hasSamlSignIn: boolean }>(
        await (await apiAs("anonymous")).get("/api/config"),
      );
      expect(config.hasSamlSignIn).toBe(true);

      const changed = await expectJson<{ entryPoint: string; acsUrl: string }>(
        await api.patch(`/api/instance-admin/identity/saml/${created.id}`, {
          data: { entryPoint: "https://idp.margaya.test/new" },
        }),
      );
      expect(changed.entryPoint).toBe("https://idp.margaya.test/new");
      expect(changed.acsUrl).toBe(draft.acsUrl);

      const listed = await expectJson<{ items: { id: string }[] }>(
        await api.get("/api/instance-admin/identity/saml"),
      );
      expect(listed.items.map((item) => item.id)).toContain(created.id);

      // Not for anyone else, and not an open door to a private key.
      await expectStatus(
        await outsider.ctx.get("/api/instance-admin/identity/saml"),
        403,
      );
      await expectStatus(
        await api.post("/api/instance-admin/identity/saml", {
          data: {
            name: "Bad",
            domains: [`other-${domain}`],
            issuer: "https://idp.margaya.test/other",
            entryPoint: "https://idp.margaya.test/other",
            certificate: "-----BEGIN PRIVATE KEY-----\nabc",
          },
        }),
        400,
      );
    } finally {
      await expectJson(
        await api.delete(`/api/instance-admin/identity/saml/${created.id}`),
      );
    }
  },
);
