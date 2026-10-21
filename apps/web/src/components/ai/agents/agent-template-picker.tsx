import { Bot, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentTemplate } from "@/fetchers/ai/agents";
import { cn } from "@/lib/cn";

// The new-agent form starts blank or from a template: picking one fills
// the name (translated), instructions, role and model tier. Templates live
// on the server; their names and descriptions are translated here by id.

const TEMPLATE_IDS = [
  "triage",
  "standup",
  "specWriter",
  "deliveryRisk",
  "feedback",
] as const;

export const BLANK_TEMPLATE = "blank";

type Translate = (key: string) => string;

function knownId(id: string): id is (typeof TEMPLATE_IDS)[number] {
  return (TEMPLATE_IDS as readonly string[]).includes(id);
}

export function templateName(t: Translate, template: AgentTemplate): string {
  return knownId(template.id)
    ? t(`ai:agents.templates.${template.id}.name`)
    : template.name;
}

function templateDescription(t: Translate, template: AgentTemplate): string {
  return knownId(template.id)
    ? t(`ai:agents.templates.${template.id}.description`)
    : "";
}

/** The form values a template gives a new agent. */
export function draftFromTemplate(
  t: Translate,
  template: AgentTemplate,
): {
  name: string;
  instructions: string;
  role: string;
  modelTier: AgentTemplate["modelTier"];
} {
  return {
    name: templateName(t, template),
    instructions: template.instructions,
    role: template.role,
    modelTier: template.modelTier,
  };
}

export function AgentTemplatePicker({
  templates,
  selected,
  onPick,
}: {
  templates: readonly AgentTemplate[];
  /** A template id, or BLANK_TEMPLATE. */
  selected: string;
  onPick: (template: AgentTemplate | null) => void;
}) {
  const { t } = useTranslation();
  const option = (
    id: string,
    title: string,
    description: string,
    triggers: readonly string[],
    pick: () => void,
  ) => {
    const active = selected === id;
    return (
      <li key={id}>
        <button
          type="button"
          aria-pressed={active}
          onClick={pick}
          className={cn(
            "flex h-full w-full flex-col gap-1 rounded-lg border border-border p-2.5 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
            active && "border-primary bg-primary/5",
          )}
        >
          <span className="flex items-center gap-1.5 font-medium text-sm">
            {active ? (
              <Check className="size-3.5 text-primary" aria-hidden />
            ) : (
              <Bot className="size-3.5 text-muted-foreground" aria-hidden />
            )}
            {title}
          </span>
          {description && (
            <span className="text-muted-foreground text-xs">{description}</span>
          )}
          {triggers.length > 0 && (
            <span className="flex flex-wrap gap-1">
              {triggers.map((trigger) => (
                <span
                  key={trigger}
                  className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {t(`ai:agents.templates.triggers.${trigger}`)}
                </span>
              ))}
            </span>
          )}
        </button>
      </li>
    );
  };
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 font-medium text-sm">
        {t("ai:agents.templates.title")}
      </legend>
      <ul className="grid gap-2 sm:grid-cols-2">
        {option(
          BLANK_TEMPLATE,
          t("ai:agents.templates.blank"),
          t("ai:agents.templates.blankHint"),
          [],
          () => onPick(null),
        )}
        {templates.map((template) =>
          option(
            template.id,
            templateName(t, template),
            templateDescription(t, template),
            template.suggestedTriggers,
            () => onPick(template),
          ),
        )}
      </ul>
    </fieldset>
  );
}
