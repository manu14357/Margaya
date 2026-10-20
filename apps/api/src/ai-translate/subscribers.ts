import { subscribeToEvent } from "../events";
import { forgetTranslations } from "./translate";

// An edited comment or description drops its cached translations right
// away, so no outdated translation is kept. (Reads also compare a hash of
// the source, so even a missed event never serves a stale translation.)

subscribeToEvent<{ id?: string }>("comment.updated", async ({ id }) => {
  if (id) await forgetTranslations("commentId", id);
});

subscribeToEvent<{ taskId?: string }>(
  "task.description_changed",
  async ({ taskId }) => {
    if (taskId) await forgetTranslations("taskId", taskId);
  },
);
