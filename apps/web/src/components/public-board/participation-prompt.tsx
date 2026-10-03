import { Link, useLocation } from "@tanstack/react-router";
import { LogIn, ShieldOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Turnstile } from "@/components/auth/turnstile";
import { Button } from "@/components/ui/button";
import { usePublicBoardSession } from "@/hooks/mutations/public-board/use-public-board-session";
import { cn } from "@/lib/cn";
import type { ParticipationState } from "@/lib/public-board/participation";
import { toast } from "@/lib/toast";

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as
  | string
  | undefined;

type ParticipationPromptProps = {
  token: string;
  state: ParticipationState;
  /** Replaces the default line, e.g. for requests. */
  message?: string;
  className?: string;
};

/**
 * What a viewer sees instead of a control they can't use (B12 §1.4):
 * Sign in (coming back to this exact view), Continue as guest where the
 * board allows guests, or the blocked notice.
 */
export default function ParticipationPrompt({
  token,
  state,
  message,
  className,
}: ParticipationPromptProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const { continueAsGuest } = usePublicBoardSession(token);
  const [needsCaptcha, setNeedsCaptcha] = useState(false);

  if (state.prompt === "allowed" || state.prompt === "hidden") return null;

  if (state.prompt === "blocked") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-muted-foreground text-sm",
          className,
        )}
      >
        <ShieldOff className="size-4 shrink-0" />
        {t("publicProject:participation.blocked")}
      </div>
    );
  }

  const text =
    message ??
    (state.prompt === "accountRequired"
      ? t("publicProject:participation.accountRequired")
      : state.prompt === "accountForAction"
        ? t("publicProject:participation.accountForAction")
        : t("publicProject:participation.signInTitle"));

  const signInAsGuest = (turnstileToken: string | null) =>
    continueAsGuest.mutate(turnstileToken, {
      onError: (error) =>
        toast.error(
          error.message || t("publicProject:participation.guestError"),
        ),
      onSettled: () => setNeedsCaptcha(false),
    });

  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5",
        className,
      )}
    >
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <p className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground text-sm">
          <LogIn className="size-4 shrink-0" aria-hidden="true" />
          <span>{text}</span>
        </p>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {state.guestOption && (
            <Button
              size="sm"
              variant="outline"
              disabled={continueAsGuest.isPending || needsCaptcha}
              onClick={() =>
                TURNSTILE_SITE_KEY ? setNeedsCaptcha(true) : signInAsGuest(null)
              }
            >
              {t("publicProject:participation.continueAsGuest")}
            </Button>
          )}
          <Button
            size="sm"
            render={
              <Link to="/auth/sign-in" search={{ redirect: location.href }} />
            }
          >
            {t("publicProject:participation.signIn")}
          </Button>
        </div>
      </div>
      {needsCaptcha && TURNSTILE_SITE_KEY && (
        <Turnstile
          siteKey={TURNSTILE_SITE_KEY}
          onVerify={(captcha) => signInAsGuest(captcha)}
          onError={() => setNeedsCaptcha(false)}
        />
      )}
    </div>
  );
}
