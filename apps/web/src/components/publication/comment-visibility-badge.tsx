import { Globe, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";

export type CommentBadgeKind = "public" | "external" | "guest";

/** "Public" on public comments; "External" or "Guest" on outsiders' names. */
export default function CommentVisibilityBadge({
  kind,
}: {
  kind: CommentBadgeKind;
}) {
  const { t } = useTranslation();
  if (kind === "public") {
    return (
      <Badge variant="info" size="sm" className="gap-1">
        <Globe className="size-3" />
        {t("activity:commentVisibility.badgePublic")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" size="sm" className="gap-1">
      <UserRound className="size-3" />
      {kind === "guest"
        ? t("activity:commentVisibility.badgeGuest")
        : t("activity:commentVisibility.badgeExternal")}
    </Badge>
  );
}
