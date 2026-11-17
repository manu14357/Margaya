import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useController, useEditorState } from "./use-editor";

/** Whether this device has a touch screen, where a pen may rest a palm. */
function hasTouchScreen(): boolean {
  return typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
}

/**
 * "Draw with pen only": touch then only pans and zooms. Shown on touch
 * screens (and wherever it is already on, so it can be turned off).
 */
export function PenOnlySwitch() {
  const { t } = useTranslation();
  const c = useController();
  const penOnly = useEditorState((state) => state.penOnly);
  const id = useId();
  if (!penOnly && !hasTouchScreen()) return null;
  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <div className="min-w-0">
        <Label htmlFor={id} className="font-normal text-xs">
          {t("whiteboardEditor:pens.penOnly")}
        </Label>
        <p className="text-[11px] text-muted-foreground">
          {t("whiteboardEditor:pens.penOnlyHint")}
        </p>
      </div>
      <Switch
        id={id}
        checked={penOnly}
        onCheckedChange={(checked) =>
          c.update((state) => ({ ...state, penOnly: checked }))
        }
      />
    </div>
  );
}
