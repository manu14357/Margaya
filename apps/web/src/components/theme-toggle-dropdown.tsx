import { useTranslation } from "react-i18next";
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/menu";
import { THEME_LABEL_KEYS } from "@/constants/themes";
import {
  isTheme,
  THEMES,
  useUserPreferencesStore,
} from "@/store/user-preferences";

/** The theme choices, as radio items inside a menu (the avatar menu). */
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
