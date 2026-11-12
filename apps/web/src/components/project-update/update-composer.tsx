import { Sparkles, Wand2 } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiGeneratedBadge } from "@/components/ai/ai-content-label";
import { useAiLocale } from "@/components/editor/ai/use-ai-locale";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
import type {
  ProjectUpdate,
  ProjectUpdateFacts,
} from "@/fetchers/project-update/project-update";
import {
  useCreateProjectUpdate,
  useDraftProjectUpdate,
  useEditProjectUpdate,
} from "@/hooks/mutations/project-update/use-project-update-mutations";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import {
  buildTemplateDraft,
  HEALTH_LABEL_KEYS,
  type TemplateHealth,
} from "@/lib/project-updates/template";
import { toast } from "@/lib/toast";

const HEALTHS: readonly TemplateHealth[] = ["on_track", "at_risk", "off_track"];
const SUMMARY_MAX = 2000;
const SECTION_MAX = 4000;

type ComposerProps = {
  projectId: string;
  /** Edit this update instead of posting a new one. */
  editing?: ProjectUpdate;
  onDone: () => void;
};

type Fields = {
  health: TemplateHealth;
  summary: string;
  highlights: string;
  blockers: string;
  nextSteps: string;
};

function fieldsOf(update?: ProjectUpdate): Fields {
  return {
    health: update?.health ?? "on_track",
    summary: update?.summary ?? "",
    highlights: update?.highlights ?? "",
    blockers: update?.blockers ?? "",
    nextSteps: update?.nextSteps ?? "",
  };
}

/** The numbers a draft came from, in one muted line. */
function FactsLine({ facts }: { facts: ProjectUpdateFacts }) {
  const { t } = useTranslation();
  return (
    <p className="text-muted-foreground text-xs">
      {t("projectUpdates:composer.factsLine", {
        completed: facts.completed.total,
        moved: facts.moved.total,
        overdue: facts.overdue.total,
        blocked: facts.blocked.total,
      })}
    </p>
  );
}

/**
 * Post or edit a project update. "Draft" fills the form from live project
 * data: written by AI when it is available here, else from a template. The
 * person edits it before posting.
 */
export default function UpdateComposer({
  projectId,
  editing,
  onDone,
}: ComposerProps) {
  const { t } = useTranslation();
  const formId = useId();
  const locale = useAiLocale();
  const { available: aiAvailable } = useAiAvailability(projectId);
  const [fields, setFields] = useState<Fields>(() => fieldsOf(editing));
  const [aiDrafted, setAiDrafted] = useState(false);
  const [facts, setFacts] = useState<ProjectUpdateFacts | null>(null);
  const draft = useDraftProjectUpdate(projectId);
  const create = useCreateProjectUpdate(projectId);
  const edit = useEditProjectUpdate(projectId);
  const saving = create.isPending || edit.isPending;

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((current) => ({ ...current, [key]: value }));

  const runDraft = () => {
    draft.mutate(
      { useAi: aiAvailable, locale },
      {
        onSuccess: (result) => {
          setFacts(result.facts);
          if (result.aiDrafted) {
            setFields({
              health: result.draft.health,
              summary: result.draft.summary,
              highlights: result.draft.highlights ?? "",
              blockers: result.draft.blockers ?? "",
              nextSteps: result.draft.nextSteps ?? "",
            });
            setAiDrafted(true);
            return;
          }
          setFields(buildTemplateDraft(result.facts, t));
          setAiDrafted(false);
          if (aiAvailable && result.aiUnavailable) {
            toast.info(t("projectUpdates:composer.aiFallback"));
          }
        },
        onError: () => toast.error(t("projectUpdates:composer.draftError")),
      },
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const summary = fields.summary.trim();
    if (!summary) return;
    const body = {
      health: fields.health,
      summary,
      highlights: fields.highlights.trim() || null,
      blockers: fields.blockers.trim() || null,
      nextSteps: fields.nextSteps.trim() || null,
    };
    const options = {
      onSuccess: () => {
        toast.success(
          t(
            editing
              ? "projectUpdates:composer.saved"
              : "projectUpdates:composer.posted",
          ),
        );
        onDone();
      },
      onError: () => toast.error(t("projectUpdates:composer.saveError")),
    };
    if (editing) edit.mutate({ id: editing.id, ...body }, options);
    // An AI draft is posted with aiAssist, so the update carries the
    // shared AI-generated label (even after the person edits the text).
    else
      create.mutate(
        {
          ...body,
          ...(aiDrafted ? { aiAssist: { feature: "project_update" } } : {}),
        },
        options,
      );
  };

  const sections = [
    {
      key: "highlights" as const,
      label: t("projectUpdates:fields.highlights"),
    },
    { key: "blockers" as const, label: t("projectUpdates:fields.blockers") },
    { key: "nextSteps" as const, label: t("projectUpdates:fields.nextSteps") },
  ];

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border bg-card p-3 shadow-xs sm:p-4"
      aria-label={t(
        editing
          ? "projectUpdates:composer.editTitle"
          : "projectUpdates:composer.title",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          id={`${formId}-health`}
          className="font-medium text-muted-foreground text-xs"
        >
          {t("projectUpdates:fields.health")}
        </span>
        <ToggleGroup
          size="sm"
          variant="outline"
          aria-labelledby={`${formId}-health`}
          value={[fields.health]}
          onValueChange={(values) => {
            const next = HEALTHS.find((value) => value === values[0]);
            if (next) set("health", next);
          }}
        >
          {HEALTHS.map((value) => (
            <Toggle key={value} value={value}>
              {t(HEALTH_LABEL_KEYS[value])}
            </Toggle>
          ))}
        </ToggleGroup>
        {!editing && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="ms-auto gap-1"
            loading={draft.isPending}
            onClick={runDraft}
          >
            {aiAvailable ? (
              <Sparkles aria-hidden className="size-3" />
            ) : (
              <Wand2 aria-hidden className="size-3" />
            )}
            {t(
              aiAvailable
                ? "projectUpdates:composer.draftWithAi"
                : "projectUpdates:composer.draftFromData",
            )}
          </Button>
        )}
      </div>
      {(aiDrafted || facts) && (
        <div className="flex flex-wrap items-center gap-2">
          {aiDrafted && <AiGeneratedBadge />}
          {facts && <FactsLine facts={facts} />}
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor={`${formId}-summary`}>
          {t("projectUpdates:fields.summary")}
        </Label>
        <Textarea
          id={`${formId}-summary`}
          required
          maxLength={SUMMARY_MAX}
          value={fields.summary}
          placeholder={t("projectUpdates:fields.summaryPlaceholder")}
          onChange={(event) => set("summary", event.target.value)}
        />
      </div>
      {sections.map((section) => (
        <div key={section.key} className="space-y-1">
          <Label htmlFor={`${formId}-${section.key}`}>{section.label}</Label>
          <Textarea
            id={`${formId}-${section.key}`}
            size="sm"
            maxLength={SECTION_MAX}
            value={fields[section.key]}
            onChange={(event) => set(section.key, event.target.value)}
          />
        </div>
      ))}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {t("projectUpdates:composer.cancel")}
        </Button>
        <Button
          type="submit"
          size="sm"
          loading={saving}
          disabled={!fields.summary.trim()}
        >
          {t(
            editing
              ? "projectUpdates:composer.save"
              : "projectUpdates:composer.post",
          )}
        </Button>
      </div>
    </form>
  );
}
