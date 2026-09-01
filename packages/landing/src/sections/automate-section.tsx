"use client";

import { useLandingCopy } from "../copy";
import { LazyMount } from "../lib/lazy-mount";
import { ApiDemo } from "../scenes/api/api-card";
import { IntegrationsDemo } from "../scenes/integrations/integrations-scene";
import { JiraImportDemo } from "../scenes/jira/jira-scene";
import { McpDemo } from "../scenes/mcp/mcp-scene";
import { LandingSection } from "./section";

/**
 * Owner: L4. Integrations grid, REST API snippet, MCP demo and Jira import.
 */
export function AutomateSection() {
  const copy = useLandingCopy().home.automate;
  return (
    <LandingSection id="automate" copy={copy}>
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-8">
        <LazyMount className="aspect-[19/14]">
          <IntegrationsDemo />
        </LazyMount>
        <ApiDemo />
        <LazyMount className="aspect-[19/14]">
          <McpDemo />
        </LazyMount>
        <LazyMount className="aspect-[19/14]">
          <JiraImportDemo />
        </LazyMount>
      </div>
    </LandingSection>
  );
}
