import { CheckCircle2, Link2Off } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { MargayaBranding } from "@/components/public-project/margaya-branding";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { PublicIntakeForm } from "@/fetchers/intake-sources/intake-sources";
import { useSubmitPublicIntakeForm } from "@/hooks/mutations/intake-sources/use-intake-source-mutations";
import { usePublicIntakeForm } from "@/hooks/queries/intake-sources/use-intake-sources";
import { HttpError } from "@/lib/http-error";
import { missingRequestFields } from "@/lib/request-form";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full flex-col bg-background">
      <main className="flex flex-1 justify-center px-4 py-10">
        <div className="w-full max-w-xl">{children}</div>
      </main>
      <footer className="flex justify-center px-4 py-4 text-muted-foreground text-xs">
        <MargayaBranding />
      </footer>
    </div>
  );
}

/** The public request form (#8): no sign-in, no workspace data. */
export default function RequestFormPage({ token }: { token: string }) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = usePublicIntakeForm(token);

  if (isLoading) {
    return (
      <Shell>
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </Shell>
    );
  }

  if (isError || !data) {
    return (
      <Shell>
        <PageTitle title={t("intake:publicForm.notFoundTitle")} />
        <div className="flex flex-col items-center gap-4 pt-16 text-center">
          <div className="flex size-14 items-center justify-center rounded-[28%] bg-destructive/12">
            <Link2Off
              className="size-6 text-destructive-foreground"
              aria-hidden="true"
            />
          </div>
          <h1 className="font-heading font-semibold text-2xl">
            {t("intake:publicForm.notFoundTitle")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("intake:publicForm.notFoundBody")}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <RequestForm token={token} form={data} />
    </Shell>
  );
}

type Values = {
  title: string;
  description: string;
  email: string;
  name: string;
  custom: Record<string, string>;
  website: string;
};

