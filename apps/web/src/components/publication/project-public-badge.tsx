import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePublication } from "@/hooks/queries/publication/use-publication";
import { publicBoardUrl } from "@/lib/publication/settings";

/**
 * "Public" next to the project crumb while the board is published; it opens
 * the board in a new tab. The publication is fetched only for projects
 * whose isPublic mirror says they are published.
 */
export default function ProjectPublicBadge({
  projectId,
  isPublic,
}: {
  projectId: string;
  isPublic: boolean;
}) {
  const { t } = useTranslation();
  const { data: publication } = usePublication(
    isPublic ? projectId : undefined,
  );
  if (!isPublic || !publication?.published || !publication.path) return null;
  const url = publicBoardUrl(publication.path, window.location.origin);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Badge
              variant="outline"
              size="sm"
              className="gap-1"
              render={
                <a href={url} target="_blank" rel="noopener noreferrer" />
              }
            />
          }
        >
          <Globe className="size-3" />
          {t("navigation:project.publicBadge")}
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">
            {t("navigation:project.publicBadgeTooltip")}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
