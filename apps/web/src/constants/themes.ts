import { Contrast, type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
import type { Theme } from "@/store/user-preferences";

export const THEME_LABEL_KEYS: Record<Theme, string> = {
  light: "settings:preferencesPage.themeLight",
  dark: "settings:preferencesPage.themeDark",
  system: "settings:preferencesPage.themeSystem",
  "light-contrast": "settings:preferencesPage.themeLightContrast",
  "dark-contrast": "settings:preferencesPage.themeDarkContrast",
};

export const THEME_ICONS: Record<Theme, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
  "light-contrast": Contrast,
  "dark-contrast": Contrast,
};
