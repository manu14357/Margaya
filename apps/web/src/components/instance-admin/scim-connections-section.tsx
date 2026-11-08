import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useCreateScimConnection,
  useDeleteScimConnection,
  useRotateScimConnectionToken,
} from "@/hooks/mutations/instance-admin/use-identity-connection-mutations";
import { useScimConnections } from "@/hooks/queries/instance-admin/use-identity-connections";
import { useInstanceWorkspaces } from "@/hooks/queries/instance-admin/use-instance-admin";
import { formatNumber } from "@/lib/format";
import { toast } from "@/lib/toast";
import { ConnectionConfirmDialog } from "./connection-confirm-dialog";
import { CopyField } from "./copy-field";
import { InstanceLoadState, InstanceSection } from "./instance-page";
import { SearchField } from "./search-field";

type Connection = NonNullable<
  ReturnType<typeof useScimConnections>["data"]
>["items"][number];
type IssuedToken = { name: string; baseUrl: string; token: string };

const failureMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/** Identity providers allowed to add and remove people in a workspace. */
export function ScimConnectionsSection() {
  const { t } = useTranslation();
  const connections = useScimConnections();
  const rotate = useRotateScimConnectionToken();
  const remove = useDeleteScimConnection();
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [rotating, setRotating] = useState<Connection | null>(null);
  const [removing, setRemoving] = useState<Connection | null>(null);
  const items = connections.data?.items ?? [];

  const confirmRotate = async (connection: Connection) => {
    try {
      const result = await rotate.mutateAsync(connection.id);
      setIssued({
        name: result.connection.name,
        baseUrl: result.baseUrl,
        token: result.token,
      });
    } catch (error) {
      toast.error(failureMessage(error, t("instanceAdmin:saveError")));
    }
  };

  const confirmRemove = async (connection: Connection) => {
    try {
      await remove.mutateAsync(connection.id);
      toast.success(
        t("instanceAdmin:identity.scim.removed", { name: connection.name }),
      );
    } catch (error) {
      toast.error(failureMessage(error, t("instanceAdmin:saveError")));
    }
  };

  return (
    <InstanceSection
      title={t("instanceAdmin:identity.scim.title")}
      description={t("instanceAdmin:identity.scim.description")}
      boxed={false}
      actions={
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          {t("instanceAdmin:identity.scim.connect")}
        </Button>
      }
    >
      {!connections.data ? (
        <InstanceLoadState
          isLoading={connections.isLoading}
          isError={connections.isError}
          onRetry={() => void connections.refetch()}
          rows={2}
        />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("instanceAdmin:identity.scim.none")}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t("instanceAdmin:identity.scim.columns.name")}
                  </TableHead>
                  <TableHead>
                    {t("instanceAdmin:identity.scim.columns.workspace")}
                  </TableHead>
                  <TableHead>
                    {t("instanceAdmin:identity.scim.columns.people")}
                  </TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((connection) => (
                  <TableRow key={connection.id}>
                    <TableCell className="text-sm font-medium">
                      {connection.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {connection.workspaceName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatNumber(connection.provisionedUsers)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setRotating(connection)}
                        >
                          {t("instanceAdmin:identity.scim.rotate")}
                        </Button>
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setRemoving(connection)}
                        >
                          {t("instanceAdmin:identity.remove")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scim-base-url">
              {t("instanceAdmin:identity.scim.baseUrl")}
            </Label>
            <CopyField id="scim-base-url" value={connections.data.baseUrl} />
          </div>
        </div>
      )}

      <ConnectDialog
        open={adding}
        onOpenChange={setAdding}
        onIssued={setIssued}
      />
      <TokenDialog issued={issued} onClose={() => setIssued(null)} />

      <ConnectionConfirmDialog
        target={rotating}
        title={(connection) =>
          t("instanceAdmin:identity.scim.rotateTitle", {
            name: connection.name,
          })
        }
        description={t("instanceAdmin:identity.scim.rotateDescription")}
        confirmLabel={t("instanceAdmin:identity.scim.rotateConfirm")}
        onConfirm={(connection) => void confirmRotate(connection)}
        onClose={() => setRotating(null)}
      />

      <ConnectionConfirmDialog
        target={removing}
        title={(connection) =>
          t("instanceAdmin:identity.removeTitle", { name: connection.name })
        }
        description={t("instanceAdmin:identity.scim.removeDescription")}
        confirmLabel={t("instanceAdmin:identity.remove")}
        onConfirm={(connection) => void confirmRemove(connection)}
        onClose={() => setRemoving(null)}
      />
    </InstanceSection>
  );
}

function ConnectDialog({
  open,
  onOpenChange,
  onIssued,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIssued: (issued: IssuedToken) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <ConnectForm
            onCancel={() => onOpenChange(false)}
            onIssued={(issued) => {
              onOpenChange(false);
              onIssued(issued);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ConnectForm({
  onCancel,
  onIssued,
}: {
  onCancel: () => void;
  onIssued: (issued: IssuedToken) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [workspace, setWorkspace] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const workspaces = useInstanceWorkspaces(search);
  const { mutateAsync, isPending } = useCreateScimConnection();
  const options = workspaces.data?.pages.flatMap((page) => page.items) ?? [];
  // The search box only appears when one page can't show them all.
  const searchable = Boolean(search) || workspaces.hasNextPage;
  const valid = Boolean(name.trim() && workspace);

  const submit = async () => {
    if (!workspace || !valid) return;
    try {
      const result = await mutateAsync({
        name: name.trim(),
        workspaceId: workspace.id,
      });
      onIssued({
        name: result.connection.name,
        baseUrl: result.baseUrl,
        token: result.token,
      });
    } catch (error) {
      toast.error(failureMessage(error, t("instanceAdmin:saveError")));
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("instanceAdmin:identity.scim.connect")}</DialogTitle>
        <DialogDescription>
          {t("instanceAdmin:identity.scim.connectDescription")}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <form
          id="scim-connection"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="scim-connection-name">
              {t("instanceAdmin:identity.name")}
            </Label>
            <Input
              id="scim-connection-name"
              autoComplete="off"
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("instanceAdmin:identity.nameHint")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scim-connection-workspace">
              {t("instanceAdmin:identity.scim.workspace")}
            </Label>
            {searchable ? (
              <SearchField
                value={search}
                onChange={setSearch}
                placeholder={t("instanceAdmin:identity.scim.workspaceSearch")}
              />
            ) : null}
            <Select
              value={workspace?.id ?? null}
              onValueChange={(id) => {
                const chosen = options.find((option) => option.id === id);
                if (chosen) {
                  setWorkspace({ id: chosen.id, name: chosen.name });
                }
              }}
            >
              <SelectTrigger id="scim-connection-workspace" className="w-full">
                <SelectValue>
                  {workspace?.name ??
                    t("instanceAdmin:identity.scim.workspacePlaceholder")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("instanceAdmin:identity.scim.workspaceHint")}
            </p>
          </div>
        </form>
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          type="submit"
          form="scim-connection"
          disabled={!valid}
          loading={isPending}
        >
          {t("instanceAdmin:identity.scim.connectConfirm")}
        </Button>
      </DialogFooter>
    </>
  );
}

/** The one time a token can be seen: only its hash is stored. */
function TokenDialog({
  issued,
  onClose,
}: {
  issued: IssuedToken | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={issued !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("instanceAdmin:identity.scim.tokenTitle", {
              name: issued?.name ?? "",
            })}
          </DialogTitle>
          <DialogDescription>
            {t("instanceAdmin:identity.scim.tokenDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="scim-issued-base-url">
              {t("instanceAdmin:identity.scim.baseUrl")}
            </Label>
            <CopyField
              id="scim-issued-base-url"
              value={issued?.baseUrl ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scim-issued-token">
              {t("instanceAdmin:identity.scim.token")}
            </Label>
            <CopyField id="scim-issued-token" value={issued?.token ?? ""} />
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t("instanceAdmin:identity.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
