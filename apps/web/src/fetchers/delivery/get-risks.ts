import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { DeliveryScopeType, RiskRadar } from "@/types/delivery";

/** GET /api/delivery/{cycle|module|project}/{id}/risks. */
async function getRisks(
  scope: DeliveryScopeType,
  id: string,
  signal?: AbortSignal,
): Promise<RiskRadar> {
  const init = { init: { signal } };
  const response =
    scope === "cycle"
      ? await client.delivery.cycle[":cycleId"].risks.$get(
          { param: { cycleId: id } },
          init,
        )
      : scope === "module"
        ? await client.delivery.module[":moduleId"].risks.$get(
            { param: { moduleId: id } },
            init,
          )
        : await client.delivery.project[":projectId"].risks.$get(
            { param: { projectId: id } },
            init,
          );

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return (await response.json()) as RiskRadar;
}

export default getRisks;
