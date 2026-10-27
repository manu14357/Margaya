import { CircleCheck, CircleX } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { AiTestResult } from "@/fetchers/ai/ai";
import { aiErrorKey } from "@/lib/ai/format";

type AiTestButtonProps = {
  label: string;
  run: () => Promise<AiTestResult>;
  disabled?: boolean;
};

/** "Test connection" with its result read out politely. */
export function AiTestButton({ label, run, disabled }: AiTestButtonProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AiTestResult | null>(null);
  const [failed, setFailed] = useState<unknown>(null);

  const handleClick = async () => {
    setPending(true);
    setFailed(null);
    setResult(null);
    try {
      setResult(await run());
    } catch (error) {
      setFailed(error);
    } finally {
      setPending(false);
    }
  };

  const ok = result?.ok === true;
  const message = result
    ? ok
      ? t("ai:test.success", {
          model: result.model ?? "",
          ms: result.latencyMs ?? 0,
        })
      : t(result.code ? aiErrorKey({ code: result.code }) : "ai:errors.unknown")
    : failed
      ? t(aiErrorKey(failed))
      : null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={pending}
        disabled={disabled}
        onClick={() => void handleClick()}
      >
        {label}
      </Button>
      <p aria-live="polite" className="flex items-center gap-1.5 text-xs">
        {message && (
          <>
            {ok ? (
              <CircleCheck
                className="size-3.5 text-success-foreground"
                aria-hidden
              />
            ) : (
              <CircleX
                className="size-3.5 text-destructive-foreground"
                aria-hidden
              />
            )}
            <span
              className={ok ? "text-foreground" : "text-destructive-foreground"}
            >
              {message}
            </span>
          </>
        )}
      </p>
      {/* The server's own reason (e.g. "rejected the API key"), or a note on
          a success (e.g. local-only routing keeps data away from it). */}
      {result?.message && (
        <p className="basis-full text-muted-foreground text-xs">
          {result.message}
        </p>
      )}
    </div>
  );
}
