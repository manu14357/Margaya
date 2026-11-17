import { Download, FileCode, FileImage, FileJson } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { saveFile } from "@/lib/save-file";
import { toast } from "@/lib/toast";
import { boardFileName } from "@/lib/whiteboards/export-file-name";
import type { WhiteboardEditorHandle } from "./editor/types";

type ExportKind = "png" | "svg" | "file";

type WhiteboardExportMenuProps = {
  editor: WhiteboardEditorHandle | null;
  title: string;
  theme: "light" | "dark";
};

/** PNG (with the board embedded), SVG or a `.margaya-board` file. */
export default function WhiteboardExportMenu({
  editor,
  title,
  theme,
}: WhiteboardExportMenuProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const fallback = t("whiteboards:list.untitled");

  const run = async (kind: ExportKind) => {
    if (!editor || busy) return;
    setBusy(kind);
    try {
      if (kind === "png") {
        const blob = await editor.exportPng({
          scale: 2,
          background: true,
          embedScene: true,
          theme,
        });
        saveFile(blob, boardFileName(title, "png", fallback));
      } else if (kind === "svg") {
        const svg = await editor.exportSvg({ background: true, theme });
        saveFile(
          new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
          boardFileName(title, "svg", fallback),
        );
      } else {
        saveFile(
          new Blob([await editor.exportFile()], {
            type: "application/json;charset=utf-8",
          }),
          boardFileName(title, "margaya-board", fallback),
        );
      }
    } catch {
      toast.error(t("whiteboards:toasts.exportError"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!editor}
            aria-label={t("whiteboards:actions.export")}
            title={t("whiteboards:actions.export")}
            className="text-muted-foreground"
          />
        }
      >
        <Download className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
            {t("whiteboards:actions.export")}
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => void run("png")}>
            <FileImage />
            {t("whiteboards:actions.exportPng")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void run("svg")}>
            <FileCode />
            {t("whiteboards:actions.exportSvg")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void run("file")}>
            <FileJson />
            {t("whiteboards:actions.exportFile")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
