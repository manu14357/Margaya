import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import {
  CUSTOM_ESTIMATE_TEMPLATES,
  type EstimateTemplate,
  resolveTemplateValues,
  templatesForType,
} from "@/constants/estimate-templates";
import { formatEstimateValue } from "@/lib/estimate/format";
import { ESTIMATE_TYPE_LABEL_KEYS } from "@/lib/estimate/messages";
import {
  ESTIMATE_TYPES,
  type EstimateType,
  isEstimateType,
} from "@/lib/estimate/values";

const cardClassName =
  "w-full rounded-md border border-border p-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type CreateEstimateChooseStepProps = {
  type: EstimateType;
  onTypeChange: (type: EstimateType) => void;
  onPick: (template: EstimateTemplate) => void;
};

/** Step 1: the system type, then "Custom" or a template. */
export default function CreateEstimateChooseStep({
  type,
  onTypeChange,
  onPick,
}: CreateEstimateChooseStepProps) {
  const { t } = useTranslation();
  const valuesOf = (template: EstimateTemplate) =>
    resolveTemplateValues(template, t)
      .map((value) => formatEstimateValue(template.type, value, { t }))
      .join(", ");

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>{t("settings:projectEstimates.create.chooseSystem")}</Label>
        <RadioGroup
          className="flex flex-row flex-wrap gap-4"
          value={type}
          onValueChange={(value) => {
            if (isEstimateType(value)) onTypeChange(value);
          }}
        >
          {ESTIMATE_TYPES.map((option) => (
            // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's Radio renders its own input inside the label, which labels it
            <label key={option} className="flex items-center gap-2 text-sm">
              <Radio value={option} />
              {t(ESTIMATE_TYPE_LABEL_KEYS[option])}
            </label>
          ))}
        </RadioGroup>
      </div>

      <div className="space-y-2">
        <p className="font-medium text-sm">
          {t("settings:projectEstimates.create.startFromScratch")}
        </p>
        <button
          type="button"
          className={cardClassName}
          onClick={() => onPick(CUSTOM_ESTIMATE_TEMPLATES[type])}
        >
          <span className="block font-medium text-sm">
            {t("settings:projectEstimates.create.custom")}
          </span>
          <span className="block text-muted-foreground text-xs">
            {t("settings:projectEstimates.create.customDescription")}
          </span>
        </button>
      </div>

      <div className="space-y-2">
        <p className="font-medium text-sm">
          {t("settings:projectEstimates.create.chooseTemplate")}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {templatesForType(type).map((template) => (
            <button
              key={template.key}
              type="button"
              className={cardClassName}
              onClick={() => onPick(template)}
            >
              <span className="block font-medium text-sm">
                {template.titleKey ? t(template.titleKey) : ""}
              </span>
              <span className="block truncate text-muted-foreground text-xs">
                {valuesOf(template)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
