import type { Editor } from "@tiptap/core";
import {
  Languages,
  type LucideIcon,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Palette,
  Sparkles,
  SpellCheck,
  TextQuote,
  WandSparkles,
} from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "@/components/ui/menu";
import type {
  AiUiLocale,
  EditorAiAction,
  EditorAiTone,
} from "@/fetchers/ai/writing";
import { GUEST_LOCALES } from "@/hooks/use-guest-locale";
import { cn } from "@/lib/cn";
import type { EditorAiRange } from "./editor-ai-apply";
import {
  EDITOR_AI_TONES,
  type EditorAi,
  type EditorAiRequest,
} from "./use-editor-ai";

type QuickAction = {
  action: Exclude<EditorAiAction, "translate" | "custom">;
  Icon: LucideIcon;
};

const QUICK_ACTIONS: readonly QuickAction[] = [
  { action: "improve", Icon: WandSparkles },
  { action: "fix", Icon: SpellCheck },
  { action: "shorter", Icon: Minimize2 },
  { action: "longer", Icon: Maximize2 },
  { action: "summarize", Icon: TextQuote },
];

const ACTION_LABEL_KEYS = {
  summarize: "ai:writing.actions.summarize",
  improve: "ai:writing.actions.improve",
  shorter: "ai:writing.actions.shorter",
  longer: "ai:writing.actions.longer",
  fix: "ai:writing.actions.fix",
  translate: "ai:writing.actions.translate",
  custom: "ai:writing.actions.custom",
  draft: "ai:writing.taskWriter.draft",
} as const satisfies Record<EditorAiAction, string>;

/** The i18n key naming an action (menu items and the preview title). */
export function editorAiActionKey(action: EditorAiAction): string {
  return ACTION_LABEL_KEYS[action];
}

const TONE_LABEL_KEYS = {
  default: "ai:writing.tone.default",
  professional: "ai:writing.tone.professional",
  casual: "ai:writing.tone.casual",
} as const satisfies Record<EditorAiTone, string>;

/** The i18n key naming a tone preset. */
export function editorAiToneKey(tone: EditorAiTone): string {
  return TONE_LABEL_KEYS[tone];
}

/**
 * The AI actions as menu items: the quick rewrites, "Translate to…" with the
 * 20 UI languages by their own names, and "Ask AI to…".
 */
export function EditorAiMenuItems({
  onRun,
  tone,
  onToneChange,
}: {
  onRun: (request: EditorAiRequest) => void;
  /** With both, a "Tone" submenu sets the preset for rewrites. */
  tone?: EditorAiTone;
  onToneChange?: (tone: EditorAiTone) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {QUICK_ACTIONS.map(({ action, Icon }) => (
        <MenuItem key={action} onClick={() => onRun({ action })}>
          <Icon />
          {t(editorAiActionKey(action))}
        </MenuItem>
      ))}
      <MenuSub>
        <MenuSubTrigger>
          <Languages />
          {t("ai:writing.actions.translate")}
        </MenuSubTrigger>
        <MenuSubPopup className="max-h-80 w-48">
          {GUEST_LOCALES.map((locale) => (
            <MenuItem
              key={locale.code}
              lang={locale.code}
              onClick={() =>
                onRun({
                  action: "translate",
                  language: locale.code as AiUiLocale,
                })
              }
            >
              {locale.nativeName}
            </MenuItem>
          ))}
        </MenuSubPopup>
      </MenuSub>
      {tone && onToneChange && (
        <MenuSub>
          <MenuSubTrigger>
            <Palette />
            {t("ai:writing.tone.label", { tone: t(editorAiToneKey(tone)) })}
          </MenuSubTrigger>
          <MenuSubPopup className="w-44">
            <MenuRadioGroup
              value={tone}
              onValueChange={(value) => onToneChange(value as EditorAiTone)}
            >
              {EDITOR_AI_TONES.map((value) => (
                <MenuRadioItem key={value} value={value}>
                  {t(editorAiToneKey(value))}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubPopup>
        </MenuSub>
      )}
      <MenuSeparator />
      <MenuItem onClick={() => onRun({ action: "custom" })}>
        <MessageSquareText />
        {t("ai:writing.actions.custom")}
      </MenuItem>
    </>
  );
}

/**
 * "✦ AI ▾" in the selection bubble. The selection is taken when the menu
 * opens, so it still counts after focus moves into the menu.
 */
export function EditorAiBubbleButton({
  editor,
  ai,
  className,
}: {
  editor: Editor;
  ai: EditorAi;
  className?: string;
}) {
  const { t } = useTranslation();
  const rangeRef = useRef<EditorAiRange | null>(null);
  return (
    <Menu
      onOpenChange={(open) => {
        if (!open) return;
        const { from, to } = editor.state.selection;
        rangeRef.current = to > from ? { from, to } : null;
      }}
    >
      <MenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn("margaya-tiptap-bubble-btn gap-1", className)}
          />
        }
        aria-label={t("ai:writing.menuLabel")}
        title={t("ai:writing.menuLabel")}
      >
        <Sparkles className="size-3.5 text-muted-foreground" />
        <span className="text-xs">{t("ai:writing.aiButton")}</span>
      </MenuTrigger>
      <MenuPopup align="start" className="w-56">
        <EditorAiMenuItems
          tone={ai.tone}
          onToneChange={ai.setTone}
          onRun={(request) => {
            if (rangeRef.current) ai.begin(request, rangeRef.current);
          }}
        />
      </MenuPopup>
    </Menu>
  );
}
