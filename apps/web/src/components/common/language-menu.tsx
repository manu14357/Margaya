import { ChevronDown, Languages, Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { useGuestLocale } from "@/hooks/use-guest-locale";
import { useUserPreferencesStore } from "@/store/user-preferences";

const THEMES = ["light", "dark", "system"] as const;
type Theme = (typeof THEMES)[number];

function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value);
}

const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor } as const;
const THEME_LABEL_KEYS = {
  light: "settings:preferencesPage.themeLight",
  dark: "settings:preferencesPage.themeDark",
  system: "settings:preferencesPage.themeSystem",
} as const;

/** The signed-out language menu: every locale, by its own name. */
export function LanguageMenu({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { locale, locales, setLocale } = useGuestLocale();
  const current = locales.find((option) => option.code === locale);
  const name = current?.nativeName ?? locale;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={className}
            aria-label={t("common:preferences.languageCurrent", {
              language: name,
            })}
          />
        }
      >
        <Languages aria-hidden className="size-4" />
        <span lang={locale}>{name}</span>
        <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(value) => {
            if (typeof value === "string") void setLocale(value);
          }}
        >
          {locales.map((option) => (
            <DropdownMenuRadioItem
              key={option.code}
              value={option.code}
              lang={option.code}
              closeOnClick
            >
              {option.nativeName}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Light / Dark / System behind an icon button, for signed-out screens. */
export function ThemeMenu({ className }: { className?: string }) {
  const { t } = useTranslation();
  const theme = useUserPreferencesStore((state) => state.theme);
  const setTheme = useUserPreferencesStore((state) => state.setTheme);
  const Icon = THEME_ICONS[theme];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={className}
            aria-label={t("common:preferences.themeCurrent", {
              theme: t(THEME_LABEL_KEYS[theme]),
            })}
          />
        }
      >
        <Icon aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (isTheme(value)) setTheme(value);
          }}
        >
          {THEMES.map((option) => {
            const OptionIcon = THEME_ICONS[option];
            return (
              <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                <span className="flex items-center gap-2">
                  <OptionIcon aria-hidden className="size-4" />
                  {t(THEME_LABEL_KEYS[option])}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
