import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  InstancePage,
  InstanceSection,
} from "@/components/instance-admin/instance-page";
import { SearchField } from "@/components/instance-admin/search-field";
import { UsersTable } from "@/components/instance-admin/users-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InstanceUserStatus } from "@/types/instance-admin";

const searchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  status: z.enum(["all", "admins", "banned"]).optional().catch(undefined),
});

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/instance/users",
)({
  validateSearch: searchSchema,
  component: RouteComponent,
});

const STATUS_KEYS: Record<InstanceUserStatus, string> = {
  all: "accountSecurity:platform.users.filterAll",
  admins: "accountSecurity:platform.users.filterAdmins",
  banned: "accountSecurity:platform.users.filterBanned",
};

function RouteComponent() {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const q: string = search.q ?? "";
  const status: InstanceUserStatus = search.status ?? "all";
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <InstancePage
      title={t("accountSecurity:platform.users.title")}
      subtitle={t("accountSecurity:platform.users.subtitle")}
    >
      <InstanceSection
        title={t("accountSecurity:platform.users.listTitle")}
        boxed={false}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={status}
              onValueChange={(value) =>
                navigate({
                  search: {
                    q: q || undefined,
                    status:
                      value === "all"
                        ? undefined
                        : (value as InstanceUserStatus),
                  },
                  replace: true,
                })
              }
            >
              <SelectTrigger
                className="w-36"
                aria-label={t("accountSecurity:platform.users.filterLabel")}
              >
                <SelectValue>{t(STATUS_KEYS[status])}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_KEYS) as InstanceUserStatus[]).map(
                  (option) => (
                    <SelectItem key={option} value={option}>
                      {t(STATUS_KEYS[option])}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <SearchField
              value={q}
              placeholder={t("accountSecurity:platform.users.search")}
              onChange={(next) =>
                navigate({
                  search: {
                    q: next.trim() || undefined,
                    status: status === "all" ? undefined : status,
                  },
                  replace: true,
                })
              }
            />
          </div>
        }
      >
        <UsersTable q={q} status={status} />
      </InstanceSection>
    </InstancePage>
  );
}
