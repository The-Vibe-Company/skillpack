import { TAKEAWAYS_ID, type TakeawaysBlock } from "@/lib/blogBlocks";
import { BlockMarkdown } from "./BlockMarkdown";

/** The post's summary box: a titled list of one-line conclusions, each led by its claim in bold. */
export function KeyTakeaways({ block }: { block: TakeawaysBlock }) {
  return (
    <section className="v10-takeaways" aria-labelledby={TAKEAWAYS_ID}>
      <h2 id={TAKEAWAYS_ID} className="v10-takeaways__title">
        {block.title}
      </h2>
      <ul className="v10-takeaways__list">
        {block.items.map((item) => (
          <li key={item.lead}>
            <strong>
              <BlockMarkdown inline>{item.lead}</BlockMarkdown>
            </strong>{" "}
            <BlockMarkdown inline>{item.text}</BlockMarkdown>
          </li>
        ))}
      </ul>
    </section>
  );
}
