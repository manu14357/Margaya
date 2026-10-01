import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fromEstimateInput,
  type Translate,
  toEstimateInput,
} from "@/lib/estimate/format";
import { estimateErrorKey } from "@/lib/estimate/messages";
import {
  canonicalizeEstimateValue,
  type EstimateType,
  isNumericEstimateType,
  MIN_ESTIMATE_POINTS,
  validateEstimateValue,
} from "@/lib/estimate/values";
import EstimateAddPointRow from "./estimate-add-point-row";
import EstimatePointRow from "./estimate-point-row";
import { useDragOrder } from "./use-drag-order";

/** A value being drafted in the create dialog, as typed. */
export type LocalPointRow = { id: string; text: string };

let rowSequence = 0;

export function newLocalRow(text: string): LocalPointRow {
  rowSequence += 1;
  return { id: `row-${rowSequence}`, text };
}

/**
 * Tidies the draft after an edit: valid values take their canonical form
 * ("2.50" becomes 2.5, 90 minutes becomes 1h 30m) and numeric systems sort
 * themselves once every value is valid.
 */
export function tidyLocalRows(
  type: EstimateType,
  rows: readonly LocalPointRow[],
  t: Translate,
): LocalPointRow[] {
  const parsed = rows.map((row) => ({
    row,
    result: canonicalizeEstimateValue(
      type,
      fromEstimateInput(type, row.text, t),
    ),
  }));
  const tidy = parsed.map(({ row, result }) =>
    result.ok
      ? { ...row, text: toEstimateInput(type, result.point.value, t) }
      : row,
  );
  if (!isNumericEstimateType(type) || parsed.some(({ result }) => !result.ok)) {
    return tidy;
  }
  const numberOf = (index: number) => {
    const result = parsed[index]?.result;
    return result?.ok ? (result.point.numericValue ?? 0) : 0;
  };
  return tidy
    .map((row, index) => ({ row, value: numberOf(index) }))
    .sort((a, b) => a.value - b.value)
    .map(({ row }) => row);
}

type LocalPointListProps = {
  type: EstimateType;
  rows: LocalPointRow[];
  onRowsChange: (rows: LocalPointRow[]) => void;
  /** Messages for rows that break a rule, by row index. */
  rowErrors: ReadonlyMap<number, string>;
  disabled?: boolean;
};

/**
 * The values of a system being created: the settings list's rows, editing
 * an array in memory instead of calling the API.
 */
export default function LocalPointList({
  type,
  rows,
  onRowsChange,
  rowErrors,
  disabled = false,
}: LocalPointListProps) {
  const { t } = useTranslation();
  const [newValue, setNewValue] = useState("");
  const [newError, setNewError] = useState<string | null>(null);

  const rowById = new Map(rows.map((row) => [row.id, row]));
  const drag = useDragOrder(
    rows.map((row) => row.id),
    (ids) =>
      onRowsChange(
        ids.flatMap((id) => {
          const row = rowById.get(id);
          return row ? [row] : [];
        }),
      ),
  );

  const addRow = () => {
    const raw = fromEstimateInput(type, newValue, t);
    const others = rows.flatMap((row) => {
      const result = canonicalizeEstimateValue(
        type,
        fromEstimateInput(type, row.text, t),
      );
      return result.ok ? [result.point] : [];
    });
    const result = validateEstimateValue(type, raw, others);
    if (!result.ok) {
      setNewError(t(estimateErrorKey(type, result.code)));
      return;
    }
    setNewError(null);
    setNewValue("");
    onRowsChange(
      tidyLocalRows(
        type,
        [...rows, newLocalRow(toEstimateInput(type, result.point.value, t))],
        t,
      ),
    );
  };

  const canDelete = rows.length > MIN_ESTIMATE_POINTS;

  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {drag.order.map((rowId) => {
          const index = rows.findIndex((row) => row.id === rowId);
          const row = rows[index];
          if (!row) return null;
          return (
            <EstimatePointRow
              key={row.id}
              value={row.text}
              onChange={(text) =>
                onRowsChange(
                  rows.map((candidate) =>
                    candidate.id === row.id
                      ? { ...candidate, text }
                      : candidate,
                  ),
                )
              }
              onCommit={() => onRowsChange(tidyLocalRows(type, rows, t))}
              label={row.text}
              error={rowErrors.get(index) ?? null}
              canEdit={!disabled}
              canDelete={canDelete}
              onDelete={() =>
                onRowsChange(
                  rows.filter((candidate) => candidate.id !== row.id),
                )
              }
              drag={
                type === "categories"
                  ? {
                      isDragging: drag.draggedId === row.id,
                      onDragStart: (event) => drag.start(event, row.id),
                      onDragOver: (event) => drag.over(event, row.id),
                      onDrop: drag.drop,
                      onDragEnd: drag.end,
                    }
                  : null
              }
            />
          );
        })}
      </ul>
      {!disabled && (
        <EstimateAddPointRow
          type={type}
          value={newValue}
          onChange={(text) => {
            setNewValue(text);
            if (newError) setNewError(null);
          }}
          onAdd={addRow}
          error={newError}
          count={rows.length}
        />
      )}
    </div>
  );
}
