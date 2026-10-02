import {
  AlarmClock,
  AlarmClockOff,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Ellipsis,
  Link as LinkIcon,
  type LucideIcon,
  Pencil,
  RotateCcw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { effectiveIntakeStatus, formatIntakeKey } from "@/lib/intake";
import type { IntakeActionSet, IntakeDetailAction } from "@/lib/intake-actions";
import type { IntakeItem } from "@/types/intake";
import IntakeStatusBadge from "./intake-status-badge";
import SnoozeIntakePopover from "./snooze-intake-popover";

const ACTION_META: Record<
  IntakeDetailAction,
  { labelKey: string; icon: LucideIcon; destructive?: boolean }
> = {
  accept: { labelKey: "intake:actions.accept", icon: Check },
  decline: { labelKey: "intake:actions.decline", icon: X },
  snooze: { labelKey: "intake:actions.snooze", icon: AlarmClock },
  unsnooze: { labelKey: "intake:actions.unsnooze", icon: AlarmClockOff },
  snoozeAgain: { labelKey: "intake:actions.snoozeAgain", icon: AlarmClock },
  duplicate: { labelKey: "intake:actions.duplicate", icon: Copy },
  reopen: { labelKey: "intake:actions.reopen", icon: RotateCcw },
  edit: { labelKey: "intake:detail.editRequest", icon: Pencil },
  withdraw: {
    labelKey: "intake:actions.withdraw",
    icon: Undo2,
    destructive: true,
  },
  delete: {
    labelKey: "intake:actions.delete",
    icon: Trash2,
    destructive: true,
  },
  copyLink: { labelKey: "intake:detail.copyLink", icon: LinkIcon },
  openTaskPage: { labelKey: "intake:detail.openTaskPage", icon: ArrowUpRight },
  openTask: { labelKey: "intake:detail.openTask", icon: ArrowUpRight },
};

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="text-muted-foreground"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

type IntakeDetailHeaderProps = {
  item: IntakeItem;
  /** Null while permissions load: no actions flash. */
  actions: IntakeActionSet | null;
  onAction: (action: IntakeDetailAction) => void;
  /** Called after a snooze from the header popover. */
  onSnoozed: (item: IntakeItem) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  /** Back to the list where only one pane fits (below 1024px). */
  onClose?: () => void;
  /** The Snooze popover's open state, so the S key can open it. */
  snoozeOpen?: boolean;
  onSnoozeOpenChange?: (open: boolean) => void;
};

/** Key, status and navigation on the left; the request's actions right. */
export default function IntakeDetailHeader({
  item,
  actions,
  onAction,
  onSnoozed,
  onPrevious,
  onNext,
  onClose,
  snoozeOpen,
  onSnoozeOpenChange,
}: IntakeDetailHeaderProps) {
  const { t } = useTranslation();
  const status = effectiveIntakeStatus(item);

  return (
    <TooltipProvider>
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-border border-b px-3 py-1.5">
        <div className="flex min-w-40 flex-1 items-center gap-2">
          {onClose && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("intake:triage.backToList")}
              onClick={onClose}
              className="text-muted-foreground lg:hidden"
            >
              <ArrowLeft />
            </Button>
          )}
          <span className="shrink-0 font-medium text-muted-foreground text-sm tabular-nums">
            {formatIntakeKey(item.task.key)}
          </span>
          <IntakeStatusBadge status={status} />
          <div className="hidden items-center md:flex">
            <NavButton
              label={t("intake:detail.previous")}
              disabled={!onPrevious}
              onClick={() => onPrevious?.()}
            >
              <ChevronUp />
            </NavButton>
            <NavButton
              label={t("intake:detail.next")}
              disabled={!onNext}
              onClick={() => onNext?.()}
            >
              <ChevronDown />
            </NavButton>
          </div>
        </div>
        {actions && (
          <div className="ms-auto flex shrink-0 items-center gap-1">
            {actions.buttons.map((action, index) => {
              const meta = ACTION_META[action];
              const Icon = meta.icon;
              if (action === "snooze") {
                return (
                  <SnoozeIntakePopover
                    key={action}
                    item={item}
                    onSnoozed={onSnoozed}
                    open={snoozeOpen}
                    onOpenChange={onSnoozeOpenChange}
                  />
                );
              }
              return (
                <Button
                  key={action}
                  variant={
                    index === 0 && action !== "edit" ? "default" : "outline"
                  }
                  size="xs"
                  className="gap-1"
                  onClick={() => onAction(action)}
                >
                  <Icon className="size-3" />
                  {t(meta.labelKey)}
                </Button>
              );
            })}
            {actions.menu.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("intake:detail.moreActions")}
                      title={t("intake:detail.moreActions")}
                    />
                  }
                >
                  <Ellipsis className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {actions.menu.map((action) => {
                    const meta = ACTION_META[action];
                    const Icon = meta.icon;
                    return (
                      <DropdownMenuItem
                        key={action}
                        className="gap-2"
                        variant={meta.destructive ? "destructive" : undefined}
                        onClick={() => onAction(action)}
                      >
                        <Icon className="size-4" />
                        {t(meta.labelKey)}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
