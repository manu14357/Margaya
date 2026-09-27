import { Bell, BellOff, BellRing, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useToggleTaskSubscription from "@/hooks/mutations/subscription/use-toggle-task-subscription";
import useTaskSubscription from "@/hooks/queries/subscription/use-task-subscription";
import type { TaskSubscription } from "@/types/subscription";

const REASON_KEYS = {
  creator: "tasks:subscription.reasons.creator",
  assignee: "tasks:subscription.reasons.assignee",
  commenter: "tasks:subscription.reasons.commenter",
  mention: "tasks:subscription.reasons.mention",
  manual: "tasks:subscription.reasons.manual",
} as const;

type SubscriptionDisplay = {
  icon: LucideIcon;
  labelKey: string;
  tooltipKey: string;
};

/** Icon, label and tooltip of each subscription state (B10 §1.2). */
export function subscriptionDisplay(
  subscription: TaskSubscription,
): SubscriptionDisplay {
  if (subscription.subscribed) {
    const reason =
      subscription.reason ?? (subscription.isAssignee ? "assignee" : "manual");
    return {
      icon: BellRing,
      labelKey: "tasks:subscription.unsubscribe",
      tooltipKey: REASON_KEYS[reason],
    };
  }
  if (subscription.isAssignee && subscription.isMuted) {
    return {
      icon: BellOff,
      labelKey: "tasks:subscription.subscribe",
      tooltipKey: "tasks:subscription.mutedAssignee",
    };
  }
  return {
    icon: Bell,
    labelKey: "tasks:subscription.subscribe",
    tooltipKey: "tasks:subscription.notSubscribed",
  };
}

type TaskSubscribeButtonProps = {
  taskId: string | undefined;
  /** `icon` hides the label for tight headers. */
  size?: "sm" | "icon";
};

/** Subscribe to or unsubscribe from a task's updates. */
export default function TaskSubscribeButton({
  taskId,
  size = "sm",
}: TaskSubscribeButtonProps) {
  const { t } = useTranslation();
  const { data: subscription, isLoading } = useTaskSubscription(taskId);
  const { mutate, isPending } = useToggleTaskSubscription(taskId ?? "");

  if (!taskId) return null;
  if (isLoading) {
    return <Skeleton className={size === "icon" ? "h-7 w-7" : "h-7 w-24"} />;
  }
  if (!subscription) return null;

  const display = subscriptionDisplay(subscription);
  const Icon = display.icon;
  const label = t(display.labelKey);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size={size === "icon" ? "icon-sm" : "sm"}
            aria-label={label}
            aria-pressed={subscription.subscribed}
            onClick={() => {
              if (isPending) return;
              mutate(!subscription.subscribed);
            }}
            className="text-foreground"
          >
            <Icon className="size-4" />
            {size === "sm" && <span className="hidden sm:inline">{label}</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="flex max-w-64 flex-col gap-0.5">
            <p className="text-xs">{t(display.tooltipKey)}</p>
            <p className="text-muted-foreground text-xs">
              {t("tasks:subscription.count", {
                count: subscription.subscriberCount,
              })}
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
