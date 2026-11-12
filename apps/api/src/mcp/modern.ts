import {
  CLIENT_CAPABILITIES_META_KEY,
  createMcpHandler,
  inputRequired,
  inputResponse,
  McpServer,
} from "@modelcontextprotocol/server";
import { mcpToolAnnotations } from "./annotations";
import { TASKS_EXTENSION } from "./tasks";
import { registerMcpTools, toMcpToolRegistrar } from "./tools";

// Bulk tools that replace or move many things at once; with the deletes,
// they ask the person to confirm first when the client can (multi
// round-trip `input_required`, MCP 2026-07-28). A confirmation is not an
// authorization check: the API still enforces every permission.
const BULK_CONFIRM = new Set([
  "update_cycle_tasks",
  "transfer_cycle_tasks",
  "update_module_tasks",
]);

export function needsConfirmation(name: string): boolean {
  return (
    mcpToolAnnotations(name).destructiveHint &&
    (/^(delete|remove)_/.test(name) || BULK_CONFIRM.has(name))
  );
}

type CallExtra = {
  mcpReq?: {
    envelope?: Record<string, unknown>;
    inputResponses?: Record<string, unknown>;
  };
};

/** Whether the client declared form elicitation for this request. */
export function clientCanConfirm(extra: unknown): boolean {
  const capabilities = (extra as CallExtra)?.mcpReq?.envelope?.[
    CLIENT_CAPABILITIES_META_KEY
  ] as { elicitation?: Record<string, unknown> } | undefined;
  const elicitation = capabilities?.elicitation;
  if (!elicitation || typeof elicitation !== "object") return false;
  // An empty elicitation capability means form mode (the spec's default).
  return "form" in elicitation || Object.keys(elicitation).length === 0;
}

function confirmationMessage(name: string, args: unknown): string {
  let detail = "";
  try {
    detail = JSON.stringify(args ?? {});
  } catch {
    detail = "";
  }
  if (detail.length > 400) detail = `${detail.slice(0, 400)}…`;
  return `Confirm ${name.replace(/_/g, " ")}${detail && detail !== "{}" ? ` ${detail}` : ""}? This changes Margaya data and can't be undone from here.`;
}

type ToolCallback = (args: unknown, extra?: unknown) => Promise<unknown>;

/**
 * Wraps the server so delete and bulk tools return `input_required` with
 * a yes/no elicitation until the retried call carries an accepted answer.
 * Clients without form elicitation are not asked; they rely on the
 * destructiveHint annotation as before.
 */
function withConfirmations(server: McpServer) {
  return {
    registerTool(name: string, config: unknown, callback: ToolCallback) {
      const wrapped: ToolCallback = needsConfirmation(name)
        ? async (args, extra) => {
            if (!clientCanConfirm(extra)) return callback(args, extra);
            const answer = inputResponse(
              (extra as CallExtra)?.mcpReq?.inputResponses,
              "confirm",
            );
            if (answer.kind === "missing") {
              return inputRequired({
                inputRequests: {
                  confirm: inputRequired.elicit({
                    message: confirmationMessage(name, args),
                    requestedSchema: {
                      type: "object",
                      properties: {
                        confirm: {
                          type: "boolean",
                          title: "Confirm",
                          description: "Yes runs the tool; no changes nothing.",
                        },
                      },
                      required: ["confirm"],
                    },
                  }),
                },
              });
            }
            if (
              answer.kind !== "elicit" ||
              answer.action !== "accept" ||
              answer.content?.confirm !== true
            ) {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      error: "Not confirmed; nothing was changed.",
                    }),
                  },
                ],
                isError: true,
              };
            }
            return callback(args, extra);
          }
        : callback;
      return (
        server.registerTool as unknown as (
          name: string,
          config: unknown,
          callback: ToolCallback,
        ) => unknown
      ).call(server, name, config, wrapped);
    },
  };
}

/** Create a stateless MCP 2026 handler with a fresh server per request. */
export function createModernMcpHandler(token: string, apiUrl: string) {
  return createMcpHandler(
    () => {
      const server = new McpServer(
        { name: "margaya-mcp", version: "1.0.0" },
        // tasks/get, tasks/update and tasks/cancel are served in index.ts.
        { capabilities: { extensions: { [TASKS_EXTENSION]: {} } } },
      );
      registerMcpTools(
        toMcpToolRegistrar(
          withConfirmations(server) as unknown as Parameters<
            typeof toMcpToolRegistrar
          >[0],
        ),
        apiUrl,
        token,
      );
      return server;
    },
    { legacy: "reject" },
  );
}
