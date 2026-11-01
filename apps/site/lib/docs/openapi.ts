import fs from "node:fs";
import path from "node:path";

// The committed OpenAPI document (apps/docs/openapi.json) that the API
// reference pages render. Only the subset of OpenAPI 3.1 the API emits is
// modelled here.

export type JsonSchema = {
  $ref?: string;
  type?: string | string[];
  format?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  example?: unknown;
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  deprecated?: boolean;
};

type ParameterSource = {
  $ref?: string;
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
};

type MediaSource = { schema?: JsonSchema };

type OperationSource = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  security?: Record<string, string[]>[];
  parameters?: ParameterSource[];
  requestBody?: {
    required?: boolean;
    description?: string;
    content?: Record<string, MediaSource>;
  };
  responses?: Record<
    string,
    { description?: string; content?: Record<string, MediaSource> }
  >;
};

type OpenApiSource = {
  info: { title: string; version: string };
  servers?: { url: string }[];
  security?: Record<string, string[]>[];
  paths: Record<string, Record<string, OperationSource>>;
  components?: {
    schemas?: Record<string, JsonSchema>;
    parameters?: Record<string, ParameterSource>;
  };
};

export type OperationParameter = {
  name: string;
  in: string;
  required: boolean;
  description: string;
  schema: JsonSchema;
};

export type OperationBody = {
  contentType: string;
  schema: JsonSchema | null;
};

export type OperationResponse = {
  status: string;
  description: string;
  contentType: string | null;
  schema: JsonSchema | null;
};

export type Operation = {
  method: string;
  path: string;
  operationId: string;
  summary: string;
  description: string;
  tags: string[];
  deprecated: boolean;
  authenticated: boolean;
  parameters: OperationParameter[];
  requestBody: (OperationBody & { required: boolean }) | null;
  responses: OperationResponse[];
};

const OPENAPI_FILE = path.join(process.cwd(), "..", "docs", "openapi.json");

let spec: OpenApiSource | null = null;
const operations = new Map<string, Operation | null>();

function openApi(): OpenApiSource {
  spec ??= JSON.parse(fs.readFileSync(OPENAPI_FILE, "utf8")) as OpenApiSource;
  return spec;
}

export function openApiServerUrl(): string {
  return openApi().servers?.[0]?.url ?? "https://margaya.example.com/api";
}

/** The component name of a `#/components/schemas/Name` reference. */
export function refName(ref: string): string {
  return ref.slice(ref.lastIndexOf("/") + 1);
}

/** Follows `$ref`s to a concrete schema. Unknown references resolve to `{}`. */
export function resolveSchema(schema: JsonSchema): JsonSchema {
  let current = schema;
  for (let hops = 0; current.$ref && hops < 20; hops += 1) {
    current = openApi().components?.schemas?.[refName(current.$ref)] ?? {};
  }
  return current;
}

function resolveParameter(parameter: ParameterSource): ParameterSource {
  if (!parameter.$ref) return parameter;
  return (
    openApi().components?.parameters?.[refName(parameter.$ref)] ?? parameter
  );
}

/** Prefers JSON when an operation offers several media types. */
function pickContent(content: Record<string, MediaSource> | undefined) {
  if (!content) return null;
  const types = Object.keys(content);
  const type =
    types.find((entry) => entry.includes("json")) ?? types[0] ?? null;
  if (!type) return null;
  return { contentType: type, schema: content[type]?.schema ?? null };
}

const PARAMETER_ORDER = ["path", "query", "header", "cookie"];

