import { subscribeToEvent } from "../events";
import { broadcastToProject } from "../ws";

// Project socket hints for publishing and votes (B12 §5). They carry ids
// only: never a link token or content.

export const PUBLICATION_EVENTS = [
  "publication.published",
  "publication.unpublished",
  "publication.link_rotated",
  "publication.updated",
  "publication.participant_blocked",
  "publication.participant_unblocked",
] as const;

for (const eventName of PUBLICATION_EVENTS) {
  subscribeToEvent<{ projectId?: string; initiatorId?: string }>(
    eventName,
    async ({ projectId, initiatorId }) => {
      if (!projectId) return;
      broadcastToProject(
        projectId,
        { type: "PUBLICATION_UPDATED", projectId, taskId: "" },
        initiatorId,
      );
    },
  );
}

subscribeToEvent<{ projectId?: string; taskId?: string; initiatorId?: string }>(
  "task.vote_changed",
  async ({ projectId, taskId, initiatorId }) => {
    if (!projectId || !taskId) return;
    broadcastToProject(
      projectId,
      { type: "VOTES_UPDATED", projectId, taskId },
      initiatorId,
    );
  },
);
