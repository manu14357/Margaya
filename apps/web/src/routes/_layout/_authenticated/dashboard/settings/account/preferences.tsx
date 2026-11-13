import {
  type AppLocale,
  defaultLocale,
  supportedLocales,
} from "@i18n/resources";
import { createFileRoute } from "@tanstack/react-router";
import { PanelsLeftRight, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import CalendarFeedSettings from "@/components/calendar-feed/calendar-feed-settings";
import { useCustomizeSidebarDialog } from "@/components/common/customize-sidebar-dialog";
import { YourFeedbackSection } from "@/components/feedback/your-feedback-section";
import AccountTimezoneSetting from "@/components/settings/account-timezone-setting";
import {
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/components/settings-layout";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { THEME_LABEL_KEYS } from "@/constants/themes";
import { useLocale } from "@/hooks/use-locale";
import {
  isTheme,
  isWeekStartDay,
  THEMES,
  useUserPreferencesStore,
  WEEK_START_DAYS,
  type WeekStartDay,
} from "@/store/user-preferences";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account/preferences",
)({
  component: RouteComponent,
});

function getLocaleLabel(locale: AppLocale) {
  try {
    const localeObj = new Intl.Locale(locale);
    const languageDisplayNames = new Intl.DisplayNames([locale], {
      type: "language",
    });
    return languageDisplayNames.of(localeObj.language) ?? locale;
  } catch {
    return locale;
  }
}

function RouteComponent() {
  const { t } = useTranslation();
  const openCustomizeSidebar = useCustomizeSidebarDialog(
    (state) => state.setOpen,
  );
  const { locale, setLocale } = useLocale();
  const {
    theme,
    setTheme,
    weekStartsOn,
    setWeekStartsOn,
    viewMode,
    setViewMode,
    showTaskNumbers,
    setShowTaskNumbers,
    showAssignees,
    setShowAssignees,
    showDueDates,
    setShowDueDates,
    showLabels,
    setShowLabels,
    showPriority,
    setShowPriority,
    showEstimates,
    setShowEstimates,
    resetDisplayPreferences,
    sidebarDefaultOpen,
    setSidebarDefaultOpen,
  } = useUserPreferencesStore();

  const viewLabels: Record<string, string> = {
    board: t("settings:preferencesPage.board"),
    list: t("settings:preferencesPage.list"),
  };
  const weekStartLabels: Record<WeekStartDay, string> = {
    0: t("settings:preferencesPage.weekStartsOnSunday"),
    1: t("settings:preferencesPage.weekStartsOnMonday"),
    6: t("settings:preferencesPage.weekStartsOnSaturday"),
  };

  const selectedLocale: AppLocale = locale ?? defaultLocale;

  return (
    <SettingsPage
      title={t("settings:preferencesPage.title")}
      description={t("settings:preferencesPage.subtitle")}
    >
      <SettingsSection
        title={t("settings:preferencesPage.appearanceTitle")}
        description={t("settings:preferencesPage.appearanceSubtitle")}
      >
        <SettingsGroup>
          <SettingsRow
            label={t("settings:preferencesPage.theme")}
            description={t("settings:preferencesPage.themeDescription")}
          >
            <Select
              value={theme}
              onValueChange={(value) => {
                if (isTheme(value)) setTheme(value);
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-44"
                aria-label={t("settings:preferencesPage.theme")}
              >
                <SelectValue
                  placeholder={t("settings:preferencesPage.selectTheme")}
                >
                  {t(THEME_LABEL_KEYS[theme])}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {THEMES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(THEME_LABEL_KEYS[value])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>

          <SettingsRow
            label={t("settings:preferencesPage.language")}
            description={t("settings:preferencesPage.languageDescription")}
          >
            <Select
              value={selectedLocale}
              onValueChange={(value) => {
                if (value) {
                  void setLocale(value as AppLocale);
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-44"
                aria-label={t("settings:preferencesPage.language")}
              >
                <SelectValue
                  placeholder={t("settings:preferencesPage.selectLanguage")}
                >
                  {getLocaleLabel(selectedLocale)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {supportedLocales.map((supportedLocale) => (
                  <SelectItem key={supportedLocale} value={supportedLocale}>
                    {getLocaleLabel(supportedLocale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>

          <AccountTimezoneSetting />

          <SettingsRow
            label={t("settings:preferencesPage.firstDayOfWeek")}
            description={t(
              "settings:preferencesPage.firstDayOfWeekDescription",
            )}
          >
            <Select
              value={String(weekStartsOn)}
              onValueChange={(value) => {
                if (!value) {
                  return;
                }

                const parsedWeekStart = Number(value);

                if (isWeekStartDay(parsedWeekStart)) {
                  setWeekStartsOn(parsedWeekStart);
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-44"
                aria-label={t("settings:preferencesPage.firstDayOfWeek")}
              >
                <SelectValue
                  placeholder={t(
                    "settings:preferencesPage.selectFirstDayOfWeek",
                  )}
                >
                  {weekStartLabels[weekStartsOn]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {WEEK_START_DAYS.map((day) => (
                  <SelectItem key={day} value={String(day)}>
                    {weekStartLabels[day]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>

          <SettingsRow
            label={t("settings:preferencesPage.defaultView")}
            description={t("settings:preferencesPage.defaultViewDescription")}
          >
            <Select
              value={viewMode}
              onValueChange={(value) => value && setViewMode(value)}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-44"
                aria-label={t("settings:preferencesPage.defaultView")}
              >
                <SelectValue
                  placeholder={t("settings:preferencesPage.selectViewMode")}
                >
                  {viewLabels[viewMode]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="board">
                  {t("settings:preferencesPage.board")}
                </SelectItem>
                <SelectItem value="list">
                  {t("settings:preferencesPage.list")}
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>

          <SettingsRow
            label={t("settings:preferencesPage.sidebarDefault")}
            description={t(
              "settings:preferencesPage.sidebarDefaultDescription",
            )}
            htmlFor="preference-sidebar-default"
          >
            <Switch
              id="preference-sidebar-default"
              checked={sidebarDefaultOpen}
              onCheckedChange={setSidebarDefaultOpen}
            />
          </SettingsRow>

          <SettingsRow
            label={t("navigation:customize.title")}
            description={t("navigation:customize.settingsDescription")}
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => openCustomizeSidebar(true)}
            >
              <PanelsLeftRight />
              {t("navigation:customize.open")}
            </Button>
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title={t("settings:preferencesPage.displayOptions")}
        description={t("settings:preferencesPage.displayOptionsDescription")}
        actions={
          <Button variant="ghost" size="xs" onClick={resetDisplayPreferences}>
            <RotateCcw />
            {t("common:actions.reset")}
          </Button>
        }
      >
        <SettingsGroup>
          <SettingsRow
            label={t("settings:preferencesPage.taskNumbers")}
            description={t("settings:preferencesPage.taskNumbersDescription")}
            htmlFor="preference-taskNumbers"
          >
            <Switch
              id="preference-taskNumbers"
              checked={showTaskNumbers}
              onCheckedChange={setShowTaskNumbers}
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings:preferencesPage.assignees")}
            description={t("settings:preferencesPage.assigneesDescription")}
            htmlFor="preference-assignees"
          >
            <Switch
              id="preference-assignees"
              checked={showAssignees}
              onCheckedChange={setShowAssignees}
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings:preferencesPage.dueDates")}
            description={t("settings:preferencesPage.dueDatesDescription")}
            htmlFor="preference-dueDates"
          >
            <Switch
              id="preference-dueDates"
              checked={showDueDates}
              onCheckedChange={setShowDueDates}
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings:preferencesPage.labels")}
            description={t("settings:preferencesPage.labelsDescription")}
            htmlFor="preference-labels"
          >
            <Switch
              id="preference-labels"
              checked={showLabels}
              onCheckedChange={setShowLabels}
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings:preferencesPage.priority")}
            description={t("settings:preferencesPage.priorityDescription")}
            htmlFor="preference-priority"
          >
            <Switch
              id="preference-priority"
              checked={showPriority}
              onCheckedChange={setShowPriority}
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings:preferencesPage.estimates")}
            description={t("settings:preferencesPage.estimatesDescription")}
            htmlFor="preference-estimates"
          >
            <Switch
              id="preference-estimates"
              checked={showEstimates}
              onCheckedChange={setShowEstimates}
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      <CalendarFeedSettings />

      <YourFeedbackSection />
    </SettingsPage>
  );
}
