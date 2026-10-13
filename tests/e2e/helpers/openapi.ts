import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { E2E_API_URL, REPO_ROOT } from "./env";

// The committed API contract (apps/docs/openapi.json) drives the API suite:
// every operation must be referenced by a test through covers(), which the
// coverage spec (specs/api/coverage.spec.ts) checks statically.

export const OPENAPI_PATH = path.join(
  REPO_ROOT,
  "apps",
  "docs",
  "openapi.json",
);

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

type JsonSchema = {
  $ref?: string;
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
};

type RawOperation = {
  operationId: string;
  security?: unknown[];
  parameters?: {
    name: string;
    in: "path" | "query" | "header";
    required?: boolean;
    schema?: JsonSchema;
  }[];
  requestBody?: { content?: Record<string, { schema?: JsonSchema }> };
  responses?: Record<string, unknown>;
};

type OpenApiDocument = {
  paths: Record<string, Partial<Record<HttpMethod, RawOperation>>>;
  components: { schemas: Record<string, JsonSchema> };
};

export type Operation = {
  operationId: string;
  method: HttpMethod;
  /** Path relative to /api, e.g. `/task/{id}`. */
  path: string;
  /** False for routes that declare `security: []` (public). */
  secured: boolean;
  /** Documented response status codes. */
  responses: string[];
  raw: RawOperation;
};

export function loadOpenApi(file = OPENAPI_PATH): OpenApiDocument {
  return JSON.parse(readFileSync(file, "utf8")) as OpenApiDocument;
}

export function loadOperations(file = OPENAPI_PATH): Operation[] {
  const document = loadOpenApi(file);
  const operations: Operation[] = [];
  for (const [pathname, item] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      const raw = item[method];
      if (!raw) continue;
      operations.push({
        operationId: raw.operationId,
        method,
        path: pathname,
        secured: !(Array.isArray(raw.security) && raw.security.length === 0),
        responses: Object.keys(raw.responses ?? {}),
        raw,
      });
    }
  }
  return operations;
}

/**
 * A minimal value that satisfies a schema's shape: required properties only,
 * enums take their first value, ids become `placeholder`.
 */
export function sampleFromSchema(
  document: OpenApiDocument,
  schema: JsonSchema | undefined,
  placeholder = "e2e-unknown-id",
  depth = 0,
): unknown {
  let resolved = schema;
  if (resolved?.$ref) {
    resolved =
      document.components.schemas[resolved.$ref.split("/").pop() ?? ""];
  }
  if (!resolved || depth > 6) return placeholder;
  const variants = resolved.anyOf ?? resolved.oneOf;
  if (variants?.length) {
    return sampleFromSchema(document, variants[0], placeholder, depth + 1);
  }
  if (resolved.enum?.length) return resolved.enum[0];
  const type = Array.isArray(resolved.type) ? resolved.type[0] : resolved.type;
  if (type === "object" || resolved.properties) {
    const value: Record<string, unknown> = {};
    for (const key of resolved.required ?? []) {
      value[key] = sampleFromSchema(
        document,
        resolved.properties?.[key],
        placeholder,
        depth + 1,
      );
    }
    return value;
  }
  if (type === "array") return [];
  if (type === "boolean") return false;
  if (type === "number" || type === "integer") return 1;
  if (resolved.format === "date-time") return new Date().toISOString();
  if (resolved.format === "date") return "2031-01-01";
  return placeholder;
}

/**
 * Test details that record which API operations a test exercises with a valid
 * request. The coverage spec scans the spec sources for these calls, so pass
 * operation ids as string literals.
 */
export function covers(...operationIds: string[]) {
  return {
    annotation: operationIds.map((id) => ({ type: "covers", description: id })),
  };
}

let liveIds: Promise<Set<string>> | undefined;

/** Operation ids the running API actually serves (its /api/openapi document). */
export function liveOperationIds(): Promise<Set<string>> {
  liveIds ??= (async () => {
    const response = await fetch(`${E2E_API_URL}/api/openapi`);
    if (!response.ok) return new Set<string>();
    const document = (await response.json()) as OpenApiDocument;
    const ids = new Set<string>();
    for (const item of Object.values(document.paths)) {
      for (const method of HTTP_METHODS) {
        const operation = item[method];
        if (operation?.operationId) ids.add(operation.operationId);
      }
    }
    return ids;
  })();
  return liveIds;
}

/**
 * Skip the current test when the running API (a snapshot started by the
 * lead) does not serve these operations yet. Routes that other agents add
 * later answer 404 until the server restarts.
 */
export async function skipUnlessDeployed(...operationIds: string[]) {
  const live = await liveOperationIds();
  const missing = operationIds.filter((id) => !live.has(id));
  test.skip(
    missing.length > 0,
    `Not deployed on the running API yet (404): ${missing.join(", ")}`,
  );
}
