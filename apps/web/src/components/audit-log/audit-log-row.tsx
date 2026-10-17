import { Bot, ChevronRight, KeyRound, ServerCog } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { auditActionSentence } from "@/lib/audit-log/actions";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import type { AuditLogEntry } from "@/types/audit-log";
import { AuditLogDetails } from "./audit-log-details";

const TARGET_TYPE_KEYS: Record<string, string> = {
  invitation: "settings:workspaceAuditLog.targets.invitation",
  user: "settings:workspaceAuditLog.targets.user",
  role: "settings:workspaceAuditLog.targets.role",
  api_key: "settings:workspaceAuditLog.targets.apiKey",
  webhook: "settings:workspaceAuditLog.targets.webhook",
  integration: "settings:workspaceAuditLog.targets.integration",
  workspace: "settings:workspaceAuditLog.targets.workspace",
  project: "settings:workspaceAuditLog.targets.project",
  export: "settings:workspaceAuditLog.targets.export",
  page: "settings:workspaceAuditLog.targets.page",
  agent: "settings:workspaceAuditLog.targets.agent",
  agent_run: "settings:workspaceAuditLog.targets.agentRun",
  task: "settings:workspaceAuditLog.targets.task",
  coding_agent_profile: "settings:workspaceAuditLog.targets.codingAgentProfile",
};

const COLUMN_COUNT = 5;

function ActorCell({ entry }: { entry: AuditLogEntry }) {
  const { t } = useTranslation();
  const { actor } = entry;
  if (actor.type === "system") {
    return (
      <span className="flex items-center gap-2 text-muted-foreground">
        <ServerCog className="size-4" aria-hidden />
        {t("settings:workspaceAuditLog.actor.system")}
      </span>
    );
  }
  if (actor.type === "api_key") {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
          <KeyRound className="size-3.5" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block truncate">
            {actor.name ?? t("settings:workspaceAuditLog.actor.unknownKey")}
          </span>
          <span className="block text-muted-foreground text-xs">
            {t("settings:workspaceAuditLog.actor.apiKey")}
          </span>
        </span>
      </span>
    );
  }
  if (actor.type === "automation") {
    // A project automation rule: "Automation", with the rule's name.
    const meta = (entry.metadata ?? {}) as Record<string, unknown>;
    const ruleName = typeof meta.ruleName === "string" ? meta.ruleName : null;
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
          <Bot className="size-3.5" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block truncate">
            {t("settings:workspaceAuditLog.actor.automation")}
          </span>
          {ruleName && (
            <span className="block truncate text-muted-foreground text-xs">
              {ruleName}
            </span>
          )}
        </span>
      </span>
    );
  }
  const name = actor.name ?? t("settings:workspaceAuditLog.actor.deletedUser");
  if (actor.type === "agent") {
    // "Agent X on behalf of Y".
    const meta = (entry.metadata ?? {}) as Record<string, unknown>;
    const onBehalfOf =
      typeof meta.onBehalfOfName === "string" ? meta.onBehalfOfName : null;
    return (
      <span className="flex min-w-0 items-center gap-2">
        <Avatar className="size-6">
          {actor.image && <AvatarImage src={actor.image} alt="" />}
          <AvatarFallback className="text-[10px]">
            <Bot className="size-3.5" aria-hidden />
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0">
          <span className="block truncate">{name}</span>
          <span className="block truncate text-muted-foreground text-xs">
            {onBehalfOf
              ? t("settings:workspaceAuditLog.actor.agentFor", {
                  name: onBehalfOf,
                })
              : t("settings:workspaceAuditLog.actor.agent")}
          </span>
        </span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar className="size-6">
        {actor.image && <AvatarImage src={actor.image} alt="" />}
        <AvatarFallback className="text-[10px]">
          {getInitials(name)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">{name}</span>
    </span>
  );
}

type AuditLogRowProps = {
  entry: AuditLogEntry;
  expanded: boolean;
  onToggle: () => void;
};

export function AuditLogRow({ entry, expanded, onToggle }: AuditLogRowProps) {
  const { t } = useTranslation();
  const sentence = auditActionSentence(entry.action);
  const detailsId = `audit-details-${entry.id}`;
  const targetTypeKey = entry.target
    ? TARGET_TYPE_KEYS[entry.target.type]
    : undefined;

  return (
    <>
      <TableRow className={cn(expanded && "border-b-0")}>
        <TableCell className="w-px">
          <Tooltip>
            <TooltipTrigger
              render={
                <time
                  dateTime={String(entry.createdAt)}
                  className="cursor-default whitespace-nowrap text-muted-foreground"
                />
              }
            >
              {formatRelativeTime(entry.createdAt)}
            </TooltipTrigger>
            <TooltipContent>{formatDateTime(entry.createdAt)}</TooltipContent>
          </Tooltip>
        </TableCell>
        <TableCell className="max-w-48">
          <ActorCell entry={entry} />
        </TableCell>
        <TableCell>{t(sentence.key, sentence.values)}</TableCell>
        <TableCell className="hidden max-w-60 md:table-cell">
          {entry.target ? (
            <span className="block min-w-0">
              <span className="block truncate">
                {entry.target.label ?? "—"}
              </span>
              {targetTypeKey && (
                <span className="block text-muted-foreground text-xs">
                  {t(targetTypeKey)}
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="w-px text-right">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={expanded}
            aria-controls={detailsId}
            aria-label={
              expanded
                ? t("settings:workspaceAuditLog.hideDetails")
                : t("settings:workspaceAuditLog.showDetails")
            }
            onClick={onToggle}
          >
            <ChevronRight
              className={cn("transition-transform", expanded && "rotate-90")}
            />
          </Button>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow id={detailsId} className="hover:bg-transparent">
          <TableCell colSpan={COLUMN_COUNT} className="bg-muted/30 px-4 py-3">
            {entry.target && (
              <p className="mb-2 text-sm md:hidden">
                {entry.target.label ?? "—"}
              </p>
            )}
            <AuditLogDetails entry={entry} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default AuditLogRow;
