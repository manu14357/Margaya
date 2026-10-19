import createNotification from "./controllers/create-notification";

/**
 * The single entry point for server-initiated notices that are not task
 * events: agent approval requests, flow alerts and cycle rollover summaries.
 * Task activity (comments, descriptions, mentions) goes through
 * notifyTaskEvent instead. Preferences, resource access and delivery are
 * still applied by createNotification.
 */
export function notifySystem(
  input: Parameters<typeof createNotification>[0],
): ReturnType<typeof createNotification> {
  return createNotification(input);
}
