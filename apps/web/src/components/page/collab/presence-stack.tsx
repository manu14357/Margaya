import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { collabColorValue } from "@/lib/pages/collab-colors";
import MemberAvatar from "../member-avatar";
import type { PresenceEntry } from "./collab-protocol";

export type PresenceMember = {
  name: string;
  image?: string | null;
};

type PresenceStackProps = {
  presence: PresenceEntry[];
  /** The signed-in user, left out of the stack. */
  currentUserId: string | undefined;
  getMember: (userId: string) => PresenceMember | null;
};

export const MAX_PRESENCE_AVATARS = 5;

/** Who else has the page open: up to five avatars, then "+N". */
export default function PresenceStack({
  presence,
  currentUserId,
  getMember,
}: PresenceStackProps) {
  const { t } = useTranslation();
  const people = presence.flatMap((entry) => {
    if (entry.userId === currentUserId) return [];
    const member = getMember(entry.userId);
    return member ? [{ ...entry, ...member }] : [];
  });
  if (people.length === 0) return null;

  const shown = people.slice(0, MAX_PRESENCE_AVATARS);
  const extra = people.length - shown.length;

  return (
    <TooltipProvider>
      <ul
        aria-label={t("pages:header.presence", {
          names: people.map((person) => person.name).join(", "),
        })}
        className="-space-x-1 flex items-center pe-1"
      >
        {shown.map((person) => (
          <li key={person.userId} className="inline-flex">
            <Tooltip>
              <TooltipTrigger
                render={<span className="inline-flex rounded-full" />}
              >
                <MemberAvatar
                  name={person.name}
                  image={person.image}
                  className="size-6 ring-2"
                  style={
                    {
                      "--tw-ring-color": collabColorValue(person.color),
                    } as React.CSSProperties
                  }
                />
              </TooltipTrigger>
              <TooltipContent>{person.name}</TooltipContent>
            </Tooltip>
          </li>
        ))}
        {extra > 0 && (
          <li className="z-10 inline-flex size-6 items-center justify-center rounded-full bg-muted font-medium text-[10px] text-muted-foreground ring-2 ring-background">
            {t("pages:header.presenceMore", { count: extra })}
          </li>
        )}
      </ul>
    </TooltipProvider>
  );
}
