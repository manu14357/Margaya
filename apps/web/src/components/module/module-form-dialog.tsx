import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, type Resolver, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateModule } from "@/hooks/mutations/module/use-create-module";
import { useUpdateModule } from "@/hooks/mutations/module/use-update-module";
import { HttpError } from "@/lib/http-error";
import {
  createModulePayload,
  isModuleFormDirty,
  MODULE_DESCRIPTION_MAX,
  MODULE_NAME_MAX,
  type ModuleFormValues,
  moduleFormValues,
  updateModulePayload,
  validateModuleForm,
} from "@/lib/module/form";
import { toast } from "@/lib/toast";
import type { Module, ModuleDetail } from "@/types/module";
import DiscardChangesDialog from "./discard-changes-dialog";
import ModuleDateField from "./module-date-field";
import ModuleLeadPicker from "./module-lead-picker";
import ModuleMembersPicker from "./module-members-picker";
import { ModuleStatusField } from "./module-status-popover";

type ModuleFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workspaceId: string;
  /** Edits this module; creates a new one when absent. */
  module?: Module | ModuleDetail | null;
  onSaved?: (module: Module, created: boolean) => void;
};

/** Show the counter once the description gets close to its limit. */
const COUNTER_THRESHOLD = MODULE_DESCRIPTION_MAX - 500;

/** The API answers 409 with this wording when the name is taken. */
function isNameConflict(error: unknown) {
  return (
    error instanceof HttpError &&
    error.status === 409 &&
    error.message.toLowerCase().includes("name")
  );
}

