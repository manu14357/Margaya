"use client";

import type { LucideIcon } from "lucide-react";
import {
  Bell,
  BellRing,
  Bot,
  Braces,
  Check,
  FolderGit2,
  GitPullRequest,
  Hash,
  MessageCircle,
  Plug,
  Send,
  Server,
  Webhook,
} from "lucide-react";
import { useMemo } from "react";
import { useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  step,
} from "../../demo";
import { cn } from "../../lib/cn";
import { ReplicaShell, TopBar } from "../../replica";
import { SettingsFrame } from "../../replica/settings-frame";
import {
  BUILT_IN,
  INTEGRATIONS,
  type IntegrationId,
  type IntegrationsAction,
  type IntegrationsState,
  initialIntegrationsState,
  integrationsReducer,
} from "./state";

/*
 * Monochrome glyphs only: no third-party logos. Where the app's settings
 * use a lucide glyph for a service, this uses the same one.
 */
const GLYPHS: Record<IntegrationId, LucideIcon> = {
  github: GitPullRequest,
  gitea: FolderGit2,
  slack: Hash,
  discord: MessageCircle,
  telegram: Send,
  mattermost: Server,
  ntfy: Bell,
  gotify: BellRing,
  webhooks: Webhook,
  api: Braces,
  mcp: Bot,
};

/** The integrations grid: Slack and Telegram get connected. */
export function createIntegrationsScene(): DemoScene<
  IntegrationsState,
  IntegrationsAction
> {
  return {
    id: "integrations",
    initialState: initialIntegrationsState,
    reducer: integrationsReducer,
    script: [
      step.wait(900),
      step.click("connect-slack", { type: "connect", id: "slack" }),
      step.wait(1100),
      step.click("connect-telegram", { type: "connect", id: "telegram" }),
      step.wait(3000),
    ],
    render: (props) => <IntegrationsView {...props} />,
  };
}

function IntegrationsView({
  state,
  dispatch,
  compact,
}: SceneRenderProps<IntegrationsState, IntegrationsAction>) {
  const copy = useLandingCopy().demo.integrations;
  return (
    <ReplicaShell>
      <TopBar
        compact
        place={
          <>
            <Plug aria-hidden className="size-4 text-muted-foreground" />
            <span className="truncate">{copy.title}</span>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <SettingsFrame wide title={copy.title} description={copy.subtitle}>
          <ul
            className={cn(
              "grid gap-2.5",
              compact ? "grid-cols-2" : "grid-cols-3",
            )}
          >
            {INTEGRATIONS.map((id) => {
              const Glyph = GLYPHS[id];
              const item = copy.items[id];
              const builtIn = BUILT_IN.includes(id);
              const connected = state.connected.includes(id);
              return (
                <li
                  key={id}
                  className={cn(
                    "flex flex-col gap-2.5 rounded-lg border bg-card p-3 transition-[border-color,box-shadow] duration-500",
                    state.fresh === id
                      ? "border-success/50 shadow-sm ring-2 ring-success/15"
                      : "border-border",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
                      <Glyph aria-hidden className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[13px] text-foreground">
                        {item.name}
                      </span>
                      <span className="block truncate text-muted-foreground text-xs">
                        {item.detail}
                      </span>
                    </span>
                  </div>
                  <div className="flex h-6 items-center">
                    {builtIn ? (
                      <span className="inline-flex h-5 items-center rounded-full border border-border px-2 font-medium text-[11px] text-muted-foreground">
                        {copy.builtIn}
                      </span>
                    ) : connected ? (
                      <button
                        type="button"
                        onClick={() => dispatch({ type: "disconnect", id })}
                        className="inline-flex h-5 cursor-pointer items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 font-medium text-[11px] text-success-foreground"
                      >
                        <Check aria-hidden className="size-3" />
                        {copy.connected}
                        {id === "slack" && (
                          <span className="font-normal opacity-80">
                            · {copy.channel}
                          </span>
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-demo={`connect-${id}`}
                        onClick={() => dispatch({ type: "connect", id })}
                        className="inline-flex h-6 cursor-pointer items-center rounded-md border border-input bg-background px-2 font-medium text-foreground text-xs shadow-xs/5 hover:bg-accent dark:bg-input/32"
                      >
                        {copy.connect}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </SettingsFrame>
      </div>
    </ReplicaShell>
  );
}

/** The integrations grid demo. */
export function IntegrationsDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createIntegrationsScene(), []);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.integrations.caption}
      description={copy.scenes.integrations.description}
      size={{ width: 760, height: 560 }}
      compactSize={{ width: 480, height: 780 }}
      compactBelow={420}
      className={className}
    />
  );
}
