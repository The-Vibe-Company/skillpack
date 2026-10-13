import Link from "next/link";
import { formatHumanDateUTC } from "@/lib/format";
import { catalogSkillPath, type PublicCatalogSkill } from "@/lib/publicCatalog";

/**
 * One listed skill on the catalog index. The title link stretches over the whole card, so the
 * card is a single tab stop.
 */
export function CatalogSkillCard({ skill }: { skill: PublicCatalogSkill }) {
  return (
    <article className="v10-catcard">
      <p className="v10-postmeta">
        <span className="v10-postmeta__item v10-catcard__org">{skill.org_name}</span>
        <span className="v10-postmeta__item mono">v{skill.version}</span>
        <time className="v10-postmeta__item" dateTime={skill.released_at}>
          {formatHumanDateUTC(skill.released_at)}
        </time>
      </p>
      <h2 className="v10-catcard__title">
        <Link href={catalogSkillPath(skill.org_slug, skill.skill_slug)}>{skill.name}</Link>
      </h2>
      <p className="v10-catcard__desc">{skill.description}</p>
      <p className="v10-catcard__slug mono">
        {skill.org_slug}/{skill.skill_slug}
      </p>
    </article>
  );
}
