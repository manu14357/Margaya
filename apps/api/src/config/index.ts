import { samlSignInAvailable } from "../identity/saml-policy";
import { apiRouter, createRoute, jsonResponse } from "../openapi";
import { desktopConfig } from "../utils/desktop-config";
import getSettings from "../utils/get-settings";
import { configSchema } from "./response";

// Mounted before the app-wide authenticateApiRequest middleware: the login
// screen reads it to decide which sign-in methods to render.
const getConfigRoute = createRoute({
  method: "get",
  operationId: "getConfig",
  path: "/",
  tags: ["Config"],
  summary: "Get config",
  description:
    "Public instance settings: which sign-in methods, registration paths, and features are enabled, and what Margaya Desktop needs to connect.",
  security: [],
  responses: {
    200: jsonResponse("Application settings", configSchema),
  },
});

const config = apiRouter().openapi(getConfigRoute, async (c) =>
  c.json(
    {
      ...getSettings(),
      hasSamlSignIn: await samlSignInAvailable(),
      desktop: desktopConfig(),
    },
    200,
  ),
);

export default config;