function RequestForm({
  token,
  form,
}: {
  token: string;
  form: PublicIntakeForm;
}) {
  const { t } = useTranslation();
  const submit = useSubmitPublicIntakeForm(token);
  const shownAt = useRef(Date.now());
  const ids = {
    title: useId(),
    description: useId(),
    email: useId(),
    name: useId(),
    website: useId(),
    error: useId(),
  };
  const [values, setValues] = useState<Values>({
    title: "",
    description: "",
    email: "",
    name: "",
    custom: {},
    website: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const heading = form.title ?? t("intake:publicForm.defaultTitle");

  const setCustom = (id: string, value: string) =>
    setValues((current) => ({
      ...current,
      custom: { ...current.custom, [id]: value },
    }));

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const missing = missingRequestFields(form, values);
    if (missing.length > 0) {
      setError(t("intake:publicForm.missing"));
      return;
    }
    setError(null);
    try {
      const result = await submit.mutateAsync({
        title: values.title,
        description: values.description || undefined,
        email: values.email || undefined,
        name: values.name || undefined,
        customFields: values.custom,
        website: values.website || undefined,
        elapsedMs: Date.now() - shownAt.current,
      });
      setSent(result.confirmationMessage ?? t("intake:publicForm.sentBody"));
    } catch (caught) {
      if (caught instanceof HttpError && caught.status === 429) {
        setError(t("intake:publicForm.tooMany"));
      } else if (caught instanceof HttpError && caught.status === 400) {
        setError(caught.message || t("intake:publicForm.failed"));
      } else {
        setError(t("intake:publicForm.failed"));
      }
    }
  };

  if (sent !== null) {
    return (
      <div className="flex flex-col items-center gap-4 pt-16 text-center">
        <PageTitle title={heading} />
        <CheckCircle2
          className="size-10 text-[var(--status-done)]"
          aria-hidden="true"
        />
        <h1 className="font-heading font-semibold text-2xl">
          {t("intake:publicForm.sentTitle")}
        </h1>
        <p
          className="whitespace-pre-line text-muted-foreground text-sm"
          role="status"
        >
          {sent}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setValues({
              title: "",
              description: "",
              email: "",
              name: "",
              custom: {},
              website: "",
            });
            shownAt.current = Date.now();
            setSent(null);
          }}
        >
          {t("intake:publicForm.another")}
        </Button>
      </div>
    );
  }

  const required = (mode: string) => mode === "required";

  return (
    <form className="space-y-5" onSubmit={onSubmit} noValidate>
      <PageTitle title={heading} />
      <div className="space-y-1.5">
        <h1 className="font-heading font-semibold text-2xl">{heading}</h1>
        {form.intro && (
          <p className="whitespace-pre-line text-muted-foreground text-sm">
            {form.intro}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={ids.title}>
          {t("intake:publicForm.titleLabel")}
          <span aria-hidden="true"> *</span>
        </Label>
        <Input
          id={ids.title}
          required
          maxLength={255}
          value={values.title}
          onChange={(event) =>
            setValues((v) => ({ ...v, title: event.target.value }))
          }
        />
      </div>

      {form.fields.description !== "off" && (
        <div className="space-y-1.5">
          <Label htmlFor={ids.description}>
            {t("intake:publicForm.descriptionLabel")}
            {required(form.fields.description) && (
              <span aria-hidden="true"> *</span>
            )}
          </Label>
          <Textarea
            id={ids.description}
            rows={6}
            maxLength={10_000}
            required={required(form.fields.description)}
            value={values.description}
            onChange={(event) =>
              setValues((v) => ({ ...v, description: event.target.value }))
            }
          />
        </div>
      )}

      {form.customFields.map((field) => (
        <CustomFieldInput
          key={field.id}
          field={field}
          value={values.custom[field.id] ?? ""}
          onChange={(value) => setCustom(field.id, value)}
        />
      ))}

      {form.fields.name !== "off" && (
        <div className="space-y-1.5">
          <Label htmlFor={ids.name}>
            {t("intake:publicForm.nameLabel")}
            {required(form.fields.name) && <span aria-hidden="true"> *</span>}
          </Label>
          <Input
            id={ids.name}
            autoComplete="name"
            maxLength={200}
            required={required(form.fields.name)}
            value={values.name}
            onChange={(event) =>
              setValues((v) => ({ ...v, name: event.target.value }))
            }
          />
        </div>
      )}

      {form.fields.email !== "off" && (
        <div className="space-y-1.5">
          <Label htmlFor={ids.email}>
            {t("intake:publicForm.emailLabel")}
            {required(form.fields.email) && <span aria-hidden="true"> *</span>}
          </Label>
          <Input
            id={ids.email}
            type="email"
            autoComplete="email"
            maxLength={320}
            required={required(form.fields.email)}
            value={values.email}
            onChange={(event) =>
              setValues((v) => ({ ...v, email: event.target.value }))
            }
          />
          <p className="text-muted-foreground text-xs">
            {t("intake:publicForm.emailHint")}
          </p>
        </div>
      )}

      {/* A spam trap: hidden from people and assistive tech, bots fill it. */}
      <div
        aria-hidden="true"
        className="absolute -left-[9999px] h-px w-px overflow-hidden"
      >
        <label htmlFor={ids.website}>Website</label>
        <input
          id={ids.website}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(event) =>
            setValues((v) => ({ ...v, website: event.target.value }))
          }
        />
      </div>

      {error && (
        <p id={ids.error} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          {t("intake:publicForm.requiredNote")}
        </p>
        <Button type="submit" loading={submit.isPending}>
          {t("intake:publicForm.submit")}
        </Button>
      </div>
    </form>
  );
}

function CustomFieldInput({
  field,
  value,
  onChange,
}: {
  field: PublicIntakeForm["customFields"][number];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const label = (
    <Label htmlFor={id}>
      {field.name}
      {field.required && <span aria-hidden="true"> *</span>}
    </Label>
  );

  if (field.type === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={value === "true"}
          onCheckedChange={(checked) => onChange(checked ? "true" : "")}
        />
        {label}
      </div>
    );
  }

  if (field.type === "dropdown") {
    return (
      <div className="space-y-1.5">
        {label}
        <Select
          value={value || null}
          onValueChange={(next) => onChange(String(next ?? ""))}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue>{value || t("intake:publicForm.choose")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {label}
      <Input
        id={id}
        type={
          field.type === "number"
            ? "number"
            : field.type === "date"
              ? "date"
              : "text"
        }
        maxLength={field.type === "text" ? 1_000 : undefined}
        required={field.required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
