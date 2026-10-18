import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { moveItem } from "@/lib/task-template";

// The API's limits: 50 sub-tasks of up to 500 characters.
const MAX_SUBTASKS = 50;

/** A template's sub-task titles: add, rename, remove and reorder by buttons. */
export default function SubtaskChecklistEditor({
  items,
  onChange,
}: {
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState("");
  const full = items.length >= MAX_SUBTASKS;

  const add = () => {
    const title = draft.trim();
    if (!title || full) return;
    onChange([...items, title]);
    setDraft("");
  };

  return (
    <fieldset className="space-y-1.5">
      <legend className="font-medium text-foreground text-sm">
        {t("templates:form.subtasks")}
      </legend>
      {items.length > 0 && (
        <ol className="space-y-1">
          {items.map((title, index) => (
            <li
              // Titles may repeat; the position is the identity here.
              // biome-ignore lint/suspicious/noArrayIndexKey: ordered list of plain strings
              key={index}
              className="flex items-center gap-1"
            >
              <span className="w-5 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
                {index + 1}.
              </span>
              <Input
                value={title}
                maxLength={500}
                aria-label={t("templates:form.subtaskTitle", {
                  number: index + 1,
                })}
                className="h-8 min-w-0 flex-1"
                onChange={(event) =>
                  onChange(
                    items.map((item, at) =>
                      at === index ? event.target.value : item,
                    ),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={index === 0}
                aria-label={t("templates:form.moveUp", { title })}
                onClick={() => onChange(moveItem(items, index, -1))}
              >
                <ArrowUp aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={index === items.length - 1}
                aria-label={t("templates:form.moveDown", { title })}
                onClick={() => onChange(moveItem(items, index, 1))}
              >
                <ArrowDown aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("templates:form.removeSubtask", { title })}
                onClick={() => onChange(items.filter((_, at) => at !== index))}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
      )}
      <div className="flex items-center gap-1.5">
        <Input
          id={`${id}-new`}
          value={draft}
          maxLength={500}
          disabled={full}
          placeholder={t("templates:form.subtaskPlaceholder")}
          aria-label={t("templates:form.subtaskPlaceholder")}
          className="h-8 min-w-0 flex-1"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            // Enter adds the row instead of submitting the dialog.
            event.preventDefault();
            add();
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!draft.trim() || full}
          onClick={add}
        >
          <Plus aria-hidden />
          {t("templates:form.addSubtask")}
        </Button>
      </div>
    </fieldset>
  );
}
