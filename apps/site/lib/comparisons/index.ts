import { asana } from "./asana";
import { azureDevops } from "./azure-devops";
import { basecamp } from "./basecamp";
import { clickup } from "./clickup";
import { focalboard } from "./focalboard";
import { githubProjects } from "./github-projects";
import { huly } from "./huly";
import { jira } from "./jira";
import { kanboard } from "./kanboard";
import { leantime } from "./leantime";
import { linear } from "./linear";
import { monday } from "./monday";
import { notion } from "./notion";
import { openproject } from "./openproject";
import { redmine } from "./redmine";
import { shortcut } from "./shortcut";
import { taiga } from "./taiga";
import { trello } from "./trello";
import type { Comparison, ComparisonCategory } from "./types";
import { vikunja } from "./vikunja";
import { wekan } from "./wekan";
import { wrike } from "./wrike";
import { youtrack } from "./youtrack";

export {
  cellMark,
  cellNote,
  compareAreas,
  compareFeatures,
  MARGAYA_GLANCE,
} from "./features";
export type {
  Cell,
  Comparison,
  ComparisonCategory,
  FeatureKey,
  Mark,
  ProductView,
} from "./types";
export { alternativePath } from "./types";

// Most-searched first: listing pages, the sitemap and llms.txt keep this order.
const all: Comparison[] = [
  jira,
  trello,
  asana,
  linear,
  monday,
  clickup,
  notion,
  basecamp,
  wrike,
  githubProjects,
  azureDevops,
  youtrack,
  shortcut,
  openproject,
  redmine,
  taiga,
  vikunja,
  wekan,
  kanboard,
  focalboard,
  leantime,
  huly,
];

export const comparisonList = all;

export const comparisons: Record<string, Comparison> = Object.fromEntries(
  all.map((comparison) => [comparison.slug, comparison]),
);

export function getComparison(slug: string) {
  return comparisons[slug];
}

export const comparisonSlugs = all.map((comparison) => comparison.slug);

export const comparisonCategories: {
  id: ComparisonCategory;
  label: string;
}[] = [
  { id: "issue-tracker", label: "Issue trackers" },
  { id: "kanban", label: "Kanban boards" },
  { id: "all-in-one", label: "All-in-one workspaces" },
  { id: "open-source", label: "Open source & self-hosted" },
];
