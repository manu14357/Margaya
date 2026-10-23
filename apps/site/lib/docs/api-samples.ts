import { exampleValue, type Operation, openApiServerUrl } from "./openapi";

// Request samples for an API reference page, generated from the OpenAPI
// operation: cURL, JavaScript (fetch) and Python (requests).

export type ApiSample = {
  id: "curl" | "javascript" | "python";
  label: string;
  language: string;
  code: string;
};

export type ApiResponseSample = { status: string; code: string };

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function requestUrl(operation: Operation): string {
  const query = operation.parameters
    .filter((parameter) => parameter.in === "query" && parameter.required)
    .map((parameter) => `${parameter.name}=<${parameter.name}>`)
    .join("&");
  return `${openApiServerUrl()}${operation.path}${query ? `?${query}` : ""}`;
}

/** The example JSON body, or undefined when the operation takes none. */
function requestBody(operation: Operation): unknown {
  const body = operation.requestBody;
  if (!body?.schema || !body.contentType.includes("json")) return undefined;
  return exampleValue(body.schema, { requiredOnly: true });
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? line : `${pad}${line}`))
    .join("\n");
}

export function curlSample(operation: Operation): string {
  const lines = [
    `curl --request ${operation.method}`,
    `  --url ${shellQuote(requestUrl(operation))}`,
  ];
  if (operation.authenticated) {
    lines.push(`  --header 'Authorization: Bearer <api-key>'`);
  }
  const body = operation.requestBody;
  const example = requestBody(operation);
  if (body && example !== undefined) {
    lines.push(`  --header 'Content-Type: ${body.contentType}'`);
    lines.push(`  --data ${shellQuote(JSON.stringify(example, null, 2))}`);
  } else if (body) {
    lines.push(`  --header 'Content-Type: ${body.contentType}'`);
    lines.push("  --data-binary @file");
  }
  return lines.join(" \\\n");
}

export function javascriptSample(operation: Operation): string {
  const headers: string[] = [];
  if (operation.authenticated) {
    headers.push(`Authorization: "Bearer <api-key>",`);
  }
  const body = operation.requestBody;
  const example = requestBody(operation);
  if (body)
    headers.push(`"Content-Type": ${JSON.stringify(body.contentType)},`);

  const options = [`method: ${JSON.stringify(operation.method)},`];
  if (headers.length > 0) {
    options.push(
      `headers: {\n${headers.map((line) => `  ${line}`).join("\n")}\n},`,
    );
  }
  if (example !== undefined) {
    options.push(`body: JSON.stringify(${JSON.stringify(example, null, 2)}),`);
  } else if (body) {
    options.push("body: file,");
  }
  return [
    `const response = await fetch(${JSON.stringify(requestUrl(operation))}, {`,
    ...options.map((option) => `  ${indent(option, 2)}`),
    "});",
    "",
    "const data = await response.json();",
  ].join("\n");
}

/** A JSON value written as a Python literal. */
export function pythonLiteral(value: unknown, depth = 0): string {
  const pad = "    ".repeat(depth + 1);
  const end = "    ".repeat(depth);
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((item) => `${pad}${pythonLiteral(item, depth + 1)},`).join("\n")}\n${end}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  return `{\n${entries
    .map(
      ([key, item]) =>
        `${pad}${JSON.stringify(key)}: ${pythonLiteral(item, depth + 1)},`,
    )
    .join("\n")}\n${end}}`;
}

export function pythonSample(operation: Operation): string {
  const args = [`    ${JSON.stringify(requestUrl(operation))},`];
  if (operation.authenticated) {
    args.push(`    headers={"Authorization": "Bearer <api-key>"},`);
  }
  const example = requestBody(operation);
  if (example !== undefined) {
    args.push(`    json=${pythonLiteral(example, 1)},`);
  } else if (operation.requestBody) {
    args.push(`    data=open("file", "rb"),`);
  }
  return [
    "import requests",
    "",
    `response = requests.${operation.method.toLowerCase()}(`,
    ...args,
    ")",
    "print(response.json())",
  ].join("\n");
}

export function requestSamples(operation: Operation): ApiSample[] {
  return [
    {
      id: "curl",
      label: "cURL",
      language: "bash",
      code: curlSample(operation),
    },
    {
      id: "javascript",
      label: "JavaScript",
      language: "javascript",
      code: javascriptSample(operation),
    },
    {
      id: "python",
      label: "Python",
      language: "python",
      code: pythonSample(operation),
    },
  ];
}

/** Example JSON bodies for the documented responses that have one. */
export function responseSamples(operation: Operation): ApiResponseSample[] {
  return operation.responses
    .filter(
      (response) => response.schema && response.contentType?.includes("json"),
    )
    .map((response) => ({
      status: response.status,
      code: JSON.stringify(exampleValue(response.schema ?? {}), null, 2),
    }));
}
