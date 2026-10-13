import Link from "next/link";
import { ArticleMarkdown, BlogShell } from "@/components/blog/BlogChrome";
import type { CatalogSkill, RuntimeRelease } from "@/lib/catalog";
import { serializeJsonLd, softwareSourceCodeStructuredData } from "@/lib/structuredData";

/* One public catalog skill. It reuses the blog shell and prose styles; catalog-only rules live
   under `.v10-catalog__*` in landing.css. */

function CliInstallStep({ release }: { release: RuntimeRelease }) {
  return (
    <p>
      Install the Skillpack CLI: download <code>install.sh</code> (macOS, Linux) or <code>install.ps1</code> (Windows)
      from the <a href={release.url}>Skillpack runtime {release.version} release</a> on GitHub, verify it against{" "}
      <code>SHA256SUMS</code>, and run it.
    </p>
  );
}

function InstallSection({ skill, release }: { skill: CatalogSkill; release: RuntimeRelease }) {
  if (skill.install === "management") {
    return (
      <>
        <CliInstallStep release={release} />
        <p>Connect the CLI to your Skillpack instance, then install this skill:</p>
        <pre>
          <code>{"skillpack auth login\nskillpack install skillpack"}</code>
        </pre>
        <p>
          <code>skillpack install skillpack</code> installs the management skill bundled with the Skillpack instance the
          CLI is signed in to.
        </p>
      </>
    );
  }
  return (
    <>
      <p>This skill is published as source in the Skillpack repository.</p>
      <p>
        <a href={skill.sourceUrl}>View source on GitHub</a>
      </p>
      <CliInstallStep release={release} />
    </>
  );
}

export function CatalogSkillView({ skill, release }: { skill: CatalogSkill; release: RuntimeRelease }) {
  const structuredData = softwareSourceCodeStructuredData({
    name: skill.slug,
    description: skill.description,
    license: skill.license,
    codeRepository: skill.sourceUrl,
  });
  return (
    <BlogShell label="Skillpack catalog">
      <article className="v10-wrap v10-blog__article">
        <p className="v10-blog__meta">
          <Link href="/catalog">Catalog</Link>
        </p>
        <div className="v10-blog__prose">
          <h1>{skill.slug}</h1>
          <p className="v10-catalog__lead">{skill.description}</p>
          <dl className="v10-catalog__facts">
            {skill.license ? (
              <>
                <dt>License</dt>
                <dd>{skill.license}</dd>
              </>
            ) : null}
            {skill.compatibility ? (
              <>
                <dt>Compatibility</dt>
                <dd>{skill.compatibility}</dd>
              </>
            ) : null}
            {skill.allowedTools ? (
              <>
                <dt>Allowed tools</dt>
                <dd>{skill.allowedTools}</dd>
              </>
            ) : null}
            <dt>Source</dt>
            <dd>
              <a href={skill.sourceUrl}>GitHub</a>
            </dd>
          </dl>

          <h2>Install</h2>
          <InstallSection skill={skill} release={release} />

          <h2>Files</h2>
          <ul className="v10-catalog__files">
            {skill.files.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </div>

        <section className="v10-catalog__skillmd" aria-label="SKILL.md">
          <p className="v10-blog__date">SKILL.md</p>
          {/* The page's H1 is the skill name, so the body's own H1 renders as an H2. */}
          <ArticleMarkdown body={skill.body} embedded />
        </section>
      </article>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
    </BlogShell>
  );
}
