import { useTranslation } from "react-i18next";
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/menu";
import { useUserPreferencesStore } from "@/store/user-preferences";

const THEMES = ["light", "dark", "system"] as const;
type Theme = (typeof THEMES)[number];

const THEME_LABEL_KEYS: Record<Theme, string> = {
  light: "settings:preferencesPage.themeLight",
  dark: "settings:preferencesPage.themeDark",
  system: "settings:preferencesPage.themeSystem",
};

function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value);
}

/** Light / Dark / System, as radio items inside a menu (the avatar menu). */
export function ThemeToggleDropdown() {
  const { t } = useTranslation();
  const { theme, setTheme } = useUserPreferencesStore();

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>
        {t("settings:preferencesPage.theme")}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={theme}
        onValueChange={(value) => {
          if (isTheme(value)) setTheme(value);
        }}
      >
        {THEMES.map((value) => (
          <DropdownMenuRadioItem key={value} value={value}>
            {t(THEME_LABEL_KEYS[value])}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  );
}
