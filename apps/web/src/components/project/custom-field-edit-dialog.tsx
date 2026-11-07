import { Plus, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import useUpdateCustomField from "@/hooks/mutations/custom-field/use-update-custom-field";
import { customFieldValueLabel } from "@/lib/task-query/custom-field-value";
import { toast } from "@/lib/toast";
import {
  buildFieldEdit,
  defaultAfterEdit,
  hasDuplicateOptions,
  type OptionRow,
  optionsAreValid,
  rowsFromOptions,
} from "./custom-field-edit";
import type { CustomFieldDefinition } from "./custom-field-editor";

const NO_DEFAULT = "__none__";

type CustomFieldEditDialogProps = {
  field: CustomFieldDefinition;
  onClose: () => void;
};

/** Rename a field, edit its dropdown options and change its default value. */
export default function CustomFieldEditDialog({
  field,
  onClose,
}: CustomFieldEditDialogProps) {
  const { t } = useTranslation();
  const ids = useId();
  const nextKey = useRef(0);
  const { mutateAsync: updateField, isPending } = useUpdateCustomField(
    field.projectId,
  );

  const isDropdown = field.type === "dropdown";
  const [name, setName] = useState(field.name);
  const [rows, setRows] = useState<OptionRow[]>(() =>
    rowsFromOptions(field.options ?? []),
  );
  const [defaultValue, setDefaultValue] = useState(field.defaultValue ?? "");

  const setRowValue = (key: string, value: string) => {
    const next = rows.map((row) => (row.key === key ? { ...row, value } : row));
    setRows(next);
    // The default follows its option's rename while the dialog is open.
    const edited = rows.find((row) => row.key === key);
    if (edited && edited.value.trim() === defaultValue) {
      setDefaultValue(value.trim());
    }
  };

  const removeRow = (row: OptionRow) => {
    setRows(rows.filter((candidate) => candidate.key !== row.key));
    if (row.value.trim() === defaultValue) setDefaultValue("");
  };

  const addRow = () => {
    nextKey.current += 1;
    setRows([
      ...rows,
      { key: `new-${nextKey.current}`, original: null, value: "" },
    ]);
  };

  const duplicates = isDropdown && hasDuplicateOptions(rows);
  const finalDefault = isDropdown
    ? defaultAfterEdit(rows, defaultValue)
    : defaultValue.trim();
  const canSave =
    Boolean(name.trim()) &&
    !isPending &&
    (!isDropdown || optionsAreValid(rows)) &&
    (!field.required || Boolean(finalDefault));

  const handleSave = async () => {
    try {
      await updateField({
        id: field.id,
        name: name.trim(),
        defaultValue: finalDefault || null,
        ...(isDropdown ? buildFieldEdit(rows) : {}),
      });
      toast.success(t("settings:customFields.updateSuccess"));
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("settings:customFields.updateError"),
      );
    }
  };

  const defaultLabelId = `${ids}-default`;
  const defaultChoices = isDropdown
    ? rows.map((row) => row.value.trim()).filter(Boolean)
    : ["true", "false"];

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settings:customFields.editTitle")}</DialogTitle>
          <DialogDescription>
            {t("settings:customFields.editDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={`${ids}-form`}
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSave) void handleSave();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor={`${ids}-name`}>
                {t("settings:customFields.nameLabel")}
              </Label>
              <Input
                id={`${ids}-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            {isDropdown && (
              <fieldset className="grid gap-1.5">
                <legend className="mb-1.5 font-medium text-sm">
                  {t("settings:customFields.optionsLabel")}
                </legend>
                {rows.map((row) => (
                  <div key={row.key} className="flex items-center gap-1">
                    <Input
                      value={row.value}
                      maxLength={128}
                      placeholder={t("settings:customFields.optionPlaceholder")}
                      aria-label={t("settings:customFields.optionPlaceholder")}
                      onChange={(event) =>
                        setRowValue(row.key, event.target.value)
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-muted-foreground"
                      disabled={rows.length === 1}
                      aria-label={`${t("settings:customFields.removeOption")}: ${row.value}`}
                      onClick={() => removeRow(row)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit gap-1"
                  onClick={addRow}
                >
                  <Plus className="size-3.5" />
                  {t("settings:customFields.addOption")}
                </Button>
                {duplicates && (
                  <p role="alert" className="text-destructive text-xs">
                    {t("settings:customFields.duplicateOption")}
                  </p>
                )}
                <p className="text-muted-foreground text-xs">
                  {t("settings:customFields.optionsHint")}
                </p>
              </fieldset>
            )}

            <div className="grid gap-1.5">
              <Label id={defaultLabelId} htmlFor={`${ids}-default-input`}>
                {t("settings:customFields.defaultLabel")}
              </Label>
              {isDropdown || field.type === "boolean" ? (
                <Select
                  value={
                    defaultChoices.includes(finalDefault)
                      ? finalDefault
                      : NO_DEFAULT
                  }
                  onValueChange={(value) =>
                    setDefaultValue(
                      value === NO_DEFAULT ? "" : (value as string),
                    )
                  }
                >
                  <SelectTrigger aria-labelledby={defaultLabelId}>
                    <SelectValue>
                      {finalDefault
                        ? customFieldValueLabel(field.type, finalDefault, t)
                        : t("settings:customFields.noDefault")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {!field.required && (
                      <SelectItem value={NO_DEFAULT}>
                        {t("settings:customFields.noDefault")}
                      </SelectItem>
                    )}
                    {defaultChoices.map((choice) => (
                      <SelectItem key={choice} value={choice}>
                        {customFieldValueLabel(field.type, choice, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={`${ids}-default-input`}
                  value={defaultValue}
                  type={
                    field.type === "number"
                      ? "number"
                      : field.type === "date"
                        ? "date"
                        : "text"
                  }
                  onChange={(event) => setDefaultValue(event.target.value)}
                />
              )}
            </div>
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("settings:customFields.cancelButton")}
          </Button>
          <Button type="submit" form={`${ids}-form`} disabled={!canSave}>
            {t("settings:customFields.saveButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
