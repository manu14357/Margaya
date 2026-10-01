import { ArrowRightLeft, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Spinner } from "@/components/ui/spinner";
import { EstimateRequestError } from "@/fetchers/estimate/estimate-error";
import { useUpdateEstimate } from "@/hooks/mutations/estimate/use-update-estimate";
import { ESTIMATE_TYPE_LABEL_KEYS } from "@/lib/estimate/messages";
import { MAX_ESTIMATE_NAME_LENGTH } from "@/lib/estimate/values";
import { toast } from "@/lib/toast";
import type { Estimate } from "@/types/estimate";
import RemotePointList from "./remote-point-list";

type EstimateSystemCardProps = {
  projectId: string;
  estimate: Estimate;
  /** The project's other systems, offered under "Switch system". */
  others: readonly Estimate[];
  canEdit: boolean;
  onNewSystem: () => void;
  onSwitchTo: (estimate: Estimate) => void;
  onDelete: (estimate: Estimate) => void;
};

/**
 * The active estimate system: its name (renamed inline), type and values,
 * in the column editor's bordered style.
 */
export default function EstimateSystemCard({
  projectId,
  estimate,
  others,
  canEdit,
  onNewSystem,
  onSwitchTo,
  onDelete,
}: EstimateSystemCardProps) {
  const { t } = useTranslation();
  const updateEstimate = useUpdateEstimate();
  const [name, setName] = useState(estimate.name);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    setName(estimate.name);
    setNameError(null);
  }, [estimate.name]);

  const saveName = async () => {
    const next = name.trim();
    if (next === estimate.name) {
      setName(estimate.name);
      setNameError(null);
      return;
    }
    if (next === "") {
      setNameError(t("settings:projectEstimates.validation.name_required"));
      return;
    }
    if (next.length > MAX_ESTIMATE_NAME_LENGTH) {
      setNameError(t("settings:projectEstimates.validation.name_too_long"));
      return;
    }
    if (
      others.some((other) => other.name.toLowerCase() === next.toLowerCase())
    ) {
      setNameError(t("settings:projectEstimates.validation.name_taken"));
      return;
    }
    setNameError(null);
    try {
      await updateEstimate.mutateAsync({
        projectId,
        estimateId: estimate.id,
        name: next,
      });
      toast.success(t("settings:projectEstimates.toast.renamed"));
    } catch (error) {
      if (error instanceof EstimateRequestError && error.status === 409) {
        setNameError(t("settings:projectEstimates.validation.name_taken"));
        return;
      }
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("settings:projectEstimates.toast.updateError"),
      );
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (nameError) setNameError(null);
            }}
            onBlur={() => void saveName()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            maxLength={MAX_ESTIMATE_NAME_LENGTH}
            disabled={!canEdit || updateEstimate.isPending}
            aria-label={t("settings:projectEstimates.name.label")}
            aria-invalid={nameError ? true : undefined}
            placeholder={t("settings:projectEstimates.name.placeholder")}
            className="h-8 flex-1 font-medium text-sm"
          />
          {updateEstimate.isPending && (
            <Spinner className="size-3.5 text-muted-foreground" />
          )}
          <Badge variant="secondary">
            {t(ESTIMATE_TYPE_LABEL_KEYS[estimate.type])}
          </Badge>
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("settings:projectEstimates.actions.menu")}
                  />
                }
              >
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={onNewSystem}>
                  <Plus />
                  {t("settings:projectEstimates.actions.newSystem")}
                </DropdownMenuItem>
                {others.length > 0 && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <ArrowRightLeft />
                      {t("settings:projectEstimates.actions.switch")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-56">
                      {others.map((other) => (
                        <DropdownMenuItem
                          key={other.id}
                          onClick={() => onSwitchTo(other)}
                        >
                          <span className="truncate">{other.name}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onDelete(estimate)}
                >
                  <Trash2 />
                  {t("settings:projectEstimates.actions.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {nameError && (
          <p className="px-1 text-destructive text-xs">{nameError}</p>
        )}
      </div>

      <RemotePointList
        projectId={projectId}
        estimate={estimate}
        canEdit={canEdit}
      />
    </div>
  );
}
