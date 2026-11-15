import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { modifierLabel, SHORTCUT_SECTIONS } from "./shortcuts";

/** Words shown in place of a key ("drag", "wheel") are translated. */
const KEY_WORDS: Record<string, string> = {
  drag: "whiteboardEditor:help.keys.drag",
  wheel: "whiteboardEditor:help.keys.wheel",
  click: "whiteboardEditor:help.keys.click",
  "double-click": "whiteboardEditor:help.keys.doubleClick",
  Space: "whiteboardEditor:help.keys.space",
  Delete: "whiteboardEditor:help.keys.delete",
  Enter: "whiteboardEditor:help.keys.enter",
  Esc: "whiteboardEditor:help.keys.escape",
  Shift: "whiteboardEditor:help.keys.shift",
  Alt: "whiteboardEditor:help.keys.alt",
};

export function HelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const mod = modifierLabel();
  const label = (key: string) => {
    if (key === "Mod") return mod;
    const word = KEY_WORDS[key];
    return word ? t(word) : key;
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("whiteboardEditor:help.title")}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="grid gap-6 sm:grid-cols-2">
            {SHORTCUT_SECTIONS.map((section) => (
              <section key={section.titleKey} aria-label={t(section.titleKey)}>
                <h3 className="mb-2 font-semibold text-sm">
                  {t(section.titleKey)}
                </h3>
                <dl className="flex flex-col gap-1">
                  {section.rows.map((row) => (
                    <div
                      key={row.labelKey + row.keys.flat().join()}
                      className="flex items-center justify-between gap-3 py-0.5 text-sm"
                    >
                      <dt className="text-muted-foreground">
                        {t(row.labelKey)}
                      </dt>
                      <dd className="flex shrink-0 items-center gap-1.5">
                        {row.keys.map((combo, index) => (
                          <Fragment key={combo.join("+")}>
                            {index > 0 && (
                              <span className="text-muted-foreground/72 text-xs">
                                {t("whiteboardEditor:help.or")}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-0.5">
                              {combo.map((key) => (
                                <Kbd key={key}>{label(key)}</Kbd>
                              ))}
                            </span>
                          </Fragment>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
