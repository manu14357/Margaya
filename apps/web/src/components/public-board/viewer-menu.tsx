import { Link, useLocation } from "@tanstack/react-router";
import { Inbox, LogIn, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { usePublicBoardSession } from "@/hooks/mutations/public-board/use-public-board-session";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";
import type { PublicBoard } from "@/types/public-board";

type ViewerMenuProps = {
  token: string;
  board: PublicBoard;
  onOpenMyRequests: () => void;
};

/** "Sign in" for visitors; an avatar menu for guests and accounts. */
export default function ViewerMenu({
  token,
  board,
  onOpenMyRequests,
}: ViewerMenuProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const { signOut } = usePublicBoardSession(token);
  const { viewer } = board;

  if (viewer.kind === "visitor") {
    // Submit a request is the top bar's primary action when it is shown.
    const requestShown = board.board.requests && board.participation;
    return (
      <Button
        size="sm"
        variant={requestShown ? "outline" : "default"}
        className="h-8"
        render={
          <Link to="/auth/sign-in" search={{ redirect: location.href }} />
        }
      >
        <LogIn className="size-3.5" />
        <span className="text-xs">{t("publicProject:viewer.signIn")}</span>
      </Button>
    );
  }

  const name = viewer.name ?? "";
  const showRequests =
    viewer.kind === "account" && board.board.requests && board.participation;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-full p-0"
            aria-label={t("publicProject:viewer.menu")}
          />
        }
      >
        <Avatar className="size-8">
          <AvatarImage src={viewer.image ?? ""} alt="" />
          <AvatarFallback className="text-xs">
            {getInitials(name)}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="truncate text-sm font-medium">{name}</span>
          {viewer.kind === "guest" && (
            <Badge variant="outline" size="sm">
              {t("publicProject:viewer.guestBadge")}
            </Badge>
          )}
        </div>
        <DropdownMenuSeparator />
        {showRequests && (
          <DropdownMenuItem onClick={onOpenMyRequests}>
            <Inbox />
            {t("publicProject:viewer.myRequests")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() =>
            signOut.mutate(undefined, {
              onSuccess: () =>
                toast.success(t("publicProject:viewer.signedOut")),
              onError: (error) => toast.error(error.message),
            })
          }
        >
          <LogOut />
          {t("publicProject:viewer.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
