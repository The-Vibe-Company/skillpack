import { Icon } from "@/components/Icon";
import type { FaqBlock } from "@/lib/blogBlocks";
import { BlockMarkdown } from "./BlockMarkdown";

/**
 * Questions as native disclosures: answers are in the server HTML whether open or not, so
 * crawlers and find-in-page read them. The page emits the matching FAQPage JSON-LD.
 */
export function FaqAccordion({ block }: { block: FaqBlock }) {
  return (
    <div className="lp-faq v10-faq">
      {block.items.map((item) => (
        <details className="lp-faq__item" key={item.question}>
          <summary className="lp-faq__q">
            <span className="v10-faq__q">
              <BlockMarkdown inline>{item.question}</BlockMarkdown>
            </span>
            <Icon name="chevron-down" size={18} />
          </summary>
          <div className="lp-faq__a">
            <BlockMarkdown>{item.answer}</BlockMarkdown>
          </div>
        </details>
      ))}
    </div>
  );
}
