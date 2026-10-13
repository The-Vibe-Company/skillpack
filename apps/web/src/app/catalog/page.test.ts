// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import CatalogIndexPage, { metadata } from "./page";

// SAFETY: React's test harness reads this documented global flag; the test owns its boolean value.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

async function renderIndex(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(React.createElement(CatalogIndexPage));
  });
  return container;
}

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

describe("public catalog index", () => {
  it("lists every official skill with its name, description and license", async () => {
    const container = await renderIndex();
    const items = Array.from(container.querySelectorAll(".v10-blog__item"));

    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe("Catalog");
    expect(items.map((item) => item.querySelector("h2 a")?.getAttribute("href"))).toEqual([
      "/catalog/skillpack",
      "/catalog/incident-summary",
    ]);
    const example = items[1];
    expect(example?.querySelector("h2")?.textContent).toBe("incident-summary");
    expect(example?.querySelector(".v10-blog__itemdesc")?.textContent).toBe(
      "Summarize an incident timeline from logs into a concise postmortem draft.",
    );
    expect(example?.textContent).toContain("License: MIT");
    expect(container.querySelector(".v10-footer__by")?.textContent).toBe("Skillpack catalog");
  });

  it("titles itself Catalog and canonicalizes to /catalog", () => {
    // The root layout template appends " · Skillpack", so the page title must stay bare.
    expect(metadata.title).toBe("Catalog");
    expect(metadata.openGraph?.title).toBe("Catalog · Skillpack");
    expect(metadata.description).toBe("Official skills maintained in the Skillpack repository.");
    expect(metadata.alternates?.canonical).toBe("/catalog");
    expect(metadata.openGraph?.url).toBe("/catalog");
  });
});
