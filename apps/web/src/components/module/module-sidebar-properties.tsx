import {
  CalendarDays,
  CalendarRange,
  ListTodo,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { UpdateModuleRequest } from "@/fetchers/module/update-module";
import { useUpdateModule } from "@/hooks/mutations/module/use-update-module";
import { cn } from "@/lib/cn";
import { formatModuleDate } from "@/lib/module/dates";
import { toast } from "@/lib/toast";
import type { ModuleDetail } from "@/types/module";
import ModuleDateField from "./module-date-field";
import ModuleLeadPicker from "./module-lead-picker";
import ModuleMembersPicker from "./module-members-picker";
import {
  PersonAvatar,
  resolvePeople,
  StackedAvatars,
  useWorkspacePeople,
} from "./module-people";

function PropertyRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof CalendarDays;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-7 items-center gap-2 text-sm">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="w-16 shrink-0 text-muted-foreground text-xs">
        {label}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/**
 * A ghost-button value that opens its picker, or plain text read-only. The
 * picker renders it as its trigger, so the button forwards every prop.
 */
function PropertyValue({
  canEdit,
  muted,
  children,
  className,
  ...props
}: ComponentProps<typeof Button> & { canEdit: boolean; muted?: boolean }) {
  const classes = cn(
    "flex h-7 w-full min-w-0 items-center gap-1.5 px-1.5 font-medium text-xs",
    muted && "text-muted-foreground",
    className,
  );
  if (!canEdit) return <span className={classes}>{children}</span>;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(classes, "justify-start")}
      {...props}
    >
      {children}
    </Button>
  );
}

type ModuleSidebarPropertiesProps = {
  module: ModuleDetail;
  workspaceId: string;
  canEdit: boolean;
};

/** Dates, lead, members and task count; each edit saves at once. */
export default function ModuleSidebarProperties({
  module,
  workspaceId,
  canEdit,
}: ModuleSidebarPropertiesProps) {
  const { t } = useTranslation();
  const { mutate: updateModule } = useUpdateModule();
  const people = useWorkspacePeople(workspaceId);
  // Members save on every toggle; the local copy keeps quick toggles from
  // working off a stale list while the previous save is still running.
  const [memberIds, setMemberIds] = useState(module.memberIds);
  useEffect(() => setMemberIds(module.memberIds), [module.memberIds]);

  const save = (json: UpdateModuleRequest, onError?: () => void) =>
    updateModule(
      { moduleId: module.id, projectId: module.projectId, json },
      {
        onError: (error) => {
          onError?.();
          toast.error(error.message || t("modules:toast.saveError"));
        },
      },
    );

  const [lead] = resolvePeople(module.leadId ? [module.leadId] : [], people, [
    ...(module.lead ? [module.lead] : []),
  ]);
  const members = resolvePeople(memberIds, people, module.members);

  return (
    <section className="space-y-1">
      <h3 className="pb-1 font-medium text-muted-foreground text-xs">
        {t("modules:sidebar.properties")}
      </h3>
      <PropertyRow icon={CalendarDays} label={t("modules:sidebar.startDate")}>
        <ModuleDateField
          value={module.startDate}
          max={module.targetDate}
          disabled={!canEdit}
          onChange={(startDate) => save({ startDate })}
        >
          <PropertyValue canEdit={canEdit} muted={!module.startDate}>
            {module.startDate
              ? formatModuleDate(module.startDate)
              : t("modules:form.noDate")}
          </PropertyValue>
        </ModuleDateField>
      </PropertyRow>
      <PropertyRow icon={CalendarRange} label={t("modules:sidebar.targetDate")}>
        <ModuleDateField
          value={module.targetDate}
          min={module.startDate}
          disabled={!canEdit}
          onChange={(targetDate) => save({ targetDate })}
        >
          <PropertyValue canEdit={canEdit} muted={!module.targetDate}>
            {module.targetDate
              ? formatModuleDate(module.targetDate)
              : t("modules:form.noDate")}
          </PropertyValue>
        </ModuleDateField>
      </PropertyRow>
      <PropertyRow icon={UserRound} label={t("modules:sidebar.lead")}>
        <ModuleLeadPicker
          workspaceId={workspaceId}
          value={module.leadId}
          fallback={module.lead}
          disabled={!canEdit}
          onChange={(leadId) => save({ leadId })}
        >
          <PropertyValue canEdit={canEdit} muted={!lead}>
            {lead && <PersonAvatar person={lead} className="size-4" />}
            <span className="truncate">
              {lead?.name ?? t("modules:row.noLead")}
            </span>
          </PropertyValue>
        </ModuleLeadPicker>
      </PropertyRow>
      <PropertyRow icon={UsersRound} label={t("modules:sidebar.members")}>
        <ModuleMembersPicker
          workspaceId={workspaceId}
          value={memberIds}
          known={module.members}
          disabled={!canEdit}
          onChange={(next) => {
            setMemberIds(next);
            save({ memberIds: next }, () => setMemberIds(module.memberIds));
          }}
        >
          <PropertyValue canEdit={canEdit} muted={members.length === 0}>
            {members.length > 0 ? (
              <StackedAvatars people={members} />
            ) : (
              t("modules:form.noMembers")
            )}
          </PropertyValue>
        </ModuleMembersPicker>
      </PropertyRow>
      <PropertyRow icon={ListTodo} label={t("modules:sidebar.tasks")}>
        <span className="px-1.5 font-medium text-xs">
          {t("modules:sidebar.totalTasks", { count: module.counts.total })}
        </span>
      </PropertyRow>
    </section>
  );
}
