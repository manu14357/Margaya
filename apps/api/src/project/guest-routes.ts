// The workspace routes a guest may call without naming a project. A guest
// reaches their projects; anything that is about the workspace answers 404
// (project/visibility.ts). This list is the fence: a route that is not here
// fails closed, so a new workspace-wide route never leaks to guests by
// accident. Add a route only when its handler narrows its answer to the
// caller's visible projects, or when it holds no workspace data at all.
const GUEST_WORKSPACE_ROUTES: readonly RegExp[] = [
  // Narrowed by hiddenProjectIds.
  /^GET \/api\/project$/,
  /^POST \/api\/task-query$/,
  /^GET \/api\/search$/,
  /^GET \/api\/notification\/(inbox|counts)$/,
  /^GET \/api\/activity\/mine$/,
  /^GET \/api\/project-update\/workspace\/[^/]+\/latest$/,
  /^GET \/api\/time-entry\/running$/,
  // Answers 404 for a task in a hidden project.
  /^GET \/api\/task\/by-key\/[^/]+\/[^/]+$/,
  // The caller's own, resolved through entity-reference, which leaves out
  // hidden projects and, for guests, anything outside a project.
  /^(GET|POST) \/api\/recent-visit$/,
  /^(GET|POST) \/api\/favorite$/,
  /^PUT \/api\/favorite\/reorder$/,
  /^DELETE \/api\/favorite\/.+$/,
  // The caller's own calendar feeds; each fetch leaves out hidden projects
  // (calendar-feed/access.ts).
  /^(GET|POST) \/api\/calendar-feed\/workspace\/[^/]+$/,
  // The caller's own project roles (cappingProjectRoles).
  /^GET \/api\/project\/access\/mine$/,
  // No workspace data: view definitions, the time zone, AI on or off.
  /^GET \/api\/view\/built-in$/,
  /^GET \/api\/workspace\/[^/]+\/settings$/,
  /^GET \/api\/ai\/availability$/,
];

/** Whether a guest may make this request, which names no project itself. */
export function guestWorkspaceRouteAllowed(
  method: string,
  path: string,
  query: { projectId?: string },
): boolean {
  const route = `${method.toUpperCase()} ${path.replace(/\/+$/, "")}`;
  // A project's views: viewProjectScope checks the project. Without one this
  // lists the workspace's views.
  if (route === "GET /api/view") return Boolean(query.projectId);
  return GUEST_WORKSPACE_ROUTES.some((allowed) => allowed.test(route));
}
