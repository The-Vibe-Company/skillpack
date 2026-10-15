import type { BlogBlock, SkillCardBlock } from "@/lib/blogBlocks";
import { ComparisonTable } from "./ComparisonTable";
import { CtaBlock } from "./CtaBlock";
import { FaqAccordion } from "./FaqAccordion";
import { KeyTakeaways } from "./KeyTakeaways";
import { SkillCard } from "./SkillCard";
import { UseCaseTable } from "./UseCaseTable";

/** Renders one structured block in place of its fenced YAML. `cards` feeds the comparison table. */
export function BlogBlockView({ block, cards }: { block: BlogBlock; cards: readonly SkillCardBlock[] }) {
  switch (block.kind) {
    case "takeaways":
      return <KeyTakeaways block={block.data} />;
    case "skill-card":
      return <SkillCard card={block.data} />;
    case "skill-comparison":
      return <ComparisonTable block={block.data} cards={cards} />;
    case "use-cases":
      return <UseCaseTable block={block.data} />;
    case "faq":
      return <FaqAccordion block={block.data} />;
    case "cta":
      return <CtaBlock block={block.data} />;
  }
}
