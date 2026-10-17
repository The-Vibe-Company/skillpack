import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Product promise:
 * The marketing landing's motion (hero entrance and text shine, ambient aurora, floating cards, CTA
 * sheen, card glow) is decoration. Visitors who ask for reduced motion get a still page with every
 * word and control intact, and the always-on background motion stays cheap to composite.
 *
 * Why this test is stylesheet-level:
 * happy-dom does not apply media queries to computed animation, so the CSS contract is the lowest
 * deterministic boundary that proves the gating.
 *
 * Failure proof:
 * Declaring an `animation` outside a `prefers-reduced-motion: no-preference` block, dropping the gated
 * shine/aurora/sheen/glow rules, or animating a layout or paint property in the aurora fails a case.
 */

const source = readFileSync(new URL("./landing.css", import.meta.url), "utf8");
const css = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");

type AtRule = { prelude: string; body: string };
type Partition = { rules: AtRule[]; rest: string };

/** Splits off every top-level at-rule matching `test`, returning them and the remaining sheet. */
function partition(stylesheet: string, test: (prelude: string) => boolean): Partition {
  const rules: AtRule[] = [];
  let rest = "";
  let index = 0;
  while (index < stylesheet.length) {
    const at = stylesheet.indexOf("@", index);
    if (at < 0) break;
    const open = stylesheet.indexOf("{", at);
    if (open < 0) break;
    let depth = 1;
    let close = open + 1;
    for (; close < stylesheet.length && depth > 0; close += 1) {
      if (stylesheet[close] === "{") depth += 1;
      if (stylesheet[close] === "}") depth -= 1;
    }
    const prelude = stylesheet.slice(at, open).trim();
    if (test(prelude)) {
      rest += stylesheet.slice(index, at);
      rules.push({ prelude, body: stylesheet.slice(open + 1, close - 1) });
    } else {
      rest += stylesheet.slice(index, close);
    }
    index = close;
  }
  return { rules, rest: rest + stylesheet.slice(index) };
}

const motionAllowed = partition(css, (prelude) => /prefers-reduced-motion:\s*no-preference/.test(prelude));
const keyframes = partition(css, (prelude) => prelude.startsWith("@keyframes"));
const gated = motionAllowed.rules.map((rule) => rule.body).join(" ");

describe("landing motion respects prefers-reduced-motion", () => {
  it("declares every animation only inside a no-preference block", () => {
    const ungated = partition(motionAllowed.rest, (prelude) => prelude.startsWith("@keyframes")).rest;

    expect(ungated).not.toMatch(/[{;]\s*animation(-name)?\s*:/);
  });

  it("gates the hero shine, ambient aurora, CTA sheen and card glow", () => {
    expect(gated).toMatch(/\.lp-em--shine \{ animation: lp-shine [^}]* 2 both; \}/);
    expect(gated).toMatch(/\.lp-ambient::before \{ animation: lp-aurora-a [^}]*infinite/);
    expect(gated).toMatch(/\.lp-ambient::after \{ animation: lp-aurora-b [^}]*infinite/);
    expect(gated).toMatch(/\.lp-cta:hover::after \{ transform: translateX\(110%\); transition:/);
    expect(gated).toMatch(/\.lp-glow:hover::before \{ opacity: 1; \}/);
    // The ungated glow ring stays invisible, and the sheen rests off the button.
    expect(motionAllowed.rest).toMatch(/\.lp-glow::before \{[^}]* opacity: 0; \}/);
    expect(motionAllowed.rest).toMatch(/\.lp-cta::after \{[^}]* transform: translateX\(-110%\); \}/);
  });

  it("lets the island pause off-screen ambience over the shorthand", () => {
    expect(motionAllowed.rest).toContain(
      ".lp-ambient.lp-ambient--paused::before, .lp-ambient.lp-ambient--paused::after { animation-play-state: paused; }",
    );
  });

  it("animates the infinite aurora with compositor-only properties", () => {
    const aurora = keyframes.rules.filter((rule) => rule.prelude.startsWith("@keyframes lp-aurora-"));
    const properties = Array.from(
      aurora.map((rule) => rule.body).join(" ").matchAll(/([a-z-]+)\s*:/g),
      (match) => match[1],
    );

    expect(aurora.map((rule) => rule.prelude)).toEqual(["@keyframes lp-aurora-a", "@keyframes lp-aurora-b"]);
    expect(new Set(properties)).toEqual(new Set(["transform", "opacity"]));
  });
});
