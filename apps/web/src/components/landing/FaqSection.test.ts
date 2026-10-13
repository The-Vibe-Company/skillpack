// @vitest-environment happy-dom

import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FaqSection, HOME_FAQ, faqAnswerText } from "./FaqSection";

function renderFaq(): HTMLElement {
  const container = document.createElement("div");
  // Server HTML is what crawlers read, so the answers must be present without hydration.
  container.innerHTML = renderToString(React.createElement(FaqSection));
  return container;
}

describe("FaqSection", () => {
  it("renders every question and answer in the server HTML as native disclosures", () => {
    const container = renderFaq();
    const section = container.querySelector("section#faq");
    const items = Array.from(container.querySelectorAll("details.lp-faq__item"));

    expect(section?.querySelector("h2")?.textContent).toBe("Frequently asked questions");
    expect(HOME_FAQ.length).toBeGreaterThanOrEqual(6);
    expect(HOME_FAQ.length).toBeLessThanOrEqual(8);
    expect(items).toHaveLength(HOME_FAQ.length);
    items.forEach((item, i) => {
      expect(item.querySelector("summary")?.textContent).toBe(HOME_FAQ[i]?.question);
      expect(item.querySelector(".lp-faq__a p")?.textContent).toBe(faqAnswerText(HOME_FAQ[i]?.answer ?? ""));
    });
  });

  it("publishes FAQPage JSON-LD that matches the visible questions and answers", () => {
    const container = renderFaq();
    const script = container.querySelector('script[type="application/ld+json"]');
    const data = JSON.parse(script?.textContent ?? "null");
    const visible = Array.from(container.querySelectorAll("details.lp-faq__item")).map((item) => ({
      "@type": "Question",
      name: item.querySelector("summary")?.textContent,
      acceptedAnswer: { "@type": "Answer", text: item.querySelector(".lp-faq__a p")?.textContent },
    }));

    expect(data).toEqual({
      "@context": "https://schema.org",
      "@graph": [{ "@type": "FAQPage", mainEntity: visible }],
    });
    expect(script?.innerHTML).not.toMatch(/<(?!\/script)/);
  });

  it("links the SKILL.md question to the blog guide", () => {
    const container = renderFaq();
    const item = Array.from(container.querySelectorAll("details")).find(
      (candidate) => candidate.querySelector("summary")?.textContent === "What is SKILL.md?",
    );

    expect(item?.querySelector("a")?.getAttribute("href")).toBe("/blog/what-is-skill-md");
  });

  it("names only the CLI's supported install targets and real commands", () => {
    const text = HOME_FAQ.map((entry) => entry.answer).join(" ");

    expect(text).toContain("--tools claude-code,codex,opencode");
    expect(text).toContain(".companion/skills.lock.json");
    expect(text).toContain("skillpack sync --frozen");
    expect(text).not.toMatch(/cursor|npm install|skills install|\bfree\b|soc 2|\biso\b/i);
  });
});
