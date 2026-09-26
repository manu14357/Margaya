import { useTranslation } from "react-i18next";
import {
  PersonAvatar,
  resolvePeople,
  useWorkspacePeople,
} from "@/components/module/module-people";
import { Badge } from "@/components/ui/badge";

/** The project lead next to the project crumb; nothing when unset. */
export default function ProjectLeadBadge({
  workspaceId,
  leadUserId,
}: {
  workspaceId: string;
  leadUserId: string | null | undefined;
}) {
  const { t } = useTranslation();
  const people = useWorkspacePeople(workspaceId);
  const [lead] = resolvePeople(leadUserId ? [leadUserId] : [], people);
  if (!lead) return null;

  const label = t("settings:projectPeople.leadBadge", { name: lead.name });
  return (
    <Badge
      variant="outline"
      size="sm"
      className="max-w-40 gap-1"
      title={label}
      aria-label={label}
    >
      <PersonAvatar person={lead} className="size-3.5" />
      <span className="truncate">{lead.name}</span>
    </Badge>
  );
}
