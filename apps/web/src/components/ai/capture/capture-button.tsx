import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import CaptureDialog from "./capture-dialog";

/**
 * "✦ Capture" in the Intake header: new requests from screenshots, a screen
 * recording or a transcript. Hidden while AI is off for the project or the
 * person lacks ai:use; the caller checks intake:create.
 */
export default function CaptureButton({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { available } = useAiAvailability(projectId);
  const [open, setOpen] = useState(false);
  if (!available) return null;
  return (
    <>
      <Button
        variant="outline"
        size="xs"
        className="gap-1"
        title={t("ai:capture.buttonHint")}
        onClick={() => setOpen(true)}
      >
        <Sparkles aria-hidden="true" className="size-3 text-muted-foreground" />
        {t("ai:capture.button")}
      </Button>
      {open && (
        <CaptureDialog
          projectId={projectId}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