export function findOperation(method: string, route: string): Operation | null {
  const key = `${method.toUpperCase()} ${route}`;
  const known = operations.get(key);
  if (known !== undefined) return known;

  const document = openApi();
  const source = document.paths[route]?.[method.toLowerCase()];
  if (!source) {
    operations.set(key, null);
    return null;
  }

  const security = source.security ?? document.security ?? [];
  const body = pickContent(source.requestBody?.content);
  const operation: Operation = {
    method: method.toUpperCase(),
    path: route,
    operationId: source.operationId ?? key,
    summary: source.summary ?? "",
    description: source.description ?? "",
    tags: source.tags ?? [],
    deprecated: Boolean(source.deprecated),
    authenticated: security.length > 0,
    parameters: (source.parameters ?? [])
      .map(resolveParameter)
      .map((parameter) => ({
        name: parameter.name,
        in: parameter.in,
        required: Boolean(parameter.required),
        description:
          parameter.description ?? parameter.schema?.description ?? "",
        schema: parameter.schema ?? {},
      }))
      .sort(
        (a, b) => PARAMETER_ORDER.indexOf(a.in) - PARAMETER_ORDER.indexOf(b.in),
      ),
    requestBody: body
      ? { ...body, required: Boolean(source.requestBody?.required) }
      : null,
    responses: Object.entries(source.responses ?? {}).map(
      ([status, response]) => {
        const content = pickContent(response.content);
        return {
          status,
          description: response.description ?? "",
          contentType: content?.contentType ?? null,
          schema: content?.schema ?? null,
        };
      },
    ),
  };
  operations.set(key, operation);
  return operation;
}

