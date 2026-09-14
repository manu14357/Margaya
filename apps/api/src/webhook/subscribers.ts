import { subscribeToEvent } from "../events";
import { type Payload, WEBHOOK_SOURCE_EVENTS } from "./catalog";
import { enqueueInBackground } from "./dispatch/enqueue";

// One bus subscriber per internal event the catalog maps. Enqueueing runs
// after the mutation (K6); a crash in between can drop that event, the same
// guarantee the project integrations have.
for (const internalEvent of WEBHOOK_SOURCE_EVENTS) {
  void subscribeToEvent<Payload>(internalEvent, async (data) => {
    if (typeof data !== "object" || data === null) return;
    await enqueueInBackground(internalEvent, data);
  });
}
