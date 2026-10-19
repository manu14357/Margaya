import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

const BUILT_IN_ROLE_KEYS = {
  owner: "team:roles.owner",
  admin: "team:roles.admin",
  member: "team:roles.member",
  viewer: "team:roles.viewer",
} as const;

/** A role's display name: translated for built-ins, as written for custom. */
export function useRoleLabel() {
  const { t } = useTranslation();
  return (role: string) =>
    role in BUILT_IN_ROLE_KEYS
      ? t(BUILT_IN_ROLE_KEYS[role as keyof typeof BUILT_IN_ROLE_KEYS])
      : role.charAt(0).toUpperCase() + role.slice(1);
}

type Props = {
  roles: string[];
  value: string | undefined;
  onChange: (role: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
  "aria-label"?: string;
  "aria-describedby"?: string;
};

/** Picks a role from `roles`, the ones the current user may grant. */
function InviteRoleSelect({
  roles,
  value,
  onChange,
  id,
  disabled,
  className,
  size = "default",
  ...aria
}: Props) {
  const roleLabel = useRoleLabel();
  return (
    <Select
      value={value ?? null}
      onValueChange={(next) => {
        if (typeof next === "string" && next) onChange(next);
      }}
      disabled={disabled || roles.length === 0}
    >
      <SelectTrigger id={id} size={size} className={className} {...aria}>
        <SelectValue>{value ? roleLabel(value) : null}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {roles.map((role) => (
          <SelectItem key={role} value={role}>
            {roleLabel(role)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default InviteRoleSelect;
