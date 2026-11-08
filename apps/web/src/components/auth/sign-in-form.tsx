import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Link } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
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
import { signInErrorMessage } from "@/lib/sign-in-error";
import { toast } from "@/lib/toast";
import { TwoFactorChallenge } from "./two-factor-challenge";

export type SignInFormValues = {
  email: string;
  password: string;
};

type SignInFormProps = {
  onSuccess?: () => void;
  defaultEmail?: string;
  /** Offer the forgotten-password link (password sign-in and SMTP are on). */
  showForgotPassword?: boolean;
};

const signInSchema = z.object({
  email: z.email(),
  password: z.string(),
});

export function SignInForm({
  onSuccess,
  defaultEmail,
  showForgotPassword = false,
}: SignInFormProps) {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const form = useForm<SignInFormValues>({
    resolver: standardSchemaResolver(signInSchema),
    defaultValues: {
      email: defaultEmail || "",
      password: "",
    },
  });

  const onSubmit = async (data: SignInFormValues) => {
    setIsPending(true);
    try {
      const result = await authClient.signIn.email({
        email: data.email,
        password: data.password,
      });

      if (result.error) {
        toast.error(
          signInErrorMessage(
            result.error,
            t,
            t("auth:signInForm.failedSignIn"),
          ),
        );
        return;
      }
      // Two-factor accounts get a session only after the code step.
      if (
        result.data &&
        "twoFactorRedirect" in result.data &&
        result.data.twoFactorRedirect
      ) {
        setNeedsCode(true);
        return;
      }

      toast.success(t("auth:signInForm.signedInSuccess"));
      setTimeout(() => {
        onSuccess?.();
      }, 500);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("auth:signInForm.failedSignIn"),
      );
    } finally {
      setIsPending(false);
    }
  };

  if (needsCode) {
    return (
      <TwoFactorChallenge
        onSuccess={() => {
          toast.success(t("auth:signInForm.signedInSuccess"));
          setTimeout(() => onSuccess?.(), 500);
        }}
        onBack={() => {
          setNeedsCode(false);
          form.setValue("password", "");
        }}
      />
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <div className="space-y-3">
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

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-2">
                  <FormLabel className="text-sm font-medium">
                    {t("auth:forms.password")}
                  </FormLabel>
                  {showForgotPassword && (
                    <Link
                      to="/auth/forgot-password"
                      search={() => {
                        const email = form.getValues("email");
                        return email ? { email } : {};
                      }}
                      className="text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
                    >
                      {t("auth:signInForm.forgotPassword")}
                    </Link>
                  )}
                </div>
                {/* The control (and its label's id) is the input itself, not the
                    wrapper that also holds the show-password button. */}
                <div className="relative">
                  <FormControl>
                    <Input
                      placeholder={t("auth:forms.passwordPlaceholder")}
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      {...field}
                    />
                  </FormControl>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={
                      showPassword
                        ? t("auth:forms.hidePassword")
                        : t("auth:forms.showPassword")
                    }
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Button type="submit" disabled={isPending} className="w-full mt-4">
          {isPending
            ? t("auth:signInForm.signingIn")
            : t("auth:signInForm.signIn")}
        </Button>
      </form>
    </Form>
  );
}
