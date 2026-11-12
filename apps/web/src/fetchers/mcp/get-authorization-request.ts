import { client } from "@margaya/libs";

export type McpAuthorizationRequest = {
  clientName: string;
  redirectUri: string;
  /** Set when the client is identified by a metadata document URL. */
  metadataHost?: string;
};

export async function getMcpAuthorizationRequest(
  requestId: string,
): Promise<McpAuthorizationRequest> {
  // The client does not encode path params.
  const response = await client.mcp.authorize.request[":requestId"].$get({
    param: { requestId: encodeURIComponent(requestId) },
  });
  if (!response.ok) {
    throw new Error("This authorization request is invalid or has expired.");
  }

  const body = await response.json();
  return {
    clientName: body.client_name,
    redirectUri: body.redirect_uri,
    ...(body.client_metadata_host
      ? { metadataHost: body.client_metadata_host }
      : {}),
  };
}
