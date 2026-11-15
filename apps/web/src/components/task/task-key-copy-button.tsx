import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { copyTaskKey } from "@/lib/copy-task-reference";
import { formatTaskKey } from "@/lib/task-key";

type TaskKeyCopyButtonProps = {
  slug: string | null | undefined;
  number: number | null | undefined;
  /** The text style of the place it replaces, so nothing shifts. */
  className?: string;
};

/** The task key (WEB-12) as text that copies itself when clicked. */
export default function TaskKeyCopyButton({
  slug,
  number,
  className,
}: TaskKeyCopyButtonProps) {
  const { t } = useTranslation();

  if (!slug || number == null) {
    return <span className={className}>&nbsp;</span>;
  }

  const key = formatTaskKey(slug, number);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              // Touch: a 44px hit area that grows mostly upward, away from the
              // title below it.
              "relative w-fit cursor-pointer rounded-sm text-left outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-top-[18px] pointer-coarse:after:-bottom-2.5",
              className,
            )}
            onClick={() => void copyTaskKey(key, t)}
          >
            {key}
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("tasks:taskKey.copyTooltip")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
