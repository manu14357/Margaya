"use client";

import {
  ApiDemo,
  CyclesDemo,
  DocsSlashDemo,
  DocsTasksDemo,
  DocsTogetherDemo,
  EstimatesPreview,
  HeroDemo,
  IntakeDemo,
  IntegrationsDemo,
  JiraImportDemo,
  McpDemo,
  ModulesDemo,
  SpreadsheetViewDemo,
  TimelineViewsDemo,
  TrustDemo,
  ViewsDemo,
} from "@margaya/landing";
import type { ComponentType } from "react";
import type { FeatureCopyKey } from "@/lib/features";

type SceneComponent = ComponentType<{ className?: string }>;

/**
 * The demo shown beside each feature-page section, keyed by
 * `<page copy key>.<section key>` (see `landing.pages` in i18n/en-US.json).
 *
 * - A component: the live scene from `@margaya/landing`.
 * - `"pending"`: a scene is planned; a placeholder holds its place until the
 *   scene lands in the package, then swap in the component here.
 * - Missing: the section is text only.
 */
const scenes: Partial<Record<string, SceneComponent | "pending">> = {
  "plan.cycles": CyclesDemo,
  "plan.modules": ModulesDemo,
  "plan.estimates": EstimatesPreview,
  "plan.intake": IntakeDemo,
  "views.board": HeroDemo,
  "views.spreadsheet": SpreadsheetViewDemo,
  "views.timeline": TimelineViewsDemo,
  "views.saved": ViewsDemo,
  "docs.together": DocsTogetherDemo,
  "docs.slash": DocsSlashDemo,
  "docs.tasks": DocsTasksDemo,
  "automate.integrations": IntegrationsDemo,
  "automate.api": ApiDemo,
  "automate.mcp": McpDemo,
  "automate.jira": JiraImportDemo,
  "selfHost.safety": TrustDemo,
};

export function featureScene(page: FeatureCopyKey, section: string) {
  return scenes[`${page}.${section}`];
}
