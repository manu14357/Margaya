import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { DeliveryForecast, DeliveryScopeType } from "@/types/delivery";

/** GET /api/delivery/{cycle|module|project}/{id}/forecast. */
async function getForecast(
  scope: DeliveryScopeType,
  id: string,
  signal?: AbortSignal,
): Promise<DeliveryForecast> {
  const init = { init: { signal } };
  const response =
    scope === "cycle"
      ? await client.delivery.cycle[":cycleId"].forecast.$get(
          { param: { cycleId: id } },
          init,
        )
      : scope === "module"
        ? await client.delivery.module[":moduleId"].forecast.$get(
            { param: { moduleId: id } },
            init,
          )
        : await client.delivery.project[":projectId"].forecast.$get(
            { param: { projectId: id } },
            init,
          );

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return (await response.json()) as DeliveryForecast;
}

export default getForecast;