/** Creates or edits a module: name, description, status, dates and people. */
export default function ModuleFormDialog({
  open,
  onOpenChange,
  projectId,
  workspaceId,
  module,
  onSaved,
}: ModuleFormDialogProps) {
  const { t } = useTranslation();
  const createModule = useCreateModule();
  const updateModule = useUpdateModule();
  const [isDiscardOpen, setIsDiscardOpen] = useState(false);
  const isEditing = Boolean(module);
  const original = useMemo(() => moduleFormValues(module), [module]);
  const knownMembers = module && "members" in module ? module.members : [];

  const resolver = useMemo<Resolver<ModuleFormValues>>(
    () => async (values) => {
      const errors = validateModuleForm(values);
      if (errors.length === 0) return { values, errors: {} };
      const fieldErrors: Record<string, { type: string; message: string }> = {};
      for (const error of errors) {
        if (fieldErrors[error.field]) continue;
        fieldErrors[error.field] = { type: "validate", message: t(error.key) };
      }
      return { values: {}, errors: fieldErrors };
    },
    [t],
  );

  const form = useForm<ModuleFormValues>({
    defaultValues: original,
    resolver,
  });
  const { errors, isSubmitting } = form.formState;
  const [description, startDate, targetDate] = useWatch({
    control: form.control,
    name: ["description", "startDate", "targetDate"],
  });

  // The values the dialog opened with. A refetch while it is open (another
  // user saving) neither wipes the edits nor gets reverted by them: only the
  // fields changed since opening are sent.
  const baseline = useRef(original);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      baseline.current = original;
      form.reset(original);
    }
    wasOpen.current = open;
  }, [open, original, form]);

  const requestClose = () => {
    if (isSubmitting) return;
    if (isModuleFormDirty(form.getValues(), baseline.current)) {
      setIsDiscardOpen(true);
      return;
    }
    onOpenChange(false);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (module) {
        const json = updateModulePayload(values, baseline.current);
        const saved =
          Object.keys(json).length > 0
            ? await updateModule.mutateAsync({
                moduleId: module.id,
                projectId,
                json,
              })
            : module;
        toast.success(t("modules:toast.updated"));
        onOpenChange(false);
        onSaved?.(saved, false);
      } else {
        const saved = await createModule.mutateAsync({
          projectId,
          ...createModulePayload(values),
        });
        toast.success(t("modules:toast.created"));
        onOpenChange(false);
        onSaved?.(saved, true);
      }
    } catch (error) {
      if (isNameConflict(error)) {
        form.setError("name", {
          type: "server",
          message: t("modules:form.nameTaken"),
        });
        form.setFocus("name");
        return;
      }
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("modules:toast.saveError"),
      );
    }
  });

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}
      >
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={onSubmit} noValidate>
            <DialogHeader>
              <DialogTitle>
                {isEditing
                  ? t("modules:form.editTitle")
                  : t("modules:form.createTitle")}
              </DialogTitle>
              {!isEditing && (
                <DialogDescription>
                  {t("modules:form.createDescription")}
                </DialogDescription>
              )}
            </DialogHeader>

            <fieldset disabled={isSubmitting} className="space-y-4 p-6 pt-1">
              <div className="space-y-2">
                <Label htmlFor="module-name">{t("modules:form.name")}</Label>
                <Input
                  id="module-name"
                  autoFocus
                  maxLength={MODULE_NAME_MAX}
                  placeholder={t("modules:form.namePlaceholder")}
                  aria-invalid={errors.name ? true : undefined}
                  {...form.register("name")}
                />
                {errors.name && (
                  <p className="text-destructive text-sm">
                    {errors.name.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="module-description">
                  {t("modules:form.description")}
                </Label>
                <Textarea
                  id="module-description"
                  rows={3}
                  placeholder={t("modules:form.descriptionPlaceholder")}
                  aria-invalid={errors.description ? true : undefined}
                  {...form.register("description")}
                />
                <div className="flex items-start justify-between gap-2">
                  {errors.description ? (
                    <p className="text-destructive text-sm">
                      {errors.description.message}
                    </p>
                  ) : (
                    <span />
                  )}
                  {description.length > COUNTER_THRESHOLD && (
                    <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                      {t("modules:form.characterCount", {
                        length: description.length,
                        max: MODULE_DESCRIPTION_MAX,
                      })}
                    </span>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="module-status">
                    {t("modules:form.status")}
                  </Label>
                  <Controller
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <ModuleStatusField
                        id="module-status"
                        value={field.value}
                        onChange={field.onChange}
                        disabled={isSubmitting}
                      />
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="module-lead">{t("modules:form.lead")}</Label>
                  <Controller
                    control={form.control}
                    name="leadId"
                    render={({ field }) => (
                      <ModuleLeadPicker
                        id="module-lead"
                        workspaceId={workspaceId}
                        value={field.value}
                        fallback={module?.lead}
                        onChange={field.onChange}
                        disabled={isSubmitting}
                      />
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="module-start">
                    {t("modules:form.startDate")}
                  </Label>
                  <Controller
                    control={form.control}
                    name="startDate"
                    render={({ field }) => (
                      <ModuleDateField
                        id="module-start"
                        value={field.value}
                        max={targetDate}
                        onChange={(value) => {
                          field.onChange(value);
                          form.clearErrors("targetDate");
                        }}
                        disabled={isSubmitting}
                      />
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="module-target">
                    {t("modules:form.targetDate")}
                  </Label>
                  <Controller
                    control={form.control}
                    name="targetDate"
                    render={({ field }) => (
                      <ModuleDateField
                        id="module-target"
                        value={field.value}
                        min={startDate}
                        invalid={Boolean(errors.targetDate)}
                        onChange={(value) => {
                          field.onChange(value);
                          form.clearErrors("targetDate");
                        }}
                        disabled={isSubmitting}
                      />
                    )}
                  />
                </div>
              </div>
              {errors.targetDate && (
                <p className="text-destructive text-sm">
                  {errors.targetDate.message}
                </p>
              )}

              <div className="space-y-2">
                <Label htmlFor="module-members">
                  {t("modules:form.members")}
                </Label>
                <Controller
                  control={form.control}
                  name="memberIds"
                  render={({ field }) => (
                    <ModuleMembersPicker
                      id="module-members"
                      workspaceId={workspaceId}
                      value={field.value}
                      known={knownMembers}
                      onChange={field.onChange}
                      disabled={isSubmitting}
                    />
                  )}
                />
              </div>
            </fieldset>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={requestClose}
              >
                {t("modules:form.cancel")}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {isEditing ? t("modules:form.save") : t("modules:form.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <DiscardChangesDialog
        open={isDiscardOpen}
        onOpenChange={setIsDiscardOpen}
        onDiscard={() => {
          setIsDiscardOpen(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}
