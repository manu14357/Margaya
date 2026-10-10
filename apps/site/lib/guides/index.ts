import { bestFreeKanbanBoardSoftware } from "./best-free-kanban-board-software";
import { bestOpenSourceProjectManagement } from "./best-open-source-project-management-software";
import { euHostedProjectManagementGdpr } from "./eu-hosted-project-management-gdpr";
import { openSourceJiraAlternatives } from "./open-source-jira-alternatives";
import { projectManagementForSmallTeams } from "./project-management-for-small-teams";
import { projectManagementMcpAiAgents } from "./project-management-mcp-ai-agents";
import { projectManagementToolsWithFreeSso } from "./project-management-tools-with-free-sso";
import { selfHostProjectManagementDocker } from "./self-host-project-management-docker";
import { selfHostedTrelloAlternatives } from "./self-hosted-trello-alternatives";
import type { Guide } from "./types";

export { guideMarkdown } from "./markdown";
export type {
  Guide,
  GuideCallout,
  GuideCode,
  GuideItem,
  GuideSection,
  GuideShot,
  GuideStep,
  GuideTopic,
  ProductView,
} from "./types";
export { guidePath, guideTopics } from "./types";

// Ordered the way a new team would read them: set up, plan, connect, host, choose.
const all: Guide[] = [
  projectManagementForSmallTeams,
  bestFreeKanbanBoardSoftware,
  projectManagementMcpAiAgents,
  selfHostProjectManagementDocker,
  projectManagementToolsWithFreeSso,
  euHostedProjectManagementGdpr,
  selfHostedTrelloAlternatives,
  openSourceJiraAlternatives,
  bestOpenSourceProjectManagement,
];

export const guideList = all;

export const guides: Record<string, Guide> = Object.fromEntries(
  all.map((guide) => [guide.slug, guide]),
);

export function getGuide(slug: string) {
  return guides[slug];
}

/** Steps are numbered across the whole guide, not per section. */
export function countSteps(guide: Guide) {
  return guide.sections.reduce(
    (total, section) => total + (section.steps?.length ?? 0),
    0,
  );
}
