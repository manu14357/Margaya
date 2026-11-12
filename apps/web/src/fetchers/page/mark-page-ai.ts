import { client } from "@margaya/libs";
import type { AiAssistFeature } from "@/lib/ai/provenance";
import { HttpError } from "@/lib/http-error";

/** Labels the page AI-generated after AI text was accepted in its editor. */
async function markPageAi(pageId: string, feature: AiAssistFeature) {
  const response = await client.page[":id"]["ai-provenance"].$post({
    param: { id: pageId },
    json: { feature },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default markPageAi;
