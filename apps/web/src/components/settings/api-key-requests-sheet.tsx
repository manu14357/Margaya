import { useTranslation } from "react-i18next";
import useApiKeyRequests from "@/hooks/queries/use-api-key-requests";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import type { ApiKey } from "@/types/api-key";
import { Button } from "../ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetTitle,
} from "../ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

type ApiKeyRequestsSheetProps = {
  apiKey: ApiKey;
  onClose: () => void;
};

/** A key's recent requests: time, method, route template, status, duration. */
export function ApiKeyRequestsSheet({
  apiKey,
  onClose,
}: ApiKeyRequestsSheetProps) {
  const { t } = useTranslation();
  const query = useApiKeyRequests(apiKey.id);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            {t("accountSecurity:platform.apiKeys.requestsTitle", {
              name: apiKey.name || t("settings:apiKey.table.unnamedKey"),
            })}
          </SheetTitle>
          <SheetDescription>
            {t("accountSecurity:platform.apiKeys.requestsDescription")}
          </SheetDescription>
        </SheetHeader>
        <SheetPanel className="space-y-3">
          {query.isLoading ? (
            <p className="text-sm text-muted-foreground">
              {t("settings:apiKey.table.loading")}
            </p>
          ) : query.isError ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive-foreground">
                {t("accountSecurity:platform.apiKeys.requestsError")}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void query.refetch()}
              >
                {t("accountSecurity:platform.retry")}
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              {t("accountSecurity:platform.apiKeys.requestsEmpty")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t("accountSecurity:platform.apiKeys.columnTime")}
                    </TableHead>
                    <TableHead>
                      {t("accountSecurity:platform.apiKeys.columnRequest")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("accountSecurity:platform.apiKeys.columnStatus")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("accountSecurity:platform.apiKeys.columnDuration")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(new Date(item.createdAt))}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <span className="mr-2 font-semibold">
                          {item.method}
                        </span>
                        <span className="break-all">{item.route}</span>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono text-xs tabular-nums",
                          item.status >= 400 && "text-destructive-foreground",
                        )}
                      >
                        {item.status}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
                        {t("accountSecurity:platform.apiKeys.durationMs", {
                          value: item.durationMs,
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {query.hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t("accountSecurity:platform.loadMore")}
            </Button>
          )}
        </SheetPanel>
      </SheetContent>
    </Sheet>
  );
}
