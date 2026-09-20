import type { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";

export type ArchiveSummary = InferResponseType<
  (typeof client)["archive"]["summary"]["$get"],
  200
>;

export type ArchivedEntityList = InferResponseType<
  (typeof client)["archive"][":type"]["$get"],
  200
>;

export type ArchivedEntity = ArchivedEntityList["items"][number];

export type ArchivedEntityType = ArchivedEntity["type"];
