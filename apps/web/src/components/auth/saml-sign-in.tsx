import { Building2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { isValidEmail } from "@/lib/instance-settings";
import { toast } from "@/lib/toast";

type SamlSignInProps = {
  callbackURL: string;
  errorCallbackURL: string;
  defaultEmail?: string;
  disabled?: boolean;
  turnstileToken?: string | null;
  onAttemptComplete?: () => void;
};

/**
 * Asks for the work address, because the domain decides the identity provider.
 * No address is checked here: the server answers only about domains. Better
 * Auth's client follows the answer to the identity provider, as it does for
 * every other provider: going there from here too would cancel its navigation
 * and send the sign-in request twice.
 */
export function SamlSignIn({
  callbackURL,
  errorCallbackURL,
  defaultEmail,
  disabled = false,
  turnstileToken,
  onAttemptComplete,
}: SamlSignInProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [isPending, setIsPending] = useState(false);
  const valid = isValidEmail(email);

  const submit = async () => {
    if (!valid || disabled) return;
    setIsPending(true);
    try {
      const { error } = await authClient.$fetch("/sign-in/sso", {
        method: "POST",
        body: {
          email: email.trim().toLowerCase(),
          callbackURL,
          errorCallbackURL,
          providerType: "saml",
        },
        headers: turnstileToken
          ? { "x-turnstile-token": turnstileToken }
          : undefined,
      });
      if (error) {
        toast.error(
          error.status === 404
            ? t("auth:signIn.samlNoConnection")
            : error.message || t("auth:signIn.samlError"),
        );
      }
    } catch {
      toast.error(t("auth:signIn.samlError"));
    } finally {
      setIsPending(false);
      onAttemptComplete?.();
    }
  };

  if (!open) {
    return (
      <Button
        variant="outline"
        className="w-full"
        data-provider="saml"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Building2 className="w-5 h-5 mr-2" />
        {t("auth:signIn.continueWithSaml")}
      </Button>
    );
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Label htmlFor="saml-sign-in-email">{t("auth:signIn.samlEmail")}</Label>
      <Input
        id="saml-sign-in-email"
        type="email"
        autoComplete="email"
        autoFocus
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Button
        type="submit"
        variant="outline"
        className="w-full"
        data-provider="saml"
        disabled={!valid || disabled}
        loading={isPending}
      >
        {t("auth:signIn.samlSubmit")}
      </Button>
    </form>
  );
}
