import type { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";

export type PageSummary = InferResponseType<
  (typeof client)["page"]["project"][":projectId"]["$get"],
  200
>[number];

export type Page = InferResponseType<
  (typeof client)["page"][":id"]["$get"],
  200
>;

export type PageCapabilities = PageSummary["capabilities"];

export type PageAncestor = Page["ancestors"][number];

export type PageAccess = PageSummary["access"];

export type PageLogoKind = NonNullable<PageSummary["logoKind"]>;

export type PageVersion = InferResponseType<
  (typeof client)["page"][":id"]["versions"]["$get"],
  200
>[number];

export type PageVersionDetail = InferResponseType<
  (typeof client)["page"][":id"]["versions"][":versionId"]["$get"],
  200
>;

export type DeletedPage = InferResponseType<
  (typeof client)["page"][":id"]["$delete"],
  200
>;

/** The Pages list tabs (`?tab=`). */
export type PageListTab = "public" | "private" | "archived";

export type PageComment = InferResponseType<
  (typeof client)["page"][":id"]["comments"]["$get"],
  200
>[number];

export type PageSubscription = InferResponseType<
  (typeof client)["page"][":id"]["subscription"]["$get"],
  200
>;

/** The editor side panel tabs (`?panel=`). */
export type PagePanel = "outline" | "info" | "comments" | "history";
