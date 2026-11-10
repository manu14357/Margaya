import { Menu, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RailBadge } from "@/components/app-rail";
import { useShell } from "@/components/common/shell-context";
import {
  DESTINATION_META,
  type ShellDestination,
} from "@/components/common/shell-destinations";
import { CreateMenu } from "@/components/common/shell-menus";
import { useInboxBadge } from "@/components/common/use-shell-badges";
import { useSidebar } from "@/components/ui/sidebar";

const tab =
  "relative flex min-h-11 cursor-pointer flex-col items-center justify-center gap-0.5 font-medium text-[11px] text-muted-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:text-foreground [&_svg]:size-5";

function DestinationTab({ id }: { id: ShellDestination }) {
  const { t } = useTranslation();
  const shell = useShell();
  const inbox = useInboxBadge();
  const meta = DESTINATION_META[id];
  const Icon = meta.icon;
  const active = shell?.destination === id;

  return (
    <button
      type="button"
      className={tab}
      aria-current={active ? "page" : undefined}
      onClick={() => shell?.selectDestination(id)}
    >
      <span
        className="relative"
        style={active ? { color: meta.color } : undefined}
      >
        <Icon strokeWidth={1.75} />
        {id === "inbox" && (
          <RailBadge
            count={inbox.count}
            label={inbox.label}
            className="ring-card"
          />
        )}
      </span>
      {t(meta.labelKey)}
    </button>
  );
}

/**
 * The bottom tab bar under 520px (`RAIL_BREAKPOINT`): Home, Your work, Create, Inbox and Menu
 * (the context-panel drawer, which also lists every destination).
 */
export default function MobileTabBar() {
  const { t } = useTranslation();
  const { openMobile, setOpenMobile } = useSidebar();

  return (
    <nav
      aria-label={t("navigation:shell.primary")}
      className="grid shrink-0 grid-cols-5 items-center border-t bg-card px-1.5 pb-[env(safe-area-inset-bottom)] min-[520px]:hidden"
      data-slot="mobile-tab-bar"
    >
      <DestinationTab id="home" />
      <DestinationTab id="my-work" />
      <div className="flex justify-center">
        <CreateMenu
          side="top"
          trigger={
            <button
              type="button"
              aria-label={t("navigation:shell.create")}
              className="relative flex size-9 cursor-pointer items-center justify-center rounded-[10px] bg-primary text-primary-foreground shadow-[0_1px_1px_--theme(--color-black/8%)] outline-hidden transition-[scale] duration-150 ease-out after:absolute after:-inset-1 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:active:scale-100"
            >
              <Plus className="size-4.5" strokeWidth={2.25} />
            </button>
          }
        />
      </div>
      <DestinationTab id="inbox" />
      <button
        type="button"
        className={tab}
        aria-expanded={openMobile}
        onClick={() => setOpenMobile(true)}
      >
        <Menu strokeWidth={1.75} />
        {t("navigation:shell.menu")}
      </button>
    </nav>
  );
}
