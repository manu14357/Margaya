import { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { ok } from "./ai";

// Outbound MCP connectors: outside MCP servers that agents with web access
// may call. Shared ones need ai:manage; personal ones belong to their
// owner. Secrets go in and never come back, only their last four
// characters.

type ConnectorsClient = (typeof client)["ai"]["connectors"];

export type AiConnector = InferResponseType<
  ConnectorsClient["$get"],
  200
>[number];
export type AiConnectorTest = InferResponseType<
  ConnectorsClient[":connectorId"]["test"]["$post"],
  200
>;
export type CreateAiConnectorInput = InferRequestType<
  ConnectorsClient["$post"]
>["json"];
export type UpdateAiConnectorInput = InferRequestType<
  ConnectorsClient[":connectorId"]["$patch"]
>["json"];

export async function getAiConnectors(workspaceId: string) {
  return ok(await client.ai.connectors.$get({ query: { workspaceId } }));
}

export async function createAiConnector(input: CreateAiConnectorInput) {
  return ok(await client.ai.connectors.$post({ json: input }));
}

export async function updateAiConnector(
  connectorId: string,
  input: UpdateAiConnectorInput,
) {
  return ok(
    await client.ai.connectors[":connectorId"].$patch({
      param: { connectorId },
      json: input,
    }),
  );
}

export async function deleteAiConnector(
  workspaceId: string,
  connectorId: string,
) {
  return ok(
    await client.ai.connectors[":connectorId"].$delete({
      param: { connectorId },
      query: { workspaceId },
    }),
  );
}

export async function testAiConnector(
  workspaceId: string,
  connectorId: string,
) {
  return ok(
    await client.ai.connectors[":connectorId"].test.$post({
      param: { connectorId },
      json: { workspaceId },
    }),
  );
}
