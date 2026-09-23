import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { MailCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/lib/toast";

const emailSchema = z.object({ email: z.email() });

type ForgotPasswordValues = z.infer<typeof emailSchema>;

type ForgotPasswordFormProps = {
  defaultEmail?: string;
  /** Undefined when no CAPTCHA is configured; null until it is solved. */
  turnstileToken?: string | null;
  onAttemptComplete?: () => void;
};

/**
 * Asks for a reset link. Whatever the server knows, the visitor sees the same
 * confirmation, so the form never reveals which addresses have accounts.
 */
export function ForgotPasswordForm({
  defaultEmail,
  turnstileToken,
  onAttemptComplete,
}: ForgotPasswordFormProps) {
  const { t } = useTranslation();
  const [isPending, setIsPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const captchaPending = turnstileToken !== undefined && !turnstileToken;

  const form = useForm<ForgotPasswordValues>({
    resolver: standardSchemaResolver(emailSchema),
    defaultValues: { email: defaultEmail ?? "" },
  });

  const onSubmit = async ({ email }: ForgotPasswordValues) => {
    if (captchaPending) return;
    setIsPending(true);
    try {
      const result = await authClient.requestPasswordReset(
        { email },
        {
          headers: turnstileToken
            ? { "x-turnstile-token": turnstileToken }
            : undefined,
        },
      );
      // A refused CAPTCHA or a rate limit is about this attempt, not the
      // account, so it is safe to say so.
      if (result.error) {
        toast.error(result.error.message || t("auth:forgotPassword.failed"));
        return;
      }
      setSentTo(email);
    } catch {
      toast.error(t("auth:forgotPassword.failed"));
    } finally {
      setIsPending(false);
      onAttemptComplete?.();
    }
  };

  if (sentTo) {
    return (
      <div
        className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
        role="status"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-foreground">
          <MailCheck className="size-4" aria-hidden />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {t("auth:forgotPassword.sentTitle")}
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("auth:forgotPassword.sentMessage", { email: sentTo })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">
                {t("auth:forms.email")}
              </FormLabel>
              <FormControl>
                <Input
                  placeholder={t("auth:forms.emailPlaceholder")}
                  type="email"
                  autoComplete="email"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          disabled={isPending || captchaPending}
          className="w-full mt-4"
        >
          {isPending
            ? t("auth:forgotPassword.sending")
            : t("auth:forgotPassword.submit")}
        </Button>
      </form>
    </Form>
  );
}
