"use client";

import {
  AlarmClock,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleDashed,
  CircleX,
  Ellipsis,
  Inbox,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { type ReactNode, useId, useMemo } from "react";
import { fill, type LandingCopy, useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  step,
} from "../../demo";
import { cn } from "../../lib/cn";
import {
  Avatar,
  IconRail,
  Kbd,
  LabelChip,
  PriorityIcon,
  ReplicaButton,
  ReplicaShell,
  ReplicaToast,
  StatusIcon,
  ToneBadge,
  TopBar,
} from "../../replica";
import { ProjectCrumb } from "../planning/crumb";
import {
  type IntakeAction,
  type IntakeRequest,
  type IntakeState,
  intakeReducer,
  type RequestStatus,
} from "./state";

type Demo = LandingCopy["demo"];

export const ACCEPTED_REQUEST_ID = "invoices";
export const DECLINED_REQUEST_ID = "theme";

function initialRequests(demo: Demo): IntakeRequest[] {
  const { requests } = demo.intake;
  const { people, labels } = demo;
  return [
    {
      id: "guests",
      number: 38,
      ...requests.guests,
      submitter: people.sam.name,
      priority: "medium",
      label: { name: labels.feature, color: "purple" },
      status: "pending",
    },
    {
      id: "invoices",
      number: 39,
      ...requests.invoices,
      submitter: people.priya.name,
      priority: "high",
      label: { name: labels.feature, color: "purple" },
      status: "pending",
    },
    {
      id: "theme",
      number: 40,
      ...requests.theme,
      submitter: people.jonas.name,
      priority: "low",
      label: { name: labels.design, color: "pink" },
      status: "pending",
    },
    {
      id: "weeks",
      number: 41,
      ...requests.weeks,
      submitter: people.mira.name,
      priority: "none",
      label: { name: labels.feature, color: "purple" },
      status: "pending",
    },
  ];
}

/**
 * The intake queue: J and K move, A accepts into To do through the accept
 * dialog, D declines with a typed reason.
 */
export function createIntakeScene(
  demo: Demo,
): DemoScene<IntakeState, IntakeAction> {
  return {
    id: "intake",
    initialState: {
      requests: initialRequests(demo),
      selectedId: "guests",
      dialog: null,
      toast: null,
    },
    reducer: intakeReducer,
    script: [
      step.wait(800),
      step.key("j", { type: "move", delta: 1 }),
      step.wait(250),
      step.key("j", { type: "move", delta: 1 }),
      step.wait(250),
      step.key("k", { type: "move", delta: -1 }),
      step.wait(500),
      step.key("a", { type: "openAccept" }),
      step.wait(700),
      step.click("accept-submit", {
        type: "accept",
        column: demo.statuses.todo,
      }),
      step.wait(1800),
      step.key("j", { type: "move", delta: 1 }),
      step.wait(500),
      step.key("d", { type: "openDecline" }),
      step.wait(400),
      step.click("decline-reason", { type: "focusReason" }),
      step.type(
        "decline-reason",
        demo.intake.decline.typed,
        (value) => ({ type: "reason", value }),
        26,
      ),
      step.wait(400),
      step.click("decline-submit", { type: "decline" }),
      step.wait(3400),
    ],
    render: (props) => <IntakeView {...props} />,
  };
}

const STATUS_BADGE: Record<
  RequestStatus,
  { tone: "outline" | "success" | "error"; icon: typeof CircleCheck }
> = {
  pending: { tone: "outline", icon: CircleDashed },
  accepted: { tone: "success", icon: CircleCheck },
  declined: { tone: "error", icon: CircleX },
};

function RequestBadge({ status }: { status: RequestStatus }) {
  const labels = useLandingCopy().demo.intake.status;
  const { tone, icon } = STATUS_BADGE[status];
  return (
    <ToneBadge tone={tone} icon={icon}>
      {labels[status]}
    </ToneBadge>
  );
}

function IntakeView({
  state,
  dispatch,
  compact,
}: SceneRenderProps<IntakeState, IntakeAction>) {
  const demo = useLandingCopy().demo;
  const { intake, planning, statuses } = demo;
  const keyOf = (request: IntakeRequest) =>
    `${demo.hero.projectKey}-${request.number}`;
  const open = state.requests.filter((request) => request.status === "pending");
  const current = state.requests.find(
    (request) => request.id === state.selectedId,
  );
  const toastRequest = state.requests.find(
    (request) => request.id === state.toast,
  );

  const list = (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-card",
        compact
          ? "shrink-0 border-border border-b"
          : "w-[340px] shrink-0 border-border border-r",
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-border border-b px-2">
        {[
          { id: "open", label: intake.open, count: open.length, active: true },
          {
            id: "closed",
            label: intake.closed,
            count: state.requests.length - open.length,
            active: false,
          },
        ].map((tab) => (
          <span
            key={tab.id}
            className="relative flex h-10 items-center"
            aria-current={tab.active ? "page" : undefined}
          >
            <span
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-2 font-medium text-[13px]",
                tab.active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {tab.label}
              <span className="flex h-5 min-w-5 items-center justify-center rounded-sm border border-border/60 px-1 text-[11px] text-muted-foreground tabular-nums">
                {tab.count}
              </span>
            </span>
            {tab.active && (
              <span
                aria-hidden
                className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary"
              />
            )}
          </span>
        ))}
      </div>
      <ul className="min-h-0 flex-1 overflow-hidden">
        {state.requests.map((request) => {
          const isSelected = request.id === state.selectedId;
          const detail =
            request.status === "accepted" && request.column
              ? fill(intake.acceptedInto, { column: request.column })
              : request.time;
          return (
            <li key={request.id}>
              <button
                type="button"
                data-demo={`request-${request.id}`}
                aria-current={isSelected ? "true" : undefined}
                onClick={() => dispatch({ type: "select", id: request.id })}
                className={cn(
                  "flex w-full cursor-pointer flex-col gap-1 border-border/60 border-b px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  isSelected && "bg-accent hover:bg-accent",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {keyOf(request)}
                  </span>
                  {request.status !== "pending" && (
                    <RequestBadge status={request.status} />
                  )}
                  <span className="ms-auto flex shrink-0 items-center">
                    <PriorityIcon
                      priority={request.priority}
                      className="size-3.5"
                    />
                  </span>
                </span>
                <span className="line-clamp-1 text-sm">{request.title}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
                  <Avatar name={request.submitter} size="xs" />
                  <span className="truncate">{request.submitter}</span>
                  <span aria-hidden>·</span>
                  <span className="shrink-0">{detail}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!compact && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-border/80 border-t px-3 py-1.5 text-muted-foreground text-xs">
          <span className="inline-flex items-center gap-1">
            <Kbd>J</Kbd>
            <Kbd>K</Kbd>
            {intake.hints.move}
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>A</Kbd>
            {intake.hints.accept}
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>D</Kbd>
            {intake.hints.decline}
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>S</Kbd>
            {intake.hints.snooze}
          </span>
        </div>
      )}
    </div>
  );

  const detail = current && (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
      data-demo="request-detail"
    >
      <div className="flex min-h-11 shrink-0 items-center gap-2 border-border border-b px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 font-medium text-muted-foreground text-sm tabular-nums">
            {keyOf(current)}
          </span>
          <RequestBadge status={current.status} />
          {!compact && (
            <span className="flex items-center text-muted-foreground">
              <span className="flex size-6 items-center justify-center">
                <ChevronUp aria-hidden className="size-4" />
              </span>
              <span className="flex size-6 items-center justify-center">
                <ChevronDown aria-hidden className="size-4" />
              </span>
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {current.status === "pending" ? (
            <>
              <HeaderButton
                primary
                icon={<Check className="size-3" />}
                data-demo="accept-button"
                onClick={() => dispatch({ type: "openAccept" })}
              >
                {intake.actions.accept}
              </HeaderButton>
              <HeaderButton
                icon={<X className="size-3" />}
                data-demo="decline-button"
                onClick={() => dispatch({ type: "openDecline" })}
              >
                {intake.actions.decline}
              </HeaderButton>
              {!compact && (
                <HeaderButton icon={<AlarmClock className="size-3" />}>
                  {intake.actions.snooze}
                </HeaderButton>
              )}
            </>
          ) : current.status === "accepted" ? (
            <HeaderButton primary>{intake.actions.openTask}</HeaderButton>
          ) : (
            <HeaderButton icon={<RotateCcw className="size-3" />}>
              {intake.actions.reopen}
            </HeaderButton>
          )}
          <span className="flex size-7 items-center justify-center text-muted-foreground">
            <Ellipsis aria-hidden className="size-4" />
          </span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
        {current.status === "accepted" && (
          <Banner tone="success">
            {fill(intake.acceptedBanner, {
              column: current.column ?? statuses.todo,
              name: demo.people.adam.name,
            })}
          </Banner>
        )}
        {current.status === "declined" && (
          <Banner tone="error">
            <span>
              {fill(intake.declinedBanner, { name: demo.people.adam.name })}
            </span>
            {current.reason && (
              <span className="text-muted-foreground">
                {fill(intake.reason, { note: current.reason })}
              </span>
            )}
          </Banner>
        )}
        <div className={cn("flex gap-6", compact && "flex-col gap-3")}>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <h2 className="font-semibold text-xl leading-snug">
              {current.title}
            </h2>
            <p className="text-muted-foreground text-xs">
              {fill(intake.submittedBy, {
                name: current.submitter,
                time: current.time,
              })}
              <span aria-hidden> · </span>
              {fill(intake.via, { source: current.source })}
            </p>
            <span className="block h-px w-full shrink-0 bg-border" />
            <p className="text-foreground/90 text-sm leading-relaxed">
              {current.body}
            </p>
          </div>
          {!compact && (
            <aside className="w-52 shrink-0 space-y-2 border-border border-l ps-4">
              <h3 className="font-medium text-muted-foreground text-xs">
                {intake.properties}
              </h3>
              <div className="flex items-center gap-2 text-sm">
                <span className="w-16 text-muted-foreground text-xs">
                  {intake.priority}
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs">
                  <PriorityIcon priority={current.priority} />
                  {demo.priorities[current.priority]}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="w-16 text-muted-foreground text-xs">
                  {intake.labels}
                </span>
                <LabelChip
                  name={current.label.name}
                  color={current.label.color}
                />
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <ReplicaShell
      rail={
        compact ? undefined : (
          <IconRail
            active="projects"
            user={demo.people.adam.name}
            inboxCount={3}
          />
        )
      }
    >
      <TopBar
        compact={compact}
        place={
          <ProjectCrumb project={demo.projects.website} icon={Inbox}>
            {planning.sections.intake}
          </ProjectCrumb>
        }
        actions={
          <ReplicaButton variant="primary" icon={Plus}>
            {intake.newRequest}
          </ReplicaButton>
        }
      />
      <div
        className={cn("relative flex min-h-0 flex-1", compact && "flex-col")}
      >
        {list}
        {detail}
        {toastRequest && (
          // Lifted clear of the stage's play button in the corner.
          <div className="pointer-events-none absolute inset-x-0 top-0 bottom-10">
            <ReplicaToast>
              {fill(intake.toast, {
                key: keyOf(toastRequest),
                column: toastRequest.column ?? statuses.todo,
              })}
            </ReplicaToast>
          </div>
        )}
        {state.dialog && current && (
          <IntakeDialogView
            state={state}
            request={current}
            taskKey={keyOf(current)}
            dispatch={dispatch}
          />
        )}
      </div>
    </ReplicaShell>
  );
}

function HeaderButton({
  primary = false,
  icon,
  children,
  onClick,
  "data-demo": target,
}: {
  primary?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  "data-demo"?: string;
}) {
  return (
    <button
      type="button"
      data-demo={target}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-2.5 font-medium text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
        primary
          ? "border-primary bg-primary text-primary-foreground shadow-primary/24 shadow-xs"
          : "border-input bg-popover text-foreground shadow-xs/5 dark:bg-input/32",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: ReactNode;
}) {
  const Icon = tone === "success" ? CircleCheck : CircleX;
  return (
    <div
      data-demo="outcome-banner"
      className={cn(
        "flex items-start gap-2 rounded-xl border px-3.5 py-3 text-sm",
        tone === "success"
          ? "border-success/32 bg-success/4 text-foreground"
          : "border-destructive/32 bg-destructive/4 text-foreground",
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "success"
            ? "text-success-foreground"
            : "text-destructive-foreground",
        )}
      />
      <span className="flex flex-col gap-0.5">{children}</span>
    </div>
  );
}

function IntakeDialogView({
  state,
  request,
  taskKey,
  dispatch,
}: {
  state: IntakeState;
  request: IntakeRequest;
  taskKey: string;
  dispatch: (action: IntakeAction) => void;
}) {
  const demo = useLandingCopy().demo;
  const { intake, statuses } = demo;
  const reasonId = useId();
  const dialog = state.dialog;
  if (!dialog) return null;
  const accept = dialog.kind === "accept";
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/32 p-6 backdrop-blur-[1px] transition-opacity duration-200 starting:opacity-0">
      <div
        role="dialog"
        aria-label={fill(accept ? intake.accept.title : intake.decline.title, {
          key: taskKey,
        })}
        data-demo={accept ? "accept-dialog" : "decline-dialog"}
        className="w-[420px] max-w-full overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-lg/5 transition-[scale,opacity] duration-200 starting:scale-95 starting:opacity-0"
      >
        <div className="space-y-1.5 p-6 pb-4">
          <h2 className="font-semibold text-lg leading-none">
            {fill(accept ? intake.accept.title : intake.decline.title, {
              key: taskKey,
            })}
          </h2>
          <p className="text-muted-foreground text-sm">
            {accept ? intake.accept.description : intake.decline.description}
          </p>
        </div>
        <div className="flex flex-col gap-1.5 px-6 pb-4">
          {accept ? (
            <>
              <span className="font-medium text-xs">
                {intake.accept.column}
              </span>
              <span className="flex h-8 items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-sm shadow-xs/5 dark:bg-input/32">
                <StatusIcon status="todo" colored className="size-3.5" />
                <span className="flex-1">{statuses.todo}</span>
                <ChevronDown
                  aria-hidden
                  className="size-3.5 text-muted-foreground"
                />
              </span>
              <span className="truncate text-muted-foreground text-xs">
                {request.title}
              </span>
            </>
          ) : (
            <>
              <label htmlFor={reasonId} className="font-medium text-xs">
                {intake.decline.reasonLabel}
              </label>
              <textarea
                id={reasonId}
                data-demo="decline-reason"
                rows={3}
                value={dialog.kind === "decline" ? dialog.reason : ""}
                placeholder={intake.decline.placeholder}
                onFocus={() => dispatch({ type: "focusReason" })}
                onChange={(event) =>
                  dispatch({ type: "reason", value: event.target.value })
                }
                className={cn(
                  "w-full resize-none rounded-lg border border-input bg-background px-2.5 py-2 text-sm shadow-xs/5 outline-none placeholder:text-muted-foreground dark:bg-input/32",
                  dialog.kind === "decline" &&
                    dialog.focused &&
                    "border-ring ring-[3px] ring-ring/24",
                )}
              />
              <p className="text-muted-foreground text-xs">
                {intake.decline.reasonHint}
              </p>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-border border-t bg-muted/72 px-6 py-4">
          <button
            type="button"
            onClick={() => dispatch({ type: "closeDialog" })}
            className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-input bg-popover px-3 font-medium text-sm shadow-xs/5 outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/32"
          >
            {intake.actions.cancel}
          </button>
          <button
            type="button"
            data-demo={accept ? "accept-submit" : "decline-submit"}
            onClick={() =>
              dispatch(
                accept
                  ? { type: "accept", column: statuses.todo }
                  : { type: "decline" },
              )
            }
            className={cn(
              "inline-flex h-8 cursor-pointer items-center rounded-lg border px-3 font-medium text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
              accept
                ? "border-primary bg-primary text-primary-foreground"
                : "border-destructive bg-destructive text-white",
            )}
          >
            {accept ? intake.actions.accept : intake.actions.decline}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The intake demo, ready to drop into a section. */
export function IntakeDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createIntakeScene(copy.demo), [copy.demo]);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.intake.caption}
      description={copy.scenes.intake.description}
      size={{ width: 960, height: 600 }}
      compactSize={{ width: 560, height: 760 }}
      className={className}
    />
  );
}