/** Every `METHOD /path` in the document, for coverage checks. */
export function listOperationKeys(): string[] {
  const keys: string[] = [];
  for (const [route, item] of Object.entries(openApi().paths)) {
    for (const method of Object.keys(item)) {
      if (["get", "post", "put", "patch", "delete"].includes(method)) {
        keys.push(`${method.toUpperCase()} ${route}`);
      }
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Presentation helpers

function typeList(schema: JsonSchema): string[] {
  if (Array.isArray(schema.type)) return schema.type;
  return schema.type ? [schema.type] : [];
}

/** A short type label such as `string`, `Task[]` or `string | null`. */
export function schemaTypeLabel(schema: JsonSchema, depth = 0): string {
  if (depth > 4) return "object";
  if (schema.$ref) {
    const target = resolveSchema(schema);
    const types = typeList(target);
    if (
      types.length > 0 &&
      !types.includes("object") &&
      !types.includes("array")
    ) {
      return schemaTypeLabel(target, depth + 1);
    }
    return refName(schema.$ref);
  }
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants) {
    return [
      ...new Set(
        variants.map((variant) => schemaTypeLabel(variant, depth + 1)),
      ),
    ].join(" | ");
  }
  if (schema.allOf?.length === 1 && schema.allOf[0]) {
    return schemaTypeLabel(schema.allOf[0], depth + 1);
  }
  const types = typeList(schema);
  if (types.length === 0) {
    if (schema.properties || schema.allOf) return "object";
    if (schema.const !== undefined) return typeof schema.const;
    return "any";
  }
  return types
    .map((type) =>
      type === "array"
        ? `${schema.items ? schemaTypeLabel(schema.items, depth + 1) : "any"}[]`
        : type,
    )
    .join(" | ");
}

/** Constraints worth showing next to a field, e.g. `max length 255`. */
export function schemaConstraints(schema: JsonSchema): string[] {
  const target = schema.$ref ? resolveSchema(schema) : schema;
  const notes: string[] = [];
  if (target.format) notes.push(target.format);
  if (target.minLength !== undefined && target.minLength > 1)
    notes.push(`min length ${target.minLength}`);
  if (target.maxLength !== undefined)
    notes.push(`max length ${target.maxLength}`);
  if (target.minimum !== undefined) notes.push(`min ${target.minimum}`);
  if (target.maximum !== undefined) notes.push(`max ${target.maximum}`);
  if (target.minItems !== undefined && target.minItems > 0)
    notes.push(`min items ${target.minItems}`);
  if (target.maxItems !== undefined) notes.push(`max items ${target.maxItems}`);
  if (target.pattern) notes.push(`pattern ${target.pattern}`);
  return notes;
}

export type SchemaField = {
  name: string;
  required: boolean;
  schema: JsonSchema;
};

/**
 * The named fields of an object-like schema (following `$ref`, `allOf` and
 * array items), or null when the schema has no fields to list.
 */
export function schemaFields(schema: JsonSchema): SchemaField[] | null {
  const target = resolveSchema(schema);
  if (target.items && typeList(target).includes("array")) {
    return schemaFields(target.items);
  }
  const properties: Record<string, JsonSchema> = { ...target.properties };
  const required = new Set(target.required ?? []);
  for (const part of target.allOf ?? []) {
    const resolved = resolveSchema(part);
    Object.assign(properties, resolved.properties);
    for (const name of resolved.required ?? []) required.add(name);
  }
  const names = Object.keys(properties);
  if (names.length === 0) return null;
  return names.map((name) => ({
    name,
    required: required.has(name),
    schema: properties[name] ?? {},
  }));
}

/** Object-shaped alternatives of an `anyOf`/`oneOf` schema. */
export function schemaVariants(schema: JsonSchema): JsonSchema[] {
  const target = resolveSchema(schema);
  const source =
    target.items && typeList(target).includes("array")
      ? resolveSchema(target.items)
      : target;
  const variants = source.anyOf ?? source.oneOf ?? [];
  return variants.filter((variant) => schemaFields(variant) !== null);
}

const EXAMPLE_DEPTH = 5;

/** A representative value for a schema, for request and response examples. */
export function exampleValue(
  schema: JsonSchema,
  { requiredOnly = false, depth = 0, seen = new Set<string>() } = {},
): unknown {
  if (schema.example !== undefined) return schema.example;
  if (schema.$ref) {
    if (seen.has(schema.$ref) || depth > EXAMPLE_DEPTH) return {};
    const next = new Set(seen).add(schema.$ref);
    return exampleValue(resolveSchema(schema), {
      requiredOnly,
      depth,
      seen: next,
    });
  }
  if (schema.const !== undefined) return schema.const;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  const variant = (schema.anyOf ?? schema.oneOf)?.find(
    (entry) => !typeList(entry).includes("null"),
  );
  if (variant) return exampleValue(variant, { requiredOnly, depth, seen });

  const types = typeList(schema).filter((type) => type !== "null");
  const type =
    types[0] ?? (schema.properties || schema.allOf ? "object" : "string");
  switch (type) {
    case "object": {
      const fields = schemaFields(schema) ?? [];
      const chosen = requiredOnly
        ? fields.filter((field) => field.required)
        : fields;
      const value: Record<string, unknown> = {};
      if (depth >= EXAMPLE_DEPTH) return value;
      for (const field of chosen) {
        value[field.name] = exampleValue(field.schema, {
          requiredOnly,
          depth: depth + 1,
          seen,
        });
      }
      return value;
    }
    case "array":
      return depth >= EXAMPLE_DEPTH || !schema.items
        ? []
        : [
            exampleValue(schema.items, {
              requiredOnly,
              depth: depth + 1,
              seen,
            }),
          ];
    case "integer":
    case "number":
      return schema.minimum ?? 0;
    case "boolean":
      return true;
    default:
      if (schema.format === "date-time") return "2026-01-01T09:00:00.000Z";
      if (schema.format === "date") return "2026-01-01";
      if (schema.format === "uri" || schema.format === "url")
        return "https://example.com";
      if (schema.format === "email") return "user@example.com";
      return "<string>";
  }
}

export const PARAMETER_LOCATIONS: Record<string, string> = {
  path: "Path parameters",
  query: "Query parameters",
  header: "Headers",
  cookie: "Cookies",
};

/** Section ids an operation page renders, in order, for its outline. */
export function operationHeadings(
  operation: Operation,
): { id: string; text: string; depth: number }[] {
  const headings: { id: string; text: string; depth: number }[] = [];
  if (operation.authenticated) {
    headings.push({ id: "authorization", text: "Authorization", depth: 2 });
  }
  for (const [location, title] of Object.entries(PARAMETER_LOCATIONS)) {
    if (operation.parameters.some((parameter) => parameter.in === location)) {
      headings.push({ id: `${location}-parameters`, text: title, depth: 2 });
    }
  }
  if (operation.requestBody) {
    headings.push({ id: "request-body", text: "Request body", depth: 2 });
  }
  headings.push({ id: "responses", text: "Responses", depth: 2 });
  return headings;
}
