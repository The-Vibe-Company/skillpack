import type { UseCasesBlock } from "@/lib/blogBlocks";
import { BlockMarkdown } from "./BlockMarkdown";
import { ResponsiveTable } from "./ResponsiveTable";

const COLUMNS = [
  { key: "useCase", label: "Use case" },
  { key: "start", label: "Start with" },
  { key: "add", label: "Add" },
  { key: "why", label: "Why" },
] as const;

/** "Which skill fits your use case": a starting skill and a complement for each job. */
export function UseCaseTable({ block }: { block: UseCasesBlock }) {
  return (
    <ResponsiveTable
      className="v10-rtable--usecases"
      columns={COLUMNS}
      rows={block.rows.map((row) => ({
        key: row.useCase,
        cells: {
          useCase: <BlockMarkdown inline>{row.useCase}</BlockMarkdown>,
          start: <code>{row.start}</code>,
          add: <code>{row.add}</code>,
          why: <BlockMarkdown inline>{row.why}</BlockMarkdown>,
        },
      }))}
    />
  );
}
