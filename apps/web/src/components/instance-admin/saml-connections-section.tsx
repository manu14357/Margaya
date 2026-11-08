import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateSamlConnection,
  useDeleteSamlConnection,
  useUpdateSamlConnection,
} from "@/hooks/mutations/instance-admin/use-identity-connection-mutations";
import {
  useSamlConnectionDraft,
  useSamlConnections,
} from "@/hooks/queries/instance-admin/use-identity-connections";
import { formatDateMedium } from "@/lib/format";
import {
  areValidDomains,
  certificateStatus,
  isSafeSignOnUrl,
  parseDomains,
} from "@/lib/identity-connections";
import { toast } from "@/lib/toast";
import { ConnectionConfirmDialog } from "./connection-confirm-dialog";
import { CopyField } from "./copy-field";
import { InstanceLoadState, InstanceSection } from "./instance-page";

type Connection = NonNullable<
  ReturnType<typeof useSamlConnections>["data"]
>["items"][number];

/** "new" while adding; the connection while changing it. */
type Editing = "new" | Connection | null;

const failureMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

function CertificateExpiry({
  expiresAt,
}: {
  expiresAt: Connection["certificateExpiresAt"];
}) {
  const { t } = useTranslation();
  const status = certificateStatus(expiresAt);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground">
        {formatDateMedium(expiresAt)}
      </span>
      {status === "expired" ? (
        <Badge variant="error" size="sm">
          {t("instanceAdmin:identity.saml.certificateExpired")}
        </Badge>
      ) : status === "expiring" ? (
        <Badge variant="warning" size="sm">
          {t("instanceAdmin:identity.saml.certificateExpiring")}
        </Badge>
      ) : null}
    </span>
  );
}

