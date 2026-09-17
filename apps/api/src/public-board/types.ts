import type { PublicationSettings } from "../publication/settings";
import type { PublicBoardInstanceState } from "./instance-state";

// Who is looking at a public board (B12 K8, §3.5).
export type PublicViewer = {
  kind: "visitor" | "guest" | "account";
  userId: string | null;
  name: string | null;
  image: string | null;
  /** Better Auth's instance ban (with an expiry that hasn't passed). */
  banned: boolean;
  /** An API key was presented: reads only (writes answer 403). */
  apiKey: boolean;
  /** A malformed Authorization header: reads only (writes answer 401). */
  malformedAuth: boolean;
};

// A live board, resolved from its link token (§3.5).
export type ResolvedBoard = {
  publicationId: string;
  token: string;
  projectId: string;
  workspaceId: string;
  project: {
    name: string;
    slug: string;
    icon: string | null;
    description: string | null;
    descriptionDeferred: boolean;
  };
  settings: PublicationSettings;
  intakeEnabled: boolean;
  /** The publication's version, part of the list cache key. */
  updatedAt: Date;
  viewerIsMember: boolean;
  viewerBlocked: boolean;
  instance: PublicBoardInstanceState;
};

export type PublicBoardVariables = {
  viewer: PublicViewer;
  board: ResolvedBoard;
};
