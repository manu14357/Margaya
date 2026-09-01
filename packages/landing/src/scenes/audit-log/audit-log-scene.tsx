"use client";

import {
  CalendarDays,
  Download,
  KeyRound,
  ListFilter,
  ServerCog,
  Settings,
  UserRound,
} from "lucide-react";
import { useMemo } from "react";
import { type LandingCopy, useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  step,
} from "../../demo";
import { cn } from "../../lib/cn";
import {
  Avatar,
  FilterChip,
  ReplicaButton,
  ReplicaShell,
  TopBar,
} from "../../replica";
import { SettingsFrame } from "../../replica/settings-frame";
import {
  type AuditAction,
  type AuditEntryId,
  type AuditState,
  auditReducer,
  initialAuditState,
} from "./state";

type Demo = LandingCopy["demo"];

type Actor =
  | { kind: "person"; person: keyof Demo["people"] }
  | { kind: "apiKey" }
  | { kind: "system" };

const ACTORS: Record<AuditEntryId, Actor> = {
  apiKey: { kind: "person", person: "adam" },
  integration: { kind: "person", person: "mira" },
  webhook: { kind: "person", person: "jonas" },
  role: { kind: "person", person: "adam" },
  publicBoard: { kind: "person", person: "mira" },
  purge: { kind: "system" },
  import: { kind: "apiKey" },
};

/** The workspace audit log, with new entries arriving at the top. */
export function createAuditLogScene(): DemoScene<AuditState, AuditAction> {
  return {
    id: "audit-log",
    initialState: initialAuditState,
    reducer: auditReducer,
    script: [
      step.wait(1000),
      step.set({ type: "arrive", id: "webhook" }),
      step.wait(1500),
      step.set({ type: "arrive", id: "integration" }),
      step.wait(1500),
      step.set({ type: "arrive", id: "apiKey" }),
      step.wait(1400),
      step.set({ type: "settle" }),
      step.wait(2200),
    ],
    render: (props) => <AuditLogView {...props} />,
  };
}

function ActorCell({ actor }: { actor: Actor }) {
  const demo = useLandingCopy().demo;
  const copy = demo.auditLog;
  if (actor.kind === "system") {
    return (
      <span className="flex items-center gap-2 text-muted-foreground">
        <ServerCog aria-hidden className="size-4" />
        {copy.system}
      </span>
    );
  }
  if (actor.kind === "apiKey") {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
          <KeyRound aria-hidden className="size-3.5" />
        </span>
        <span className="min-w-0 leading-4">
          <span className="block truncate">{copy.keyActor}</span>
          <span className="block text-muted-foreground text-xs">
            {copy.apiKey}
          </span>
        </span>
      </span>
    );
  }
  const name = demo.people[actor.person].name;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={name} size="md" />
      <span className="truncate">{name}</span>
    </span>
  );
}

function AuditLogView({
  state,
  compact,
}: SceneRenderProps<AuditState, AuditAction>) {
  const demo = useLandingCopy().demo;
  const copy = demo.auditLog;
  return (
    <ReplicaShell>
      <TopBar
        compact
        place={
          <>
            <Settings aria-hidden className="size-4 text-muted-foreground" />
            <span className="truncate">{copy.title}</span>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <SettingsFrame
          wide
          title={copy.title}
          description={compact ? undefined : copy.subtitle}
          actions={
            compact ? undefined : (
              <ReplicaButton icon={Download}>{copy.export}</ReplicaButton>
            )
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <FilterChip icon={UserRound}>{copy.filters.anyone}</FilterChip>
              <FilterChip icon={ListFilter}>
                {copy.filters.allActions}
              </FilterChip>
              <FilterChip icon={CalendarDays}>
                {copy.filters.anyTime}
              </FilterChip>
            </div>
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <table className="w-full table-fixed text-[13px]">
                <thead className="border-border border-b text-left text-muted-foreground text-xs">
                  <tr>
                    <th className="w-24 px-3 py-2 font-medium">
                      {copy.columns.time}
                    </th>
                    <th className="w-40 px-3 py-2 font-medium">
                      {copy.columns.actor}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {copy.columns.action}
                    </th>
                    {!compact && (
                      <th className="w-36 px-3 py-2 font-medium">
                        {copy.columns.target}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {state.entries.map((id) => {
                    const entry = copy.entries[id];
                    return (
                      <tr
                        key={id}
                        data-demo={`audit-${id}`}
                        className={cn(
                          "border-border/60 border-b align-middle transition-colors duration-700 last:border-b-0",
                          state.fresh === id
                            ? "bg-accent/60"
                            : "bg-transparent",
                        )}
                      >
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                          {entry.time}
                        </td>
                        <td className="px-3 py-2.5">
                          <ActorCell actor={ACTORS[id]} />
                        </td>
                        <td className="px-3 py-2.5 text-foreground">
                          {entry.action}
                        </td>
                        {!compact && (
                          <td className="px-3 py-2.5">
                            <span className="block truncate">
                              {entry.target}
                            </span>
                            <span className="block text-muted-foreground text-xs">
                              {entry.type}
                            </span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </SettingsFrame>
      </div>
    </ReplicaShell>
  );
}

/** The audit log demo. */
export function AuditLogDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createAuditLogScene(), []);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.auditLog.caption}
      description={copy.scenes.auditLog.description}
      size={{ width: 760, height: 560 }}
      compactSize={{ width: 480, height: 600 }}
      compactBelow={420}
      className={className}
    />
  );
}