/** Identity providers people can sign in through. */
export function SamlConnectionsSection() {
  const { t } = useTranslation();
  const connections = useSamlConnections();
  const remove = useDeleteSamlConnection();
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<Connection | null>(null);
  const items = connections.data?.items ?? [];

  const confirmRemove = async (connection: Connection) => {
    try {
      await remove.mutateAsync(connection.id);
      toast.success(
        t("instanceAdmin:identity.saml.removed", { name: connection.name }),
      );
    } catch (error) {
      toast.error(failureMessage(error, t("instanceAdmin:saveError")));
    }
  };

  return (
    <InstanceSection
      title={t("instanceAdmin:identity.saml.title")}
      description={t("instanceAdmin:identity.saml.description")}
      boxed={false}
      actions={
        <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
          {t("instanceAdmin:identity.saml.connect")}
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
          {t("instanceAdmin:identity.saml.none")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("instanceAdmin:identity.saml.columns.name")}
                </TableHead>
                <TableHead>
                  {t("instanceAdmin:identity.saml.columns.domains")}
                </TableHead>
                <TableHead>
                  {t("instanceAdmin:identity.saml.columns.certificate")}
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
                    {connection.domains.join(", ")}
                  </TableCell>
                  <TableCell>
                    <CertificateExpiry
                      expiresAt={connection.certificateExpiresAt}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => setEditing(connection)}
                      >
                        {t("instanceAdmin:identity.saml.edit")}
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
      )}

      <Sheet
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <SheetContent side="right" className="sm:max-w-lg">
          {editing ? (
            <ConnectionForm
              key={editing === "new" ? "new" : editing.id}
              connection={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <ConnectionConfirmDialog
        target={removing}
        title={(connection) =>
          t("instanceAdmin:identity.removeTitle", { name: connection.name })
        }
        description={t("instanceAdmin:identity.saml.removeDescription")}
        confirmLabel={t("instanceAdmin:identity.remove")}
        onConfirm={(connection) => void confirmRemove(connection)}
        onClose={() => setRemoving(null)}
      />
    </InstanceSection>
  );
}

function ConnectionForm({
  connection,
  onDone,
}: {
  connection: Connection | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const draft = useSamlConnectionDraft(connection === null);
  const create = useCreateSamlConnection();
  const update = useUpdateSamlConnection();
  const [name, setName] = useState(connection?.name ?? "");
  const [domainsText, setDomainsText] = useState(
    connection?.domains.join(", ") ?? "",
  );
  const [issuer, setIssuer] = useState(connection?.issuer ?? "");
  const [entryPoint, setEntryPoint] = useState(connection?.entryPoint ?? "");
  const [certificate, setCertificate] = useState("");

  const domains = parseDomains(domainsText);
  const domainsInvalid = domainsText.trim() !== "" && !areValidDomains(domains);
  const entryPointInvalid =
    entryPoint.trim() !== "" && !isSafeSignOnUrl(entryPoint);
  const acsUrl = connection?.acsUrl ?? draft.data?.acsUrl ?? "";
  const entityId = connection?.entityId ?? draft.data?.entityId ?? "";
  const valid =
    name.trim() !== "" &&
    areValidDomains(domains) &&
    issuer.trim() !== "" &&
    isSafeSignOnUrl(entryPoint) &&
    // A connection keeps its certificate unless a new one is pasted.
    (connection !== null || certificate.trim() !== "");

  const changes = () => {
    if (!connection) return {};
    const next = {
      name: name.trim(),
      domains,
      issuer: issuer.trim(),
      entryPoint: entryPoint.trim(),
    };
    return {
      ...(next.name !== connection.name ? { name: next.name } : {}),
      ...(next.domains.join() !== connection.domains.join()
        ? { domains: next.domains }
        : {}),
      ...(next.issuer !== connection.issuer ? { issuer: next.issuer } : {}),
      ...(next.entryPoint !== connection.entryPoint
        ? { entryPoint: next.entryPoint }
        : {}),
      ...(certificate.trim() ? { certificate: certificate.trim() } : {}),
    };
  };

  const submit = async () => {
    if (!valid) return;
    try {
      if (connection) {
        const patch = changes();
        if (Object.keys(patch).length > 0) {
          await update.mutateAsync({ id: connection.id, ...patch });
        }
        toast.success(t("instanceAdmin:identity.saml.saved"));
      } else {
        await create.mutateAsync({
          name: name.trim(),
          domains,
          issuer: issuer.trim(),
          entryPoint: entryPoint.trim(),
          certificate: certificate.trim(),
          ...(draft.data ? { key: draft.data.key } : {}),
        });
        toast.success(t("instanceAdmin:identity.saml.connected"));
      }
      onDone();
    } catch (error) {
      // An unusable certificate or a domain in use: the server explains.
      toast.error(failureMessage(error, t("instanceAdmin:saveError")));
    }
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {connection
            ? t("instanceAdmin:identity.saml.editTitle", {
                name: connection.name,
              })
            : t("instanceAdmin:identity.saml.connect")}
        </SheetTitle>
        <SheetDescription>
          {t("instanceAdmin:identity.saml.formDescription")}
        </SheetDescription>
      </SheetHeader>
      <SheetPanel>
        <form
          id="saml-connection"
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="saml-acs-url">
              {t("instanceAdmin:identity.saml.acsUrl")}
            </Label>
            <CopyField id="saml-acs-url" value={acsUrl} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="saml-entity-id">
              {t("instanceAdmin:identity.saml.entityId")}
            </Label>
            <CopyField id="saml-entity-id" value={entityId} />
            <p className="text-xs text-muted-foreground">
              {t("instanceAdmin:identity.saml.addressesHint")}
            </p>
          </div>

          <Separator />

          <div className="space-y-1.5">
            <Label htmlFor="saml-name">
              {t("instanceAdmin:identity.name")}
            </Label>
            <Input
              id="saml-name"
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
            <Label htmlFor="saml-domains">
              {t("instanceAdmin:identity.saml.domains")}
            </Label>
            <Input
              id="saml-domains"
              autoComplete="off"
              placeholder="example.com, example.org"
              value={domainsText}
              aria-invalid={domainsInvalid || undefined}
              onChange={(event) => setDomainsText(event.target.value)}
            />
            <p
              className={
                domainsInvalid
                  ? "text-xs text-destructive-foreground"
                  : "text-xs text-muted-foreground"
              }
            >
              {domainsInvalid
                ? t("instanceAdmin:identity.saml.domainsInvalid")
                : t("instanceAdmin:identity.saml.domainsHint")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="saml-issuer">
              {t("instanceAdmin:identity.saml.issuer")}
            </Label>
            <Input
              id="saml-issuer"
              autoComplete="off"
              maxLength={1024}
              value={issuer}
              onChange={(event) => setIssuer(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="saml-entry-point">
              {t("instanceAdmin:identity.saml.entryPoint")}
            </Label>
            <Input
              id="saml-entry-point"
              type="url"
              autoComplete="off"
              maxLength={2048}
              placeholder="https://"
              value={entryPoint}
              aria-invalid={entryPointInvalid || undefined}
              onChange={(event) => setEntryPoint(event.target.value)}
            />
            {entryPointInvalid ? (
              <p className="text-xs text-destructive-foreground">
                {t("instanceAdmin:identity.saml.entryPointInvalid")}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="saml-certificate">
              {t("instanceAdmin:identity.saml.certificate")}
            </Label>
            {connection ? (
              <p className="break-all text-xs text-muted-foreground">
                {t("instanceAdmin:identity.saml.currentCertificate", {
                  fingerprint: connection.certificateFingerprint,
                })}
              </p>
            ) : null}
            <Textarea
              id="saml-certificate"
              rows={6}
              spellCheck={false}
              autoComplete="off"
              className="font-mono text-xs"
              placeholder="-----BEGIN CERTIFICATE-----"
              value={certificate}
              onChange={(event) => setCertificate(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {connection
                ? t("instanceAdmin:identity.saml.certificateKeepHint")
                : t("instanceAdmin:identity.saml.certificateHint")}
            </p>
          </div>
        </form>
      </SheetPanel>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          type="submit"
          form="saml-connection"
          disabled={!valid}
          loading={create.isPending || update.isPending}
        >
          {connection
            ? t("instanceAdmin:save")
            : t("instanceAdmin:identity.saml.connectConfirm")}
        </Button>
      </SheetFooter>
    </>
  );
}
