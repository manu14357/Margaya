import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  JiraImportOptions,
  JiraImportPreview,
} from "@/fetchers/jira-import/jira-import";

export const PLANNED_STATUS = "planned";

export const PRIORITY_LABEL_KEYS = {
  "no-priority": "tasks:priority.no-priority",
  low: "tasks:priority.low",
  medium: "tasks:priority.medium",
  high: "tasks:priority.high",
  urgent: "tasks:priority.urgent",
} as const;

type Priority = keyof typeof PRIORITY_LABEL_KEYS;
const PRIORITIES = Object.keys(PRIORITY_LABEL_KEYS) as Priority[];

export type JiraChoices = {
  statusMap: Record<string, string>;
  priorityMap: Record<string, Priority>;
  options: Required<
    Pick<
      JiraImportOptions,
      | "mode"
      | "issueTypeAsLabel"
      | "importComments"
      | "sprintsAsCycles"
      | "componentsAsModules"
    >
  >;
};

type JiraMappingStepProps = {
  preview: JiraImportPreview;
  columns: ReadonlyArray<{ slug: string; name: string }>;
  choices: JiraChoices;
  onChange: (choices: JiraChoices) => void;
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="font-medium text-sm">{children}</h3>;
}

function OptionSwitch({
  label,
  hint,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      </div>
      <Switch
        id={id}
        checked={checked && !disabled}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next)}
      />
    </div>
  );
}

