import type { ReactNode } from "react";

export type ResponsiveColumn = {
  key: string;
  label: string;
  /** A short qualifier set under the label, such as the source of a figure. */
  hint?: string;
  /** Numbers align right and use tabular figures. */
  numeric?: boolean;
};
export type ResponsiveRow = { key: string; cells: Record<string, ReactNode> };

/**
 * A data table that stays a real table on wide screens and stacks each row into a labelled card
 * on phones. The explicit ARIA roles keep table semantics when CSS changes the display type.
 */
export function ResponsiveTable({
  caption,
  columns,
  rows,
  className,
}: {
  caption?: ReactNode;
  columns: readonly ResponsiveColumn[];
  rows: readonly ResponsiveRow[];
  className?: string;
}) {
  return (
    <div className={className ? `v10-rtable ${className}` : "v10-rtable"}>
      <table role="table">
        {caption ? <caption>{caption}</caption> : null}
        <thead role="rowgroup">
          <tr role="row">
            {columns.map((column) => (
              <th key={column.key} role="columnheader" scope="col" className={column.numeric ? "is-num" : undefined}>
                {column.label}
                {column.hint ? <span className="v10-rtable__hint"> ({column.hint})</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <tr key={row.key} role="row">
              {columns.map((column, index) =>
                index === 0 ? (
                  <th key={column.key} role="rowheader" scope="row" data-label={column.label}>
                    {row.cells[column.key]}
                  </th>
                ) : (
                  <td key={column.key} role="cell" data-label={column.hint ? `${column.label} (${column.hint})` : column.label} className={column.numeric ? "is-num" : undefined}>
                    {row.cells[column.key]}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
