import type { TFunction } from "i18next";
import {
  Code2,
  FileText,
  Globe,
  type LucideIcon,
  Mail,
  MonitorSmartphone,
} from "lucide-react";
import type { IntakeSource } from "@/types/intake";

const ICONS: Record<IntakeSource, LucideIcon> = {
  in_app: MonitorSmartphone,
  api: Code2,
  public_board: Globe,
  email: Mail,
  form: FileText,
};

/** The label of a request's source, from static keys. */
export function intakeSourceLabel(t: TFunction, source: IntakeSource): string {
  switch (source) {
    case "api":
      return t("intake:source.api");
    case "public_board":
      return t("intake:source.public_board");
    case "email":
      return t("intake:source.email");
    case "form":
      return t("intake:source.form");
    default:
      return t("intake:source.in_app");
  }
}

/** The icon of a request's source; decorative, the label carries it. */
export default function IntakeSourceIcon({
  source,
  className,
}: {
  source: IntakeSource;
  className?: string;
}) {
  const Icon = ICONS[source] ?? MonitorSmartphone;
  return <Icon aria-hidden="true" className={className} />;
}
