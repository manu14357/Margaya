import { type ReactNode, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { indexSettings, isSettingLocked } from "@/lib/instance-settings";
import type {
  InstanceSettingEntry,
  InstanceSettings,
} from "@/types/instance-admin";
import { SourceBadge } from "./source-badge";
import { useSaveInstanceSettings } from "./use-save-instance-settings";

type SettingRowProps = {
  id: string;
  label: string;
  hint?: string;
  entry?: InstanceSettingEntry;
  /** Extra line under the hint, for example "has no effect because…". */
  note?: ReactNode;
  children: ReactNode;
};

/** One setting: label, hint, where its value comes from, and the control. */
export function SettingRow({
  id,
  label,
  hint,
  entry,
  note,
  children,
}: SettingRowProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={id} className="text-sm font-medium">
            {label}
          </Label>
          {entry && <SourceBadge entry={entry} />}
        </div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {note && <p className="text-xs text-warning-foreground">{note}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

type SettingSwitchRowProps = {
  settings: InstanceSettings;
  settingKey: string;
  label: string;
  hint?: string;
  note?: ReactNode;
  /** The switch shows the opposite of the stored flag (invite-only). */
  inverted?: boolean;
};

/** A boolean setting that saves as soon as it is switched. */
export function SettingSwitchRow({
  settings,
  settingKey,
  label,
  hint,
  note,
  inverted = false,
}: SettingSwitchRowProps) {
  const entry = indexSettings(settings).get(settingKey);
  const { save } = useSaveInstanceSettings();
  const [pending, setPending] = useState<boolean | null>(null);
  const locked = isSettingLocked(settings, entry);
  const stored = entry?.value === true;
  const checked = (pending ?? stored) !== inverted;
  const id = `instance-setting-${settingKey.replace(/\./g, "-")}`;

  const handleChange = async (next: boolean) => {
    const value = next !== inverted;
    setPending(value);
    await save({ [settingKey]: value });
    setPending(null);
  };

  return (
    <SettingRow id={id} label={label} hint={hint} entry={entry} note={note}>
      <Switch
        id={id}
        checked={checked}
        disabled={locked || pending !== null || !entry}
        onCheckedChange={(next) => void handleChange(next)}
      />
    </SettingRow>
  );
}
