import { Icon } from "@/components/Icon";
import { type SkillCardBlock, skillCardId, skillCardTitle } from "@/lib/blogBlocks";
import { CodeBlock } from "../CodeBlock";
import { BlockMarkdown } from "./BlockMarkdown";

/**
 * One ranked skill: rank, name, maintainer, the three public figures (installs, repository stars,
 * license), the install command with a copy button, the review, and who it suits. Every figure
 * keeps its source and its caveat in the card's footer.
 */
export function SkillCard({ card }: { card: SkillCardBlock }) {
  const id = skillCardId(card.name);
  const title = skillCardTitle(card);
  return (
    <article className="v10-skillcard" aria-labelledby={id}>
      <header className="v10-skillcard__head">
        <p className="v10-skillcard__rank" aria-hidden="true">
          <span>#</span>
          {card.rank}
        </p>
        <div className="v10-skillcard__heading">
          <h3 id={id} className="v10-skillcard__title">
            <span className="sr-only">{card.rank}. </span>
            {title}
          </h3>
          <p className="v10-skillcard__by">
            by {card.maintainer} ·{" "}
            <a href={card.source.url} target="_blank" rel="noopener noreferrer">
              {card.source.label}
              <span aria-hidden="true"> ↗</span>
            </a>
          </p>
        </div>
      </header>
      <p className="v10-skillcard__bestfor">
        <span className="v10-skillcard__bestfor-label">Best for</span> <BlockMarkdown inline>{card.bestFor}</BlockMarkdown>
      </p>

      <ul className="v10-skillcard__badges" aria-label="Key figures">
        <li className="v10-badge">
          <Icon name="download" size={14} />
          <span className="v10-badge__value">{card.installs.count ?? "Not shown"}</span>
          <span className="v10-badge__label">installs</span>
        </li>
        <li className="v10-badge">
          <Icon name="star" size={14} />
          <span className="v10-badge__value">{card.repoStars}</span>
          <span className="v10-badge__label">repo stars</span>
        </li>
        <li className={card.license.declared ? "v10-badge" : "v10-badge v10-badge--warn"}>
          <Icon name={card.license.declared ? "shield-check" : "alert-triangle"} size={14} />
          <span className="v10-badge__value">{card.license.name}</span>
          <span className="v10-badge__label">license</span>
        </li>
      </ul>

      <CodeBlock language="bash">
        <code className="language-bash">{card.install}</code>
      </CodeBlock>

      <div className="v10-skillcard__desc">
        <BlockMarkdown>{card.description}</BlockMarkdown>
      </div>

      <div className="v10-skillcard__suited">
        <p className="v10-skillcard__suited-label">Best suited for</p>
        <BlockMarkdown>{card.suitedFor}</BlockMarkdown>
      </div>

      <footer className="v10-skillcard__facts">
        <dl>
          <div>
            <dt>Maintainer</dt>
            <dd>
              {card.maintainer}, in{" "}
              <a href={card.source.url} target="_blank" rel="noopener noreferrer">
                {card.source.label}
              </a>
            </dd>
          </div>
          <div>
            <dt>Installs</dt>
            <dd>
              {card.installs.count ?? "Not shown"} on{" "}
              <a href={card.installs.url} target="_blank" rel="noopener noreferrer">
                skills.sh
              </a>
              {card.installs.note ? <>, {card.installs.note}</> : null}
            </dd>
          </div>
          <div>
            <dt>Repo stars</dt>
            <dd>{card.repoStars} GitHub stars for the whole {card.source.label} repository</dd>
          </div>
          <div>
            <dt>License</dt>
            <dd>
              {card.license.name}
              {card.license.note ? <> ({card.license.note})</> : null}
            </dd>
          </div>
        </dl>
      </footer>
    </article>
  );
}
