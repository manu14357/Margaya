import { Globe, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CommentVisibility } from "@/types/publication";

type CommentVisibilitySwitchProps = {
  value: CommentVisibility;
  onChange: (value: CommentVisibility) => void;
  disabled?: boolean;
};

/** Internal or Public, next to the comment box's send button. */
export default function CommentVisibilitySwitch({
  value,
  onChange,
  disabled = false,
}: CommentVisibilitySwitchProps) {
  const { t } = useTranslation();
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <ToggleGroup
            variant="outline"
            size="sm"
            aria-label={t("activity:commentVisibility.label")}
            value={[value]}
            disabled={disabled}
            onValueChange={(next) => {
              const picked = next[0] as CommentVisibility | undefined;
              if (picked && picked !== value) onChange(picked);
            }}
          >
            <ToggleGroupItem
              value="internal"
              aria-label={t("activity:commentVisibility.internal")}
              className="h-6 gap-1 px-2 text-xs sm:h-6"
            >
              <Lock className="size-3" />
              {t("activity:commentVisibility.internal")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="public"
              aria-label={t("activity:commentVisibility.public")}
              className="h-6 gap-1 px-2 text-xs sm:h-6"
            >
              <Globe className="size-3" />
              {t("activity:commentVisibility.public")}
            </ToggleGroupItem>
          </ToggleGroup>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">
            {t("activity:commentVisibility.publicTooltip")}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
