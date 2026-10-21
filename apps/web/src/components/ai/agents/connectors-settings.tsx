import { Pencil, PlugZap, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsGroup,
  SettingsGroupMessage,
  SettingsSection,
} from "@/components/settings-layout";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { AiConnector, AiConnectorTest } from "@/fetchers/ai/connectors";
import {
  useCreateAiConnector,
  useDeleteAiConnector,
  useTestAiConnector,
  useUpdateAiConnector,
} from "@/hooks/mutations/ai/use-connector-mutations";
import { useAiConnectors } from "@/hooks/queries/ai/use-connectors";
import { toast } from "@/lib/toast";

const DEFAULT_HEADER = "Authorization";

/** A connection test's outcome as one translated line. */
export function testSummary(
  t: (key: string, options?: Record<string, unknown>) => string,
  result: AiConnectorTest,
): string {
  if (result.ok) {
    const readOnly = result.tools.filter((tool) => tool.readOnly).length;
    return t("ai:agents.connectors.testOk", {
      count: result.tools.length,
      readOnly,
    });
  }
  return t(`ai:agents.connectors.errors.${result.error ?? "NETWORK"}`, {
    status: result.httpStatus ?? "",
  });
}

/**
 * Settings → Agents → Connectors: outside MCP servers that agents with web
 * access may call. Shared ones serve the whole workspace; personal ones
 * only runs for their owner.
 */
