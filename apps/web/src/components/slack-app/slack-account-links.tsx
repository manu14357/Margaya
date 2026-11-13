import { Link2, Plug, Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  SettingsEmptyState,
  SettingsGroup,
  SettingsGroupMessage,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/components/settings-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useConfirmSlackLink,
  useDeleteSlackLink,
} from "@/hooks/mutations/slack-app/use-slack-app-mutations";
import useSlackLinkPreview from "@/hooks/queries/slack-app/use-slack-link-preview";
import useSlackLinks from "@/hooks/queries/slack-app/use-slack-links";
import { toast } from "@/lib/toast";

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Confirms a link prompt from Slack. Opening the link alone changes nothing:
 * the signed-in person reads who would act as them and confirms.
 */
function PendingLink({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = useTranslation();
  const preview = useSlackLinkPreview(token);
  const confirm = useConfirmSlackLink();

  if (preview.isLoading) return <Skeleton className="h-28 w-full" />;
  if (preview.isError || !preview.data) {
    return (
      <Alert variant="error">
        <Link2 />
        <AlertTitle>{t("settings:slackApp.link.invalidTitle")}</AlertTitle>
        <AlertDescription>
          {errorText(preview.error, t("settings:slackApp.link.invalid"))}
        </AlertDescription>
      </Alert>
    );
  }
  const data = preview.data;
  if (data.linkedToYou) {
    return (
      <Alert variant="success">
        <Link2 />
        <AlertTitle>{t("settings:slackApp.link.alreadyTitle")}</AlertTitle>
        <AlertDescription>
          {t("settings:slackApp.link.already", {
            workspace: data.workspaceName,
          })}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="info">
      <Link2 />
      <AlertTitle>{t("settings:slackApp.link.confirmTitle")}</AlertTitle>
      <AlertDescription>
        <p>
          {t("settings:slackApp.link.confirmBody", {
            slackUser: data.slackUserName ?? t("settings:slackApp.link.you"),
            team: data.teamName ?? t("settings:slackApp.unknownTeam"),
            workspace: data.workspaceName,
          })}
        </p>
        <p>{t("settings:slackApp.link.confirmWarning")}</p>
        {data.linkedToSomeoneElse && (
          <p>{t("settings:slackApp.link.movesLink")}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            type="button"
            loading={confirm.isPending}
            onClick={async () => {
              try {
                await confirm.mutateAsync(token);
                toast.success(t("settings:slackApp.link.linked"));
                onDone();
              } catch (error) {
                toast.error(
                  errorText(error, t("settings:slackApp.link.linkError")),
                );
              }
            }}
          >
            {t("settings:slackApp.link.confirm")}
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={onDone}>
            {t("settings:slackApp.link.cancel")}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function SlackAccountLinks({
  linkToken,
  onLinkHandled,
}: {
  linkToken?: string;
  onLinkHandled: () => void;
}) {
  const { t } = useTranslation();
  const links = useSlackLinks();
  const remove = useDeleteSlackLink();
  const title = t("settings:slackApp.accountTitle");

  return (
    <SettingsPage
      title={title}
      documentTitle={title}
      description={t("settings:slackApp.accountDescription")}
    >
      {linkToken && <PendingLink token={linkToken} onDone={onLinkHandled} />}
      <SettingsSection title={t("settings:slackApp.linkedTitle")}>
        {links.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : links.isError ? (
          <SettingsGroup>
            <SettingsGroupMessage tone="error">
              {t("settings:slackApp.linksLoadError")}
            </SettingsGroupMessage>
          </SettingsGroup>
        ) : (links.data ?? []).length === 0 ? (
          <SettingsEmptyState
            icon={<Plug />}
            title={t("settings:slackApp.noLinks")}
            description={t("settings:slackApp.noLinksHint")}
          />
        ) : (
          <SettingsGroup>
            {(links.data ?? []).map((link) => (
              <SettingsRow
                key={link.id}
                label={link.slackUserName ?? link.slackUserId}
                description={t("settings:slackApp.linkRow", {
                  team: link.teamName ?? link.slackTeamId,
                  workspace: link.workspaceName,
                })}
              >
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  loading={remove.isPending && remove.variables === link.id}
                  disabled={remove.isPending}
                  onClick={async () => {
                    try {
                      await remove.mutateAsync(link.id);
                      toast.success(t("settings:slackApp.toast.unlinked"));
                    } catch (error) {
                      toast.error(
                        errorText(
                          error,
                          t("settings:slackApp.toast.saveError"),
                        ),
                      );
                    }
                  }}
                >
                  <Unplug />
                  {t("settings:slackApp.unlink")}
                </Button>
              </SettingsRow>
            ))}
          </SettingsGroup>
        )}
      </SettingsSection>
    </SettingsPage>
  );
}
