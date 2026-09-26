import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type AutomationRuleRowProps = {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  enabled: boolean;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
  /** A muted line under the description (why the switch is off-limits). */
  hint?: ReactNode;
  /** The rule's settings, shown while it is on. */
  children?: ReactNode;
};

/** One scheduled automation: the Features page row, plus its settings. */
export default function AutomationRuleRow({
  id,
  icon: Icon,
  title,
  description,
  enabled,
  disabled,
  onToggle,
  hint,
  children,
}: AutomationRuleRowProps) {
  const switchId = `project-automation-${id}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-card">
            <Icon className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor={switchId} className="font-medium text-sm">
              {title}
            </Label>
            <p className="text-muted-foreground text-xs">{description}</p>
            {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
          </div>
        </div>
        <Switch
          id={switchId}
          checked={enabled}
          onCheckedChange={disabled ? undefined : onToggle}
          disabled={disabled}
        />
      </div>
      {enabled && children && <div className="space-y-2 pl-11">{children}</div>}
    </div>
  );
}
