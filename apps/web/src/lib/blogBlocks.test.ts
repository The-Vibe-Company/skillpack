import { describe, expect, it } from "vitest";
import {
  type BlogBlock,
  blogBlockTocEntries,
  blogFaqEntries,
  extractBlogBlocks,
  parseBlogBlock,
  stickyCta,
  validateBlogBlocks,
} from "./blogBlocks";
import { blogTableOfContents } from "./blogMarkdown";

const CARD = `rank: 1
name: frontend-design
maintainer: Anthropic
bestFor: distinctive new UI
source: { label: anthropics/skills, url: "https://github.com/anthropics/skills/tree/main/skills/frontend-design" }
repoStars: "181.1K"
installs: { count: "988.5K", url: "https://skills.sh/anthropics/skills/frontend-design" }
license: { name: Apache 2.0, note: LICENSE.txt in the skill folder }
focus: Visual direction
install: skillpack install github:anthropics/skills/skills/frontend-design --scope project
description: |
  First paragraph.

  Second paragraph.
suitedFor: teams starting a new UI.`;

function fence(language: string, yaml: string): string {
  return `\`\`\`${language}\n${yaml}\n\`\`\``;
}

function card(overrides: Record<string, string> = {}): string {
  return CARD.split("\n")
    .map((line) => {
      const key = /^(\w+):/.exec(line)?.[1];
      return key && key in overrides ? `${key}: ${overrides[key]}` : line;
    })
    .join("\n");
}

describe("blog blocks", () => {
  it("reads a skill card with defaults and keeps its Markdown paragraphs, trimmed", () => {
    const block = parseBlogBlock("skill-card", CARD);

    expect(block.kind).toBe("skill-card");
    if (block.kind !== "skill-card") return;
    expect(block.data.license).toEqual({ name: "Apache 2.0", note: "LICENSE.txt in the skill folder", declared: true });
    expect(block.data.description).toBe("First paragraph.\n\nSecond paragraph.");
    expect(blogBlockTocEntries(block)).toEqual([{ id: "skill-frontend-design", text: "1. frontend-design", depth: 3 }]);
  });

  it("rejects unknown keys, missing fields, unsafe links and non-Skillpack commands, naming the field", () => {
    expect(() => parseBlogBlock("skill-card", `${CARD}\nrating: 5`)).toThrow(/skill-card block: .*rating/);
    expect(() => parseBlogBlock("skill-card", CARD.replace(/^focus: .*$/m, ""))).toThrow(/focus/);
    expect(() => parseBlogBlock("skill-card", card({ install: "npx skills add frontend-design" }))).toThrow(/install/);
    expect(() => parseBlogBlock("skill-card", card({ name: "Frontend Design" }))).toThrow(/name/);
    expect(() => parseBlogBlock("cta", 'title: Go\nprimary: { label: Go, href: "javascript:alert(1)" }')).toThrow(/primary\.href/);
    expect(() => parseBlogBlock("cta", "title: Go\nprimary: { label: Go, href: //evil.example }")).toThrow(/primary\.href/);
    // Browsers strip tabs and read backslashes as slashes, so these would leave the site too.
    for (const bypass of ['"/\\t/evil.example"', '"/\\\\evil.example"', '"https://evil.example\\n.x"']) {
      expect(() => parseBlogBlock("cta", `title: Go\nprimary: { label: Go, href: ${bypass} }`)).toThrow(/primary\.href/);
    }
    expect(parseBlogBlock("cta", "title: Go\nprimary: { label: Go, href: /blog/a-post#faq }").kind).toBe("cta");
    expect(() => parseBlogBlock("faq", "items: [")).toThrow(/faq block: invalid YAML/);
  });

  it("finds blocks in document order and leaves ordinary code fences alone", () => {
    const body = [
      "Intro.",
      fence("bash", "skillpack install x"),
      fence("takeaways", "title: Key Takeaways\nitems:\n  - { lead: One., text: Two. }"),
      "~~~yaml\nrank: 9\n~~~",
      fence("skill-card", CARD),
      fence("skill-comparison", ""),
    ].join("\n\n");

    expect(extractBlogBlocks(body).map((block) => block.kind)).toEqual(["takeaways", "skill-card", "skill-comparison"]);
    expect(blogTableOfContents(`## Ranking\n\n${body}`)).toEqual([
      { id: "ranking", text: "Ranking", depth: 2 },
      { id: "key-takeaways", text: "Key Takeaways", depth: 2 },
      { id: "skill-frontend-design", text: "1. frontend-design", depth: 3 },
    ]);
  });

  it("requires ranks 1…n in order, unique names and a comparison that has cards to compare", () => {
    const cardsAt = (...ranks: number[]) =>
      ranks.map((rank, index) => parseBlogBlock("skill-card", card({ rank: String(rank), name: `skill-${index}` })));

    expect(() => validateBlogBlocks(cardsAt(1, 2))).not.toThrow();
    expect(() => validateBlogBlocks(cardsAt(2))).toThrow(/rank 2; expected 1/);
    expect(() => validateBlogBlocks(cardsAt(1, 3))).toThrow(/rank 3; expected 2/);
    const twin = parseBlogBlock("skill-card", card({ rank: "2" }));
    expect(() => validateBlogBlocks([parseBlogBlock("skill-card", CARD), twin])).toThrow(/unique/);
    expect(() => validateBlogBlocks([parseBlogBlock("skill-comparison", "")])).toThrow(/needs at least one skill-card/);
  });

  it("refuses a card whose GitHub install command fetches another folder than its source link", () => {
    const wrong = parseBlogBlock("skill-card", card({ install: "skillpack install github:anthropics/skills/skills/webapp-testing" }));

    expect(() => validateBlogBlocks([wrong])).toThrow(/install fetches anthropics\/skills\/skills\/webapp-testing but source links/);
    const pinned = parseBlogBlock("skill-card", card({ install: "skillpack install github:anthropics/skills/skills/frontend-design@v1" }));
    expect(() => validateBlogBlocks([pinned])).not.toThrow();
  });

  it("allows one sticky call to action and exposes it", () => {
    const cta = (sticky: boolean): BlogBlock =>
      parseBlogBlock("cta", `title: "Your team's skills, in one place."\nprimary: { label: Sign up, href: /login }\nsticky: ${sticky}`);

    expect(stickyCta([cta(false), cta(true)])?.title).toBe("Your team's skills, in one place.");
    expect(stickyCta([cta(false)])).toBeNull();
    expect(() => validateBlogBlocks([cta(true), cta(true)])).toThrow(/only one cta/);
  });

  it("turns FAQ answers into plain text for JSON-LD, links and code unwrapped", () => {
    const faq = parseBlogBlock(
      "faq",
      'items:\n  - question: "What is `SKILL.md`?"\n    answer: "See [the guide](/blog/what-is-skill-md) and run `skillpack sync --frozen`."',
    );

    expect(blogFaqEntries([faq])).toEqual([
      { question: "What is SKILL.md?", answer: "See the guide and run skillpack sync --frozen." },
    ]);
  });
});
