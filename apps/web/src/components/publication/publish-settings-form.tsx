import { Info } from "lucide-react";
import { Fragment, type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUpdatePublication } from "@/hooks/mutations/publication/use-publication-mutations";
import { layoutPatch, PUBLICATION_LAYOUTS } from "@/lib/publication/settings";
import { toast } from "@/lib/toast";
import type {
  ProjectPublication,
  PublicationLayout,
  PublicationSettingsPatch,
} from "@/types/publication";

type SwitchKey =
  | "commentsEnabled"
  | "reactionsEnabled"
  | "votesEnabled"
  | "requestsEnabled"
  | "allowGuests"
  | "showAssignees"
  | "showBacklog";

type SwitchRowProps = {
  label: string;
  hint: string;
  note?: string | null;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
};

function SwitchRow({
  label,
  hint,
  note,
  checked,
  disabled,
  onChange,
}: SwitchRowProps) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
        {note && <p className="text-xs text-warning-foreground">{note}</p>}
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={disabled ? undefined : (value) => onChange(value)}
      />
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-md font-medium">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="space-y-4 rounded-md border border-border bg-sidebar p-4">
        {children}
      </div>
    </section>
  );
}

type PublishSettingsFormProps = {
  projectId: string;
  publication: ProjectPublication;
};

/** Layouts, participation and content: each control saves on change. */
export default function PublishSettingsForm({
  projectId,
  publication,
}: PublishSettingsFormProps) {
  const { t } = useTranslation();
  const update = useUpdatePublication(projectId);
  const { canManage, availability } = publication;
  const radioIdPrefix = useId();

  const save = (patch: PublicationSettingsPatch | null) => {
    if (!patch || !canManage) return;
    update.mutate(patch, {
      onSuccess: () => toast.success(t("settings:projectPublish.saved")),
      onError: (error) =>
        toast.error(error.message || t("settings:projectPublish.saveError")),
    });
  };

  const switchRow = (
    key: SwitchKey,
    label: string,
    hint: string,
    { note, blocked = false }: { note?: string | null; blocked?: boolean } = {},
  ) => (
    <SwitchRow
      label={label}
      hint={hint}
      note={note}
      checked={publication[key]}
      // A blocked switch can still be turned off.
      disabled={!canManage || (blocked && !publication[key])}
      onChange={(checked) => save({ [key]: checked })}
    />
  );

  const layoutLabel = (layout: PublicationLayout) =>
    layout === "board"
      ? t("settings:projectPublish.layouts.board")
      : t("settings:projectPublish.layouts.list");

  const participation: Array<[SwitchKey, ReactNode]> = [
    [
      "commentsEnabled",
      switchRow(
        "commentsEnabled",
        t("settings:projectPublish.participation.comments"),
        t("settings:projectPublish.participation.commentsHint"),
      ),
    ],
    [
      "reactionsEnabled",
      switchRow(
        "reactionsEnabled",
        t("settings:projectPublish.participation.reactions"),
        t("settings:projectPublish.participation.reactionsHint"),
      ),
    ],
    [
      "votesEnabled",
      switchRow(
        "votesEnabled",
        t("settings:projectPublish.participation.votes"),
        t("settings:projectPublish.participation.votesHint"),
      ),
    ],
    [
      "requestsEnabled",
      switchRow(
        "requestsEnabled",
        t("settings:projectPublish.participation.requests"),
        t("settings:projectPublish.participation.requestsHint"),
        {
          blocked: !availability.requests,
          note: availability.requests
            ? null
            : t("settings:projectPublish.participation.requestsNeedIntake"),
        },
      ),
    ],
    [
      "allowGuests",
      switchRow(
        "allowGuests",
        t("settings:projectPublish.participation.guests"),
        t("settings:projectPublish.participation.guestsHint"),
        {
          note: availability.guests
            ? null
            : t("settings:projectPublish.participation.guestsOffServer"),
        },
      ),
    ],
  ];

  return (
    <TooltipProvider>
      <div className="space-y-8">
        <Section
          title={t("settings:projectPublish.layouts.title")}
          hint={t("settings:projectPublish.layouts.hint")}
        >
          <div className="flex flex-wrap gap-6">
            {PUBLICATION_LAYOUTS.map((layout) => {
              const checked = publication.layouts.includes(layout);
              const isLast = checked && publication.layouts.length === 1;
              const id = `${radioIdPrefix}-layout-${layout}`;
              const box = (
                <label
                  key={layout}
                  htmlFor={id}
                  className="flex items-center gap-2"
                >
                  <Checkbox
                    id={id}
                    checked={checked}
                    disabled={!canManage || isLast}
                    onCheckedChange={(value) =>
                      save(
                        layoutPatch(
                          publication.layouts,
                          layout,
                          Boolean(value),
                        ),
                      )
                    }
                  />
                  <span className="text-sm font-medium">
                    {layoutLabel(layout)}
                  </span>
                </label>
              );
              return isLast && canManage ? (
                <Tooltip key={layout}>
                  <TooltipTrigger render={<span />}>{box}</TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">
                      {t("settings:projectPublish.layouts.keepOne")}
                    </p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Fragment key={layout}>{box}</Fragment>
              );
            })}
          </div>
          <Separator />
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {t("settings:projectPublish.layouts.default")}
            </p>
            <RadioGroup
              className="flex flex-row gap-6"
              value={publication.defaultLayout}
              disabled={!canManage}
              onValueChange={(value) => {
                const layout = value as PublicationLayout;
                if (layout !== publication.defaultLayout) {
                  save({ defaultLayout: layout });
                }
              }}
            >
              {publication.layouts.map((layout) => {
                const id = `${radioIdPrefix}-default-${layout}`;
                return (
                  <label
                    key={layout}
                    htmlFor={id}
                    className="flex items-center gap-2"
                  >
                    <Radio id={id} value={layout} />
                    <span className="text-sm">{layoutLabel(layout)}</span>
                  </label>
                );
              })}
            </RadioGroup>
          </div>
        </Section>

        <Section
          title={t("settings:projectPublish.participation.title")}
          hint={t("settings:projectPublish.participation.hint")}
        >
          {!availability.participation && (
            <Alert variant="warning">
              <Info />
              <AlertDescription>
                {t("settings:projectPublish.participation.off")}
              </AlertDescription>
            </Alert>
          )}
          {participation.map(([key, row], index) => (
            <Fragment key={key}>
              {index > 0 && <Separator />}
              {row}
            </Fragment>
          ))}
        </Section>

        <Section
          title={t("settings:projectPublish.content.title")}
          hint={t("settings:projectPublish.content.hint")}
        >
          {switchRow(
            "showAssignees",
            t("settings:projectPublish.content.assignees"),
            t("settings:projectPublish.content.assigneesHint"),
          )}
          <Separator />
          {switchRow(
            "showBacklog",
            t("settings:projectPublish.content.backlog"),
            t("settings:projectPublish.content.backlogHint"),
          )}
        </Section>
      </div>
    </TooltipProvider>
  );
}
