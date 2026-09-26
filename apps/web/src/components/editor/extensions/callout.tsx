import {
  CALLOUT_VARIANTS,
  Callout as CalloutNode,
  type CalloutVariant,
  calloutVariant,
} from "@margaya/editor-schema";
import type { NodeViewProps } from "@tiptap/react";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import {
  CircleCheck,
  Info,
  type LucideIcon,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@/components/ui/menu";

export const CALLOUT_ICONS: Record<CalloutVariant, LucideIcon> = {
  info: Info,
  warning: TriangleAlert,
  success: CircleCheck,
  danger: OctagonAlert,
};

/**
 * The callout box: an icon, which is the variant switcher while editing,
 * and the editable content. Read-only views show the icon alone (CSS swaps
 * them on the editor's contenteditable state).
 */
function CalloutView({ node, updateAttributes }: NodeViewProps) {
  const { t } = useTranslation();
  const variant = calloutVariant(node.attrs.variant);
  const Icon = CALLOUT_ICONS[variant];
  const variantLabel = (value: CalloutVariant) =>
    t(`tasks:detail.editor.callout.variants.${value}`);

  return (
    <NodeViewWrapper
      className="margaya-callout"
      data-type="callout"
      data-variant={variant}
    >
      <div className="margaya-callout-aside" contentEditable={false}>
        <span className="margaya-callout-icon" aria-hidden="true">
          <Icon className="size-4" />
        </span>
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                className="margaya-callout-switch"
                aria-label={t("tasks:detail.editor.callout.change", {
                  variant: variantLabel(variant),
                })}
              />
            }
          >
            <Icon className="size-4" />
          </MenuTrigger>
          <MenuPopup align="start" className="w-40">
            <MenuRadioGroup
              value={variant}
              onValueChange={(value) =>
                updateAttributes({ variant: calloutVariant(value) })
              }
            >
              {CALLOUT_VARIANTS.map((value) => {
                const ItemIcon = CALLOUT_ICONS[value];
                return (
                  <MenuRadioItem key={value} value={value}>
                    <span className="inline-flex items-center gap-2">
                      <ItemIcon
                        className="size-4"
                        data-callout-icon={value}
                        aria-hidden="true"
                      />
                      {variantLabel(value)}
                    </span>
                  </MenuRadioItem>
                );
              })}
            </MenuRadioGroup>
          </MenuPopup>
        </Menu>
      </div>
      <NodeViewContent className="margaya-callout-content" />
    </NodeViewWrapper>
  );
}

/** The schema's callout with the web node view. */
export const Callout = CalloutNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});
