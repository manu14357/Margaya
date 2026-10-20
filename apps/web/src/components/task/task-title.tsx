import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Form, FormField } from "@/components/ui/form";
import { useUpdateTaskTitle } from "@/hooks/mutations/task/use-update-task-title";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import debounce from "@/lib/debounce";

type TaskTitleProps = {
  taskId: string;
};

export default function TaskTitle({ taskId }: TaskTitleProps) {
  const { t } = useTranslation();
  const { data: task } = useGetTask(taskId);
  const { mutateAsync: updateTaskTitle } = useUpdateTaskTitle();
  const { canUpdateTasks } = useWorkspacePermission();
  const canEdit = canUpdateTasks();
  const isInitializedRef = useRef(false);
  const taskRef = useRef(task);
  const updateTaskRef = useRef(updateTaskTitle);

  useEffect(() => {
    taskRef.current = task;
    updateTaskRef.current = updateTaskTitle;
  }, [task, updateTaskTitle]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: taskId is not needed here
  useEffect(() => {
    isInitializedRef.current = false;
  }, [taskId]);

  const form = useForm<{
    title: string;
  }>({
    values: {
      title: task?.title || "",
    },
  });

  useEffect(() => {
    if (task?.title !== undefined) isInitializedRef.current = true;
  }, [task?.title]);

  const saveTitle = useCallback(async (title: string) => {
    if (!isInitializedRef.current) return;

    const currentTask = taskRef.current;
    const updateTaskFn = updateTaskRef.current;

    if (!currentTask || !updateTaskFn) return;

    try {
      await updateTaskFn({
        ...currentTask,
        title,
      });
    } catch (error) {
      console.error("Failed to update title:", error);
    }
  }, []);

  const debouncedUpdate = useMemo(() => debounce(saveTitle, 800), [saveTitle]);

  const handleTitleChange = useCallback(
    (value: string) => {
      if (!isInitializedRef.current) return;

      debouncedUpdate(value);
    },
    [debouncedUpdate],
  );

  // The title wraps instead of scrolling sideways: the textarea grows to fit
  // its text, on every change and whenever its width changes.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const title = form.watch("title");
  const fitHeight = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refit when the text changes
  useLayoutEffect(() => fitHeight(), [fitHeight, title]);
  useEffect(() => {
    const element = textareaRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fitHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitHeight]);

  // The title as it was when editing began, for Escape.
  const titleAtFocusRef = useRef("");

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      // A title is one line: Enter saves now instead of adding a newline.
      event.preventDefault();
      debouncedUpdate.cancel();
      const value = form.getValues("title");
      if (value !== taskRef.current?.title) void saveTitle(value);
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      // Escape leaves the field first, so it doesn't also close the panel.
      event.preventDefault();
      event.stopPropagation();
      debouncedUpdate.cancel();
      const original = titleAtFocusRef.current;
      form.setValue("title", original);
      // Undo a save the debounce already sent.
      if (original !== taskRef.current?.title) void saveTitle(original);
      event.currentTarget.blur();
    }
  };

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="title"
        render={({ field }) => (
          <textarea
            {...field}
            ref={(element) => {
              field.ref(element);
              textareaRef.current = element;
            }}
            rows={1}
            aria-multiline={false}
            placeholder={t("tasks:detail.titlePlaceholder")}
            readOnly={!canEdit}
            className="block h-auto w-full resize-none appearance-none overflow-hidden break-words border-0 bg-transparent p-0 font-heading text-[2rem] leading-[1.15] font-semibold tracking-[-0.02em] text-foreground outline-none placeholder:text-foreground/45"
            onFocus={() => {
              titleAtFocusRef.current = form.getValues("title");
            }}
            onKeyDown={handleKeyDown}
            onChange={(e) => {
              // Pasted line breaks become spaces: a title is one line.
              const value = e.target.value.replace(/[\r\n]+/g, " ");
              field.onChange(value);
              handleTitleChange(value);
            }}
          />
        )}
      />
    </Form>
  );
}
