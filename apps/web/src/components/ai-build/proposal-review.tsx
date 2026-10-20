import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import labelColors from "@/constants/label-colors";
import {
  moveTask,
  type ReviewDraft,
  type ReviewTask,
} from "@/lib/ai-build/review";
import { cn } from "@/lib/cn";
import { getPriorityLabel } from "@/lib/i18n/domain";

const PRIORITIES = ["no-priority", "low", "medium", "high", "urgent"] as const;

const selectClass =
  "h-7.5 min-w-0 rounded-lg border border-input bg-background px-2 text-foreground text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 dark:bg-input/32";

type ProposalReviewProps = {
  draft: ReviewDraft;
  onChange: (draft: ReviewDraft) => void;
  /** Adding columns needs project:update; without it they are left out. */
  canAddColumns: boolean;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child.
    <label className="flex min-w-0 flex-col gap-1 text-muted-foreground text-xs">
      <span>{label}</span>
      {children}
    </label>
  );
}

/**
 * The proposal as editable cards: everything can be unchecked, renamed and
 * reordered before it is created. Nothing here talks to the API.
 */
export default function ProposalReview({
  draft,
  onChange,
  canAddColumns,
}: ProposalReviewProps) {
  const { t } = useTranslation();
  const patch = (next: Partial<ReviewDraft>) => onChange({ ...draft, ...next });
  const patchTask = (id: string, next: Partial<ReviewTask>) =>
    patch({
      tasks: draft.tasks.map((task) =>
        task.id === id ? { ...task, ...next } : task,
      ),
    });

  return (
    <div className="space-y-6">
      {draft.summary && (
        <p className="text-muted-foreground text-sm">{draft.summary}</p>
      )}

      {draft.project && (
        <Section title={t("ai:build.review.project")}>
          <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[1fr_7rem]">
            <Field label={t("ai:build.review.projectName")}>
              <Input
                value={draft.project.name}
                maxLength={120}
                onChange={(event) =>
                  draft.project &&
                  patch({
                    project: { ...draft.project, name: event.target.value },
                  })
                }
              />
            </Field>
            <Field label={t("ai:build.review.projectKey")}>
              <Input
                value={draft.project.key}
                maxLength={8}
                onChange={(event) =>
                  draft.project &&
                  patch({
                    project: {
                      ...draft.project,
                      key: event.target.value.toUpperCase(),
                    },
                  })
                }
              />
            </Field>
            {canAddColumns && (
              <div className="sm:col-span-2">
                <Field label={t("ai:build.review.projectDescription")}>
                  <Textarea
                    size="sm"
                    value={draft.project.description}
                    maxLength={5000}
                    onChange={(event) =>
                      draft.project &&
                      patch({
                        project: {
                          ...draft.project,
                          description: event.target.value,
                        },
                      })
                    }
                  />
                </Field>
              </div>
            )}
          </div>
        </Section>
      )}

      {canAddColumns && draft.columns.length > 0 && (
        <Section title={t("ai:build.review.columns")}>
          <ul className="flex flex-wrap gap-2">
            {draft.columns.map((column) => (
              <li
                key={column.id}
                className="flex items-center gap-2 rounded-lg border px-2 py-1"
              >
                <Checkbox
                  checked={column.include}
                  aria-label={t("ai:build.review.include", {
                    name: column.name,
                  })}
                  onCheckedChange={(include) =>
                    patch({
                      columns: draft.columns.map((item) =>
                        item.id === column.id
                          ? { ...item, include: Boolean(include) }
                          : item,
                      ),
                    })
                  }
                />
                <span className="text-sm">{column.name}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {draft.labels.length > 0 && (
        <Section title={t("ai:build.review.labels")}>
          <ul className="flex flex-wrap gap-2">
            {draft.labels.map((label) => (
              <li
                key={label.id}
                className="flex items-center gap-2 rounded-lg border px-2 py-1"
              >
                <Checkbox
                  checked={label.include}
                  aria-label={t("ai:build.review.include", {
                    name: label.name,
                  })}
                  onCheckedChange={(include) =>
                    patch({
                      labels: draft.labels.map((item) =>
                        item.id === label.id
                          ? { ...item, include: Boolean(include) }
                          : item,
                      ),
                    })
                  }
                />
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{
                    background: labelColors.find(
                      (color) => color.value === label.color,
                    )?.color,
                  }}
                />
                <span className="text-sm">{label.name}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {draft.cycles.length > 0 && (
        <Section title={t("ai:build.review.cycles")}>
          <ul className="space-y-2">
            {draft.cycles.map((cycle) => (
              <li
                key={cycle.ref}
                className={cn(
                  "grid items-end gap-2 rounded-lg border p-2 sm:grid-cols-[auto_1fr_9rem_9rem]",
                  !cycle.include && "opacity-60",
                )}
              >
                <Checkbox
                  className="mb-1.5"
                  checked={cycle.include}
                  aria-label={t("ai:build.review.include", {
                    name: cycle.name,
                  })}
                  onCheckedChange={(include) =>
                    patch({
                      cycles: draft.cycles.map((item) =>
                        item.ref === cycle.ref
                          ? { ...item, include: Boolean(include) }
                          : item,
                      ),
                    })
                  }
                />
                {(["name", "startDate", "endDate"] as const).map((field) => (
                  <Field
                    key={field}
                    label={t(`ai:build.review.cycle.${field}`)}
                  >
                    <Input
                      type={field === "name" ? "text" : "date"}
                      value={cycle[field] ?? ""}
                      disabled={!cycle.include}
                      onChange={(event) =>
                        patch({
                          cycles: draft.cycles.map((item) =>
                            item.ref === cycle.ref
                              ? {
                                  ...item,
                                  [field]:
                                    field === "name"
                                      ? event.target.value
                                      : event.target.value || null,
                                }
                              : item,
                          ),
                        })
                      }
                    />
                  </Field>
                ))}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {draft.modules.length > 0 && (
        <Section title={t("ai:build.review.modules")}>
          <ul className="space-y-2">
            {draft.modules.map((module) => (
              <li
                key={module.ref}
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-2",
                  !module.include && "opacity-60",
                )}
              >
                <Checkbox
                  checked={module.include}
                  aria-label={t("ai:build.review.include", {
                    name: module.name,
                  })}
                  onCheckedChange={(include) =>
                    patch({
                      modules: draft.modules.map((item) =>
                        item.ref === module.ref
                          ? { ...item, include: Boolean(include) }
                          : item,
                      ),
                    })
                  }
                />
                <Input
                  aria-label={t("ai:build.review.moduleName")}
                  value={module.name}
                  disabled={!module.include}
                  onChange={(event) =>
                    patch({
                      modules: draft.modules.map((item) =>
                        item.ref === module.ref
                          ? { ...item, name: event.target.value }
                          : item,
                      ),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title={t("ai:build.review.tasks", { count: draft.tasks.length })}
      >
        <ol className="space-y-2">
          {draft.tasks.map((task, index) => (
            <li
              key={task.id}
              className={cn(
                "space-y-2 rounded-lg border p-3",
                !task.include && "opacity-60",
              )}
            >
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={task.include}
                  aria-label={t("ai:build.review.include", {
                    name: task.title,
                  })}
                  onCheckedChange={(include) =>
                    patchTask(task.id, { include: Boolean(include) })
                  }
                />
                <Input
                  aria-label={t("ai:build.review.taskTitle")}
                  value={task.title}
                  maxLength={255}
                  disabled={!task.include}
                  onChange={(event) =>
                    patchTask(task.id, { title: event.target.value })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("ai:build.review.moveUp", { name: task.title })}
                  disabled={index === 0}
                  onClick={() =>
                    patch({ tasks: moveTask(draft.tasks, index, -1) })
                  }
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("ai:build.review.moveDown", {
                    name: task.title,
                  })}
                  disabled={index === draft.tasks.length - 1}
                  onClick={() =>
                    patch({ tasks: moveTask(draft.tasks, index, 1) })
                  }
                >
                  <ArrowDown className="size-3.5" />
                </Button>
              </div>

              {task.include && (
                <>
                  <Textarea
                    size="sm"
                    aria-label={t("ai:build.review.taskDescription")}
                    value={task.description}
                    maxLength={10_000}
                    onChange={(event) =>
                      patchTask(task.id, { description: event.target.value })
                    }
                  />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Field label={t("ai:build.review.priority")}>
                      <select
                        className={selectClass}
                        value={task.priority}
                        onChange={(event) =>
                          patchTask(task.id, {
                            priority: event.target
                              .value as ReviewTask["priority"],
                          })
                        }
                      >
                        {PRIORITIES.map((priority) => (
                          <option key={priority} value={priority}>
                            {getPriorityLabel(priority)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t("ai:build.review.estimate")}>
                      <Input
                        type="number"
                        min={0}
                        max={1000}
                        size="sm"
                        value={task.estimate ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          patchTask(task.id, {
                            estimate:
                              value === ""
                                ? null
                                : Math.min(1000, Math.max(0, Number(value))),
                          });
                        }}
                      />
                    </Field>
                    {draft.cycles.length > 0 && (
                      <Field label={t("ai:build.review.cycle.label")}>
                        <select
                          className={selectClass}
                          value={task.cycleRef ?? ""}
                          onChange={(event) =>
                            patchTask(task.id, {
                              cycleRef: event.target.value || null,
                            })
                          }
                        >
                          <option value="">{t("ai:build.review.none")}</option>
                          {draft.cycles
                            .filter((cycle) => cycle.include)
                            .map((cycle) => (
                              <option key={cycle.ref} value={cycle.ref}>
                                {cycle.name}
                              </option>
                            ))}
                        </select>
                      </Field>
                    )}
                    {draft.modules.length > 0 && (
                      <Field label={t("ai:build.review.module")}>
                        <select
                          className={selectClass}
                          value={task.moduleRef ?? ""}
                          onChange={(event) =>
                            patchTask(task.id, {
                              moduleRef: event.target.value || null,
                            })
                          }
                        >
                          <option value="">{t("ai:build.review.none")}</option>
                          {draft.modules
                            .filter((module) => module.include)
                            .map((module) => (
                              <option key={module.ref} value={module.ref}>
                                {module.name}
                              </option>
                            ))}
                        </select>
                      </Field>
                    )}
                  </div>
                  {task.labels.length > 0 && (
                    <p className="text-muted-foreground text-xs">
                      {t("ai:build.review.taskLabels", {
                        labels: task.labels.join(", "),
                      })}
                    </p>
                  )}
                  {task.subtasks.length > 0 && (
                    <ul
                      className="space-y-1 ps-6"
                      aria-label={t("ai:build.review.subtasks")}
                    >
                      {task.subtasks.map((subtask) => (
                        <li
                          key={subtask.id}
                          className="flex items-center gap-2"
                        >
                          <Checkbox
                            checked={subtask.include}
                            aria-label={t("ai:build.review.include", {
                              name: subtask.title,
                            })}
                            onCheckedChange={(include) =>
                              patchTask(task.id, {
                                subtasks: task.subtasks.map((item) =>
                                  item.id === subtask.id
                                    ? { ...item, include: Boolean(include) }
                                    : item,
                                ),
                              })
                            }
                          />
                          <Input
                            size="sm"
                            aria-label={t("ai:build.review.subtaskTitle")}
                            value={subtask.title}
                            maxLength={255}
                            disabled={!subtask.include}
                            onChange={(event) =>
                              patchTask(task.id, {
                                subtasks: task.subtasks.map((item) =>
                                  item.id === subtask.id
                                    ? { ...item, title: event.target.value }
                                    : item,
                                ),
                              })
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
