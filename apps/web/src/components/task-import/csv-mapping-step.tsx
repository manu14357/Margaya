import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
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
import type { ColumnMapping, ImportField } from "@/lib/task-import/csv-mapping";
import { FIELD_LABEL_KEYS } from "./field-labels";

const DONT_IMPORT = "none";

type CsvMappingStepProps = {
  fields: readonly ImportField[];
  /** Display names of the CSV columns, in order. */
  columns: readonly string[];
  mapping: ColumnMapping;
  onChange: (field: ImportField, column: number | null) => void;
  /** The first data row, for the sample values. */
  sampleRow: readonly string[];
};

/** Step 2: one row per Margaya field with the CSV column it reads. */
export function CsvMappingStep({
  fields,
  columns,
  mapping,
  onChange,
  sampleRow,
}: CsvMappingStepProps) {
  const { t } = useTranslation();
  const dontImport = t("settings:tasksImportExport.csv.dontImport");

  return (
    <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              {t("settings:tasksImportExport.csv.mapField")}
            </TableHead>
            <TableHead>
              {t("settings:tasksImportExport.csv.mapColumn")}
            </TableHead>
            <TableHead>
              {t("settings:tasksImportExport.csv.mapSample")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map((field) => {
            const column = mapping[field];
            const label = t(FIELD_LABEL_KEYS[field]);
            const sample = column === null ? "" : (sampleRow[column] ?? "");
            return (
              <TableRow key={field}>
                <TableCell className="font-medium">
                  <span className="inline-flex items-center gap-2">
                    {label}
                    {field === "title" && (
                      <Badge variant="outline">
                        {t("settings:tasksImportExport.csv.required")}
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  <Select
                    value={column === null ? DONT_IMPORT : String(column)}
                    onValueChange={(value) =>
                      onChange(
                        field,
                        value === DONT_IMPORT || value === null
                          ? null
                          : Number(value),
                      )
                    }
                  >
                    <SelectTrigger className="w-48" aria-label={label}>
                      <SelectValue>
                        {column === null
                          ? dontImport
                          : (columns[column] ?? dontImport)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DONT_IMPORT}>{dontImport}</SelectItem>
                      {columns.map((name, index) => (
                        <SelectItem
                          // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                          key={index}
                          value={String(index)}
                        >
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="max-w-48 truncate text-muted-foreground">
                  {sample}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default CsvMappingStep;
