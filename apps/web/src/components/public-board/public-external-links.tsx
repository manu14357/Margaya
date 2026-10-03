import {
  ExternalLink as ExternalLinkIcon,
  GitBranch,
  GitMerge,
  GitPullRequest,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PublicTaskDetail } from "@/types/public-board";

type Link = PublicTaskDetail["externalLinks"][number];

const rowClassName =
  "group flex items-center justify-between rounded-md border border-border/50 bg-muted/50 p-3 transition-colors hover:bg-muted";

function LinkRow({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={rowClassName}
    >
      {children}
      <ExternalLinkIcon className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </a>
  );
}

/** Pull requests, issues and branches linked to a public task. */
export default function PublicExternalLinks({ links }: { links: Link[] }) {
  const { t } = useTranslation();
  if (links.length === 0) return null;

  const prStatus = (link: Link) => {
    const metadata = link.metadata ?? {};
    if (metadata.merged === true) {
      return {
        icon: <GitMerge className="size-3.5" />,
        label: t("publicProject:taskDetail.prStatusMerged"),
        className: "text-info-foreground",
      };
    }
    if (metadata.draft === true) {
      return {
        icon: <GitPullRequest className="size-3.5" />,
        label: t("publicProject:taskDetail.prStatusDraft"),
        className: "text-muted-foreground",
      };
    }
    return {
      icon: <GitPullRequest className="size-3.5" />,
      label: t("publicProject:taskDetail.prStatusOpen"),
      className: "text-success-foreground",
    };
  };

  return (
    <div className="space-y-2">
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {t("publicProject:taskDetail.externalLinks")}
      </h3>
      {links.map((link) => {
        if (link.resourceType === "pull_request") {
          const status = prStatus(link);
          const repo = link.url.match(/github\.com\/([^/]+\/[^/]+)\/pull/)?.[1];
          return (
            <LinkRow key={link.id} href={link.url}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium text-foreground text-sm">
                  {link.title || t("tasks:pr.label")}
                </span>
                <span className="text-muted-foreground text-xs">
                  {repo ? `${repo}#${link.externalId}` : `#${link.externalId}`}
                </span>
              </div>
              <span
                className={`flex shrink-0 items-center gap-1 font-medium text-xs ${status.className}`}
              >
                {status.icon}
                {status.label}
              </span>
            </LinkRow>
          );
        }
        if (link.resourceType === "issue") {
          return (
            <LinkRow key={link.id} href={link.url}>
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <GitPullRequest className="size-3.5 text-muted-foreground" />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium text-foreground text-sm">
                    {link.title || t("publicProject:taskDetail.issueFallback")}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    #{link.externalId}
                  </span>
                </div>
              </div>
            </LinkRow>
          );
        }
        if (link.resourceType === "branch") {
          return (
            <LinkRow key={link.id} href={link.url}>
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <GitBranch className="size-3.5 text-muted-foreground" />
                <span className="truncate font-medium text-foreground text-sm">
                  {link.title || link.externalId}
                </span>
              </div>
            </LinkRow>
          );
        }
        return null;
      })}
    </div>
  );
}
