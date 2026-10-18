import { ListChecks } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "@/components/ui/menu";
import type { TaskTemplate } from "@/types/task-template";

/**
 * A menu of the project's task templates, opened from `trigger`. Used by
 * the create-task dialog and the quick add; callers render it only when the
 * project has templates.
 */
export default function TemplateMenu({
  templates,
  trigger,
  onPick,
  isDisabled,
  onOpenChange,
  align = "start",
}: {
  templates: readonly TaskTemplate[];
  trigger: ReactElement;
  onPick: (template: TaskTemplate) => void;
  /** True when a template can't be used right now. */
  isDisabled?: (template: TaskTemplate) => boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "end";
}) {
  const { t } = useTranslation();
  return (
    <Menu onOpenChange={(open) => onOpenChange?.(open)}>
      <MenuTrigger render={trigger} />
      <MenuPopup align={align} className="w-60 max-w-[calc(100vw-2rem)]">
        <MenuGroup>
          <MenuGroupLabel>{t("templates:use.menuLabel")}</MenuGroupLabel>
          {templates.map((template) => (
            <MenuItem
              key={template.id}
              disabled={isDisabled?.(template) ?? false}
              onClick={() => onPick(template)}
            >
              <span className="min-w-0 flex-1 truncate">{template.name}</span>
              {template.subtasks.length > 0 && (
                <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground text-xs tabular-nums">
                  <ListChecks aria-hidden className="size-3" />
                  <span className="sr-only">
                    {t("templates:settings.subtaskCount", {
                      count: template.subtasks.length,
                    })}
                  </span>
                  <span aria-hidden>{template.subtasks.length}</span>
                </span>
              )}
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