/** Step 2: statuses → columns, priorities, people and import options. */
export function JiraMappingStep({
  preview,
  columns,
  choices,
  onChange,
}: JiraMappingStepProps) {
  const { t } = useTranslation();
  const modeId = useId();
  const backlog = t("settings:tasksImportExport.jira.backlog");
  const columnName = (slug: string) =>
    slug === PLANNED_STATUS
      ? backlog
      : (columns.find((column) => column.slug === slug)?.name ?? backlog);
  const setOption = <K extends keyof JiraChoices["options"]>(
    key: K,
    value: JiraChoices["options"][K],
  ) => onChange({ ...choices, options: { ...choices.options, [key]: value } });

  const matched = preview.people.filter((person) => person.member);
  const unmatched = preview.people.filter((person) => !person.member);
  const { features, permissions } = preview;

  return (
    <div className="max-h-[55vh] space-y-6 overflow-y-auto pr-1">
      <section className="space-y-2">
        <SectionTitle>
          {t("settings:tasksImportExport.jira.statusesTitle")}
        </SectionTitle>
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("settings:tasksImportExport.jira.jiraStatus")}
                </TableHead>
                <TableHead>
                  {t("settings:tasksImportExport.jira.column")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.statuses.map((status) => {
                const value =
                  choices.statusMap[status.name] ?? status.suggestedStatus;
                return (
                  <TableRow key={status.name}>
                    <TableCell>
                      <span className="font-medium">{status.name}</span>
                      <span className="ml-2 text-muted-foreground text-xs">
                        {status.category
                          ? t(
                              "settings:tasksImportExport.jira.statusMetaCategory",
                              {
                                count: status.count,
                                category: status.category,
                              },
                            )
                          : t("settings:tasksImportExport.jira.statusMeta", {
                              count: status.count,
                            })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={value}
                        onValueChange={(next) => {
                          if (!next) return;
                          onChange({
                            ...choices,
                            statusMap: {
                              ...choices.statusMap,
                              [status.name]: next,
                            },
                          });
                        }}
                      >
                        <SelectTrigger
                          className="w-48"
                          aria-label={status.name}
                        >
                          <SelectValue>{columnName(value)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {columns.map((column) => (
                            <SelectItem key={column.slug} value={column.slug}>
                              {column.name}
                            </SelectItem>
                          ))}
                          <SelectItem value={PLANNED_STATUS}>
                            {backlog}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      {preview.priorities.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>
            {t("settings:tasksImportExport.jira.prioritiesTitle")}
          </SectionTitle>
          <div className="rounded-lg border border-border">
            <Table>
              <TableBody>
                {preview.priorities.map((priority) => {
                  const value =
                    choices.priorityMap[priority.name] ??
                    priority.suggestedPriority;
                  return (
                    <TableRow key={priority.name}>
                      <TableCell className="font-medium">
                        {priority.name}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={value}
                          onValueChange={(next) => {
                            if (!next) return;
                            onChange({
                              ...choices,
                              priorityMap: {
                                ...choices.priorityMap,
                                [priority.name]: next as Priority,
                              },
                            });
                          }}
                        >
                          <SelectTrigger
                            className="w-48"
                            aria-label={priority.name}
                          >
                            <SelectValue>
                              {t(PRIORITY_LABEL_KEYS[value])}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {PRIORITIES.map((option) => (
                              <SelectItem key={option} value={option}>
                                {t(PRIORITY_LABEL_KEYS[option])}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {preview.people.length > 0 && (
        <section className="space-y-2 text-sm">
          <SectionTitle>
            {t("settings:tasksImportExport.jira.peopleTitle")}
          </SectionTitle>
          <p className="text-muted-foreground">
            {t("settings:tasksImportExport.jira.peopleMatched", {
              count: matched.length,
            })}
          </p>
          {unmatched.length > 0 && (
            <p className="text-muted-foreground">
              {t("settings:tasksImportExport.jira.peopleUnmatched", {
                count: unmatched.length,
                names: unmatched
                  .slice(0, 10)
                  .map((person) => person.name)
                  .join(", "),
              })}
            </p>
          )}
        </section>
      )}

      <section className="space-y-3">
        <SectionTitle>
          {t("settings:tasksImportExport.jira.optionsTitle")}
        </SectionTitle>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor={modeId}>
              {t("settings:tasksImportExport.jira.mode")}
            </Label>
            <p className="text-muted-foreground text-xs">
              {t("settings:tasksImportExport.jira.modeHint")}
            </p>
          </div>
          <Select
            value={choices.options.mode}
            onValueChange={(next) =>
              setOption("mode", next === "update" ? "update" : "skip")
            }
          >
            <SelectTrigger id={modeId} className="w-48">
              <SelectValue>
                {choices.options.mode === "update"
                  ? t("settings:tasksImportExport.jira.modeUpdate")
                  : t("settings:tasksImportExport.jira.modeSkip")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="skip">
                {t("settings:tasksImportExport.jira.modeSkip")}
              </SelectItem>
              <SelectItem value="update" disabled={!permissions.update}>
                {t("settings:tasksImportExport.jira.modeUpdate")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <OptionSwitch
          label={t("settings:tasksImportExport.jira.issueTypeAsLabel")}
          checked={choices.options.issueTypeAsLabel}
          onCheckedChange={(next) => setOption("issueTypeAsLabel", next)}
        />
        <OptionSwitch
          label={t("settings:tasksImportExport.jira.importComments")}
          hint={
            permissions.comments
              ? undefined
              : t("settings:tasksImportExport.jira.commentsNeedPermission")
          }
          checked={choices.options.importComments}
          disabled={!permissions.comments}
          onCheckedChange={(next) => setOption("importComments", next)}
        />
        <OptionSwitch
          label={t("settings:tasksImportExport.jira.sprintsAsCycles")}
          hint={
            !features.cycles
              ? t("settings:tasksImportExport.jira.cyclesOff")
              : !permissions.cycles
                ? t("settings:tasksImportExport.jira.noPermission")
                : undefined
          }
          checked={choices.options.sprintsAsCycles}
          disabled={!features.cycles || !permissions.cycles}
          onCheckedChange={(next) => setOption("sprintsAsCycles", next)}
        />
        <OptionSwitch
          label={t("settings:tasksImportExport.jira.componentsAsModules")}
          hint={
            !features.modules
              ? t("settings:tasksImportExport.jira.modulesOff")
              : !permissions.modules
                ? t("settings:tasksImportExport.jira.noPermission")
                : undefined
          }
          checked={choices.options.componentsAsModules}
          disabled={!features.modules || !permissions.modules}
          onCheckedChange={(next) => setOption("componentsAsModules", next)}
        />
        {!features.estimates && (
          <p className="text-muted-foreground text-xs">
            {t("settings:tasksImportExport.jira.estimatesOff")}
          </p>
        )}
      </section>
    </div>
  );
}

export default JiraMappingStep;
