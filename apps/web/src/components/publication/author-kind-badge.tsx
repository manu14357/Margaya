import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { PublicAuthorKind } from "@/types/publication";

const KEYS: Record<PublicAuthorKind, string> = {
  member: "settings:projectPublish.moderation.kind.member",
  external: "settings:projectPublish.moderation.kind.external",
  guest: "settings:projectPublish.moderation.kind.guest",
};

/** Member, External or Guest next to a public comment's author. */
export default function AuthorKindBadge({ kind }: { kind: PublicAuthorKind }) {
  const { t } = useTranslation();
  return (
    <Badge variant={kind === "member" ? "secondary" : "outline"} size="sm">
      {t(KEYS[kind])}
    </Badge>
  );
}
