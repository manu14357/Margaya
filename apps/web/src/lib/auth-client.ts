import { apiKeyClient } from "@better-auth/api-key/client";
import {
  adminClient,
  anonymousClient,
  deviceAuthorizationClient,
  emailOTPClient,
  genericOAuthClient,
  inferAdditionalFields,
  lastLoginMethodClient,
  magicLinkClient,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import type { AccessControl } from "better-auth/plugins/access";
import { createAuthClient } from "better-auth/react";
import { ac, admin, guest, member, owner, viewer } from "./permissions";
import {
  handleTwoFactorRequired,
  TWO_FACTOR_REQUIRED,
} from "./two-factor-required";

const getBaseURL = () => {
  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:1337";
  try {
    const url = new URL(apiUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return apiUrl.split("/").slice(0, 3).join("/");
  }
};

const BASE_PATH = "/api/auth";

/** For the one request that can't wait for the client (use-sign-out.ts). */
export const AUTH_BASE_URL = `${getBaseURL()}${BASE_PATH}`;

export const authClient = createAuthClient({
  baseURL: getBaseURL(),
  basePath: BASE_PATH,
  fetchOptions: {
    // Invitations, device approval and workspace calls all stop here when the
    // server requires two-factor and this account hasn't set it up.
    onError: ({ error }) => {
      if (error.code === TWO_FACTOR_REQUIRED) handleTwoFactorRequired();
    },
  },
  plugins: [
    anonymousClient(),
    lastLoginMethodClient(),
    magicLinkClient(),
    emailOTPClient(),
    organizationClient({
      // Same widening as the server plugin in `apps/api/src/auth.ts`: our
      // narrow `statement` shape makes `ac`'s inferred `newRole` generic
      // incompatible with better-auth's looser `AccessControl` type.
      ac: ac as AccessControl,
      roles: {
        viewer,
        member,
        admin,
        owner,
        guest,
      },
      dynamicAccessControl: {
        enabled: true,
      },
    }),
    genericOAuthClient(),
    deviceAuthorizationClient(),
    apiKeyClient(),
    adminClient(),
    // Sign-in answers { twoFactorRedirect: true } when a code is needed; the
    // sign-in screen shows the code step itself.
    twoFactorClient(),
    inferAdditionalFields({
      user: {
        locale: {
          type: "string",
          required: false,
          input: true,
        },
      },
    }),
  ],
});
