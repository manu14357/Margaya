import { client } from "@margaya/libs";

export async function submitMcpAuthorizationDecision(
  requestId: string,
  approved: boolean,
): Promise<string> {
  // The client does not encode path params.
  const response = await client.mcp.authorize.request[":requestId"].$post({
    param: { requestId: encodeURIComponent(requestId) },
    json: { approved },
  });
  if (!response.ok) {
    throw new Error("Could not complete the authorization request.");
  }

  const body = await response.json();
  return body.redirect;
}
