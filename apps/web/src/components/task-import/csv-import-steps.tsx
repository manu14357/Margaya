import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

export type CsvImportStep = "upload" | "map" | "review" | "result";

const STEPS = [
  { step: "upload", labelKey: "settings:tasksImportExport.csv.steps.upload" },
  { step: "map", labelKey: "settings:tasksImportExport.csv.steps.map" },
  { step: "review", labelKey: "settings:tasksImportExport.csv.steps.review" },
] as const;

const ORDER: Record<CsvImportStep, number> = {
  upload: 0,
  map: 1,
  review: 2,
  result: 3,
};

type StepLabels = Record<(typeof STEPS)[number]["step"], string>;

/**
 * The numbered Upload → Map columns → Review indicator. Other imports pass
 * their own step labels (translation keys).
 */
export function CsvImportSteps({
  step,
  labels,
}: {
  step: CsvImportStep;
  labels?: StepLabels;
}) {
  const { t } = useTranslation();
  const current = ORDER[step];

  return (
    <ol className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      {STEPS.map((item, index) => {
        const isDone = index < current;
        const isCurrent = index === current;
        return (
          <li
            key={item.step}
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "flex items-center gap-2",
              isCurrent
                ? "font-medium text-foreground"
                : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full border text-xs",
                isDone && "border-primary bg-primary text-primary-foreground",
                isCurrent && "border-primary text-primary",
              )}
            >
              {isDone ? <Check className="size-3" /> : index + 1}
            </span>
            {t(labels?.[item.step] ?? item.labelKey)}
          </li>
        );
      })}
    </ol>
  );
}

export default CsvImportSteps;
