import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { CalendarIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import useCreateApiKey from "@/hooks/mutations/api-key/use-create-api-key";
import {
  customExpiresInSeconds,
  customExpiryBounds,
  isCustomExpiryAllowed,
} from "@/lib/api-key/expiry";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";
import { toast } from "@/lib/toast";
import type { CreateApiKeyResponse } from "@/types/api-key";
import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

const EXPIRATION_SECONDS = {
  "1d": 86400,
  "7d": 604800,
  "30d": 2592000,
  "90d": 7776000,
} as const;

const CUSTOM_EXPIRATION = "custom";

type FormValues = {
  name: string;
  expiresIn: string;
  /** The last local day of a "Custom date…" expiry. */
  customDate?: Date;
};

type CreateApiKeyDialogProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: (data: CreateApiKeyResponse) => void;
};

export function CreateApiKeyDialog({
  open,
  onClose,
  onSuccess,
}: CreateApiKeyDialogProps) {
  const { t } = useTranslation();
  const { mutateAsync: createApiKey } = useCreateApiKey();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const createApiKeySchema = useMemo(
    () =>
      z
        .object({
          name: z
            .string()
            .min(1, t("settings:apiKey.createDialog.validation.nameRequired"))
            .min(3, t("settings:apiKey.createDialog.validation.nameShort")),
          expiresIn: z
            .string()
            .min(
              1,
              t("settings:apiKey.createDialog.validation.expirationRequired"),
            ),
          customDate: z.date().optional(),
        })
        .superRefine((values, ctx) => {
          if (values.expiresIn !== CUSTOM_EXPIRATION) return;
          if (values.customDate && isCustomExpiryAllowed(values.customDate)) {
            return;
          }
          ctx.addIssue({
            code: "custom",
            path: ["customDate"],
            message: t("settings:apiKey.createDialog.customDateRange"),
          });
        }),
    [t],
  );

  const expirationOptions = useMemo(
    () =>
      [
        {
          label: t("settings:apiKey.createDialog.expiration1d"),
          value: "1d",
        },
        {
          label: t("settings:apiKey.createDialog.expiration7d"),
          value: "7d",
        },
        {
          label: t("settings:apiKey.createDialog.expiration30d"),
          value: "30d",
        },
        {
          label: t("settings:apiKey.createDialog.expiration90d"),
          value: "90d",
        },
        {
          label: t("settings:apiKey.createDialog.expirationNever"),
          value: "never",
        },
        {
          label: t("settings:apiKey.createDialog.expirationCustom"),
          value: CUSTOM_EXPIRATION,
        },
      ] as const,
    [t],
  );

  const form = useForm<FormValues>({
    resolver: standardSchemaResolver(createApiKeySchema),
    defaultValues: {
      name: "",
      expiresIn: "30d",
    },
  });

  const expiresIn = form.watch("expiresIn");
  const customBounds = useMemo(
    () => (expiresIn === CUSTOM_EXPIRATION ? customExpiryBounds() : null),
    [expiresIn],
  );

  const onSubmit = async (data: FormValues) => {
    const expiresInValue =
      data.expiresIn === "never"
        ? null
        : data.expiresIn === CUSTOM_EXPIRATION && data.customDate
          ? customExpiresInSeconds(data.customDate)
          : EXPIRATION_SECONDS[
              data.expiresIn as keyof typeof EXPIRATION_SECONDS
            ];

    setIsSubmitting(true);
    try {
      const result = await createApiKey({
        name: data.name,
        expiresIn: expiresInValue ?? null,
      });

      form.reset();
      onSuccess(result);
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:apiKey.createDialog.failedCreate"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      form.reset();
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg p-0 gap-0">
        <DialogHeader className="px-6 py-5 border-b border-border">
          <DialogTitle>{t("settings:apiKey.createDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("settings:apiKey.createDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-0">
            <div className="space-y-5 px-6 py-5">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("settings:apiKey.createDialog.nameLabel")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t(
                          "settings:apiKey.createDialog.namePlaceholder",
                        )}
                        {...field}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("settings:apiKey.createDialog.nameDescription")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="expiresIn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("settings:apiKey.createDialog.expirationLabel")}
                    </FormLabel>
                    <FormControl>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={isSubmitting}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t(
                              "settings:apiKey.createDialog.expirationPlaceholder",
                            )}
                          >
                            {expirationOptions.find(
                              (o) => o.value === field.value,
                            )?.label ?? field.value}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {expirationOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>
                      {t("settings:apiKey.createDialog.expirationDescription")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {customBounds && (
                <FormField
                  control={form.control}
                  name="customDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("settings:apiKey.createDialog.customDateLabel")}
                      </FormLabel>
                      <Popover
                        open={isCalendarOpen}
                        onOpenChange={setIsCalendarOpen}
                      >
                        {/* FormControl outside the trigger, so its id (the label's target) wins. */}
                        <FormControl>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              disabled={isSubmitting}
                              className={cn(
                                "w-full justify-start font-normal",
                                !field.value && "text-muted-foreground",
                              )}
                            >
                              <CalendarIcon className="size-4 text-muted-foreground" />
                              {field.value
                                ? formatDateMedium(field.value)
                                : t(
                                    "settings:apiKey.createDialog.customDatePlaceholder",
                                  )}
                            </Button>
                          </PopoverTrigger>
                        </FormControl>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            defaultMonth={field.value ?? customBounds.first}
                            startMonth={customBounds.first}
                            endMonth={customBounds.last}
                            disabled={[
                              { before: customBounds.first },
                              { after: customBounds.last },
                            ]}
                            onSelect={(date) => {
                              field.onChange(date);
                              if (date) setIsCalendarOpen(false);
                            }}
                            className="bg-popover"
                          />
                        </PopoverContent>
                      </Popover>
                      <FormDescription>
                        {t("settings:apiKey.createDialog.customDateRange")}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isSubmitting}
              >
                {t("common:actions.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? t("settings:apiKey.createDialog.creating")
                  : t("settings:apiKey.createDialog.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