export function ConnectorsSection({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const connectors = useAiConnectors(workspaceId);
  const [editing, setEditing] = useState<AiConnector | "new" | null>(null);
  const [deleting, setDeleting] = useState<AiConnector | null>(null);
  const [results, setResults] = useState<Record<string, AiConnectorTest>>({});
  const test = useTestAiConnector();

  const runTest = async (connectorId: string) => {
    try {
      const result = await test.mutateAsync({ workspaceId, connectorId });
      setResults((current) => ({ ...current, [connectorId]: result }));
    } catch {
      toast.error(t("ai:agents.connectors.testError"));
    }
  };

  return (
    <SettingsSection
      title={t("ai:agents.connectors.title")}
      description={t("ai:agents.connectors.subtitle")}
      actions={
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          {t("ai:agents.connectors.create")}
        </Button>
      }
    >
      <SettingsGroup>
        {connectors.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (connectors.data ?? []).length === 0 ? (
          <SettingsGroupMessage>
            {t("ai:agents.connectors.empty")}
          </SettingsGroupMessage>
        ) : (
          <ul className="divide-y divide-border">
            {(connectors.data ?? []).map((connector) => (
              <ConnectorRow
                key={connector.id}
                workspaceId={workspaceId}
                connector={connector}
                result={results[connector.id] ?? null}
                testing={
                  test.isPending && test.variables?.connectorId === connector.id
                }
                onTest={() => void runTest(connector.id)}
                onEdit={() => setEditing(connector)}
                onDelete={() => setDeleting(connector)}
              />
            ))}
          </ul>
        )}
      </SettingsGroup>
      {editing && (
        <ConnectorDialog
          workspaceId={workspaceId}
          connector={editing === "new" ? null : editing}
          canManage={canManage}
          onClose={() => setEditing(null)}
          onSaved={(connectorId) => void runTest(connectorId)}
        />
      )}
      <DeleteConnectorDialog
        workspaceId={workspaceId}
        connector={deleting}
        onClose={() => setDeleting(null)}
      />
    </SettingsSection>
  );
}

function ConnectorRow({
  workspaceId,
  connector,
  result,
  testing,
  onTest,
  onEdit,
  onDelete,
}: {
  workspaceId: string;
  connector: AiConnector;
  result: AiConnectorTest | null;
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateAiConnector();
  const toggle = async (enabled: boolean) => {
    try {
      await update.mutateAsync({
        connectorId: connector.id,
        patch: { workspaceId, enabled },
      });
    } catch {
      toast.error(t("ai:agents.connectors.saveError"));
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <PlugZap className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate font-medium text-sm">{connector.name}</span>
          <Badge variant="outline" className="font-normal">
            {t(
              connector.shared
                ? "ai:agents.connectors.shared"
                : "ai:agents.connectors.personal",
            )}
          </Badge>
          {!connector.enabled && (
            <Badge variant="outline" className="text-muted-foreground">
              {t("ai:agents.off")}
            </Badge>
          )}
        </p>
        {(connector.url || connector.hasSecret) && (
          <p className="truncate text-muted-foreground text-xs">
            {[
              connector.url,
              connector.hasSecret
                ? t("ai:agents.connectors.secretHint", {
                    last4: connector.secretLast4 ?? "••••",
                  })
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        {result && (
          <p
            role="status"
            className={
              result.ok
                ? "text-muted-foreground text-xs"
                : "text-destructive-foreground text-xs"
            }
          >
            {testSummary(t, result)}
          </p>
        )}
      </div>
      {connector.canManage && (
        <div className="flex items-center gap-1">
          <Button
            size="xs"
            variant="outline"
            loading={testing}
            onClick={onTest}
          >
            {t("ai:agents.connectors.test")}
          </Button>
          <Switch
            checked={connector.enabled}
            disabled={update.isPending}
            onCheckedChange={(next) => void toggle(next)}
            aria-label={t(
              connector.enabled
                ? "ai:agents.connectors.disable"
                : "ai:agents.connectors.enable",
            )}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("ai:agents.connectors.edit")}
            onClick={onEdit}
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("ai:agents.connectors.delete")}
            onClick={onDelete}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      )}
    </li>
  );
}

function ConnectorDialog({
  workspaceId,
  connector,
  canManage,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  connector: AiConnector | null;
  canManage: boolean;
  onClose: () => void;
  onSaved: (connectorId: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const create = useCreateAiConnector();
  const update = useUpdateAiConnector();
  const [name, setName] = useState(connector?.name ?? "");
  const [url, setUrl] = useState(connector?.url ?? "");
  const [authType, setAuthType] = useState<"none" | "header">(
    connector?.authType ?? "header",
  );
  const [headerName, setHeaderName] = useState(
    connector?.headerName ?? DEFAULT_HEADER,
  );
  const [secret, setSecret] = useState("");
  const [shared, setShared] = useState(connector?.shared ?? canManage);
  const pending = create.isPending || update.isPending;
  const urlValid = /^https?:\/\/\S+$/i.test(url.trim());

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !urlValid) return;
    const header = authType === "header";
    try {
      if (connector) {
        const saved = await update.mutateAsync({
          connectorId: connector.id,
          patch: {
            workspaceId,
            name: name.trim(),
            url: url.trim(),
            authType,
            ...(header
              ? { headerName: headerName.trim() || DEFAULT_HEADER }
              : {}),
            // Empty keeps the stored secret.
            ...(header && secret ? { secret } : {}),
          },
        });
        toast.success(t("ai:agents.connectors.saved"));
        onSaved(saved.id);
      } else {
        const saved = await create.mutateAsync({
          workspaceId,
          name: name.trim(),
          url: url.trim(),
          authType,
          shared,
          ...(header
            ? { headerName: headerName.trim() || DEFAULT_HEADER }
            : {}),
          ...(header && secret ? { secret } : {}),
        });
        toast.success(t("ai:agents.connectors.created"));
        onSaved(saved.id);
      }
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message && error.message.length < 300
          ? error.message
          : t("ai:agents.connectors.saveError"),
      );
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader className="border-border border-b px-6 py-5">
            <DialogTitle>
              {t(
                connector
                  ? "ai:agents.connectors.edit"
                  : "ai:agents.connectors.create",
              )}
            </DialogTitle>
            <DialogDescription>
              {t("ai:agents.connectors.dialogHint")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 px-6 py-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-name`}>
                {t("ai:agents.connectors.name")}
              </Label>
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={60}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-url`}>
                {t("ai:agents.connectors.url")}
              </Label>
              <Input
                id={`${id}-url`}
                type="url"
                inputMode="url"
                value={url}
                maxLength={2000}
                required
                placeholder="https://"
                aria-invalid={(url.length > 0 && !urlValid) || undefined}
                aria-describedby={`${id}-url-hint`}
                onChange={(event) => setUrl(event.target.value)}
              />
              <p
                id={`${id}-url-hint`}
                className="text-muted-foreground text-xs"
              >
                {t("ai:agents.connectors.urlHint")}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-auth`}>
                  {t("ai:agents.connectors.auth")}
                </Label>
                <Select
                  value={authType}
                  onValueChange={(value) =>
                    value && setAuthType(value === "none" ? "none" : "header")
                  }
                >
                  <SelectTrigger id={`${id}-auth`}>
                    <SelectValue>
                      {t(
                        authType === "none"
                          ? "ai:agents.connectors.authNone"
                          : "ai:agents.connectors.authHeader",
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="header">
                      {t("ai:agents.connectors.authHeader")}
                    </SelectItem>
                    <SelectItem value="none">
                      {t("ai:agents.connectors.authNone")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {authType === "header" && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-header`}>
                    {t("ai:agents.connectors.headerName")}
                  </Label>
                  <Input
                    id={`${id}-header`}
                    value={headerName}
                    maxLength={64}
                    onChange={(event) => setHeaderName(event.target.value)}
                  />
                </div>
              )}
            </div>
            {authType === "header" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-secret`}>
                  {t("ai:agents.connectors.secret")}
                </Label>
                <Input
                  id={`${id}-secret`}
                  type="password"
                  autoComplete="off"
                  value={secret}
                  maxLength={4000}
                  placeholder={
                    connector?.hasSecret
                      ? t("ai:agents.connectors.secretKeep")
                      : "Bearer …"
                  }
                  onChange={(event) => setSecret(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  {t("ai:agents.connectors.secretHelp")}
                </p>
              </div>
            )}
            {!connector && canManage && (
              <div className="flex items-start gap-2">
                <Switch
                  id={`${id}-shared`}
                  checked={shared}
                  onCheckedChange={setShared}
                />
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor={`${id}-shared`}>
                    {t("ai:agents.connectors.sharedToggle")}
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    {t("ai:agents.connectors.sharedHint")}
                  </p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 border-border border-t px-6 py-4 sm:gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("ai:agents.cancel")}
            </Button>
            <Button
              type="submit"
              loading={pending}
              disabled={!name.trim() || !urlValid}
            >
              {t("ai:agents.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteConnectorDialog({
  workspaceId,
  connector,
  onClose,
}: {
  workspaceId: string;
  connector: AiConnector | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const remove = useDeleteAiConnector();
  const confirm = async () => {
    if (!connector) return;
    try {
      await remove.mutateAsync({ workspaceId, connectorId: connector.id });
      toast.success(t("ai:agents.connectors.deleted"));
      onClose();
    } catch {
      toast.error(t("ai:agents.connectors.saveError"));
    }
  };
  return (
    <AlertDialog
      open={Boolean(connector)}
      onOpenChange={(open) => !open && onClose()}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("ai:agents.connectors.deleteTitle", {
              name: connector?.name ?? "",
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("ai:agents.connectors.deleteBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            {t("ai:agents.cancel")}
          </AlertDialogClose>
          <Button
            variant="destructive"
            loading={remove.isPending}
            onClick={() => void confirm()}
          >
            {t("ai:agents.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
