import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Link } from "@tanstack/react-router";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { authClient } from "@/lib/auth-client";
import { newPasswordPairSchema } from "@/lib/password-rules";
import { toast } from "@/lib/toast";

type ResetPasswordValues = {
  newPassword: string;
  confirmPassword: string;
};

type Status = "form" | "invalid" | "done";

function Notice({
  tone,
  title,
  description,
  children,
}: {
  tone: "success" | "error";
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const Icon = tone === "success" ? CircleCheck : TriangleAlert;
  return (
    <div className="space-y-4">
      <div
        className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
        role={tone === "error" ? "alert" : "status"}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {description}
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

/** Sets a new password from an emailed reset link's token. */
export function ResetPasswordForm({ token }: { token?: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>(token ? "form" : "invalid");
  const [isPending, setIsPending] = useState(false);
  const schema = useMemo(() => newPasswordPairSchema(t), [t]);

  const form = useForm<ResetPasswordValues>({
    resolver: standardSchemaResolver(schema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const onSubmit = async ({ newPassword }: ResetPasswordValues) => {
    if (!token) return;
    setIsPending(true);
    try {
      const { error } = await authClient.resetPassword({ newPassword, token });
      if (error?.code === "INVALID_TOKEN") {
        setStatus("invalid");
        return;
      }
      if (error) {
        toast.error(error.message || t("auth:resetPassword.failed"));
        return;
      }
      setStatus("done");
    } catch {
      toast.error(t("auth:resetPassword.failed"));
    } finally {
      setIsPending(false);
    }
  };

  if (status === "invalid") {
    return (
      <Notice
        tone="error"
        title={t("auth:resetPassword.invalidTitle")}
        description={t("auth:resetPassword.invalidDescription")}
      >
        <Button render={<Link to="/auth/forgot-password" />} className="w-full">
          {t("auth:resetPassword.requestNew")}
        </Button>
      </Notice>
    );
  }

  if (status === "done") {
    return (
      <Notice
        tone="success"
        title={t("auth:resetPassword.successTitle")}
        description={t("auth:resetPassword.successDescription")}
      >
        <Button render={<Link to="/auth/sign-in" />} className="w-full">
          {t("auth:resetPassword.signIn")}
        </Button>
      </Notice>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <FormField
          control={form.control}
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">
                {t("auth:resetPassword.newPassword")}
              </FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">
                {t("auth:resetPassword.confirmPassword")}
              </FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={isPending} className="w-full mt-4">
          {isPending
            ? t("auth:resetPassword.saving")
            : t("auth:resetPassword.submit")}
        </Button>
      </form>
    </Form>
  );
}
