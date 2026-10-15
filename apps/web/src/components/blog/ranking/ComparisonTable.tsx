import type { ComparisonBlock, SkillCardBlock } from "@/lib/blogBlocks";
import { skillCardId } from "@/lib/blogBlocks";
import { ResponsiveTable } from "./ResponsiveTable";

const COLUMNS = [
  { key: "skill", label: "Skill", hint: "maintainer" },
  { key: "installs", label: "Installs", hint: "skills.sh", numeric: true },
  { key: "stars", label: "Repo stars", hint: "GitHub", numeric: true },
  { key: "license", label: "License" },
  { key: "focus", label: "Focus" },
] as const;

/**
 * The side-by-side table, built from the post's own skill cards so the two can never disagree.
 * Each name links to its card.
 */
export function ComparisonTable({ block, cards }: { block: ComparisonBlock; cards: readonly SkillCardBlock[] }) {
  return (
    <ResponsiveTable
      className="v10-rtable--compare"
      caption={block.caption}
      columns={COLUMNS}
      rows={cards.map((card) => ({
        key: card.name,
        cells: {
          skill: (
            <span className="v10-rtable__skillcell">
              <span className="v10-rtable__rank">{card.rank}</span>
              <span>
                <a className="v10-rtable__skill" href={`#${skillCardId(card.name)}`}>
                  <code>{card.name}</code>
                </a>
                <span className="v10-rtable__sub">{card.maintainer}</span>
              </span>
            </span>
          ),
          installs: card.installs.count ?? "Not shown",
          stars: card.repoStars,
          license: card.license.declared ? card.license.name : <span className="v10-rtable__warn">{card.license.name}</span>,
          focus: card.focus,
        },
      }))}
    />
  );
}
