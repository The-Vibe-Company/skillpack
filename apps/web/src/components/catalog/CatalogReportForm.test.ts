// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogReportForm } from "./CatalogReportForm";

// SAFETY: React's test harness reads this documented global flag; the test owns its boolean value.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

async function renderForm(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(CatalogReportForm, { orgSlug: "acme", skillSlug: "release/helper" }));
  });
  return container;
}

async function submitForm(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

function chooseReason(container: HTMLElement, value: string): void {
  const select = container.querySelector<HTMLSelectElement>("select[name='reason']");
  if (!select) throw new Error("reason select not found");
  select.value = value;
  act(() => select.dispatchEvent(new Event("change", { bubbles: true })));
}

function enterDetails(container: HTMLElement, value: string): void {
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea[name='details']");
  if (!textarea) throw new Error("details textarea not found");
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, value);
  act(() => textarea.dispatchEvent(new Event("input", { bubbles: true })));
}

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("catalog report disclosure", () => {
  it("exposes the required French labels and bounded optional details", async () => {
    const container = await renderForm();
    const summary = container.querySelector("summary");
    expect(summary?.textContent).toBe("Signaler");
    expect(container.querySelector("select")?.required).toBe(true);
    expect(Array.from(container.querySelectorAll<HTMLOptionElement>("select option")).map((option) => [option.textContent, option.value])).toEqual([
      ["Choisir un motif", ""],
      ["Secret exposé", "secret_exposure"],
      ["Malveillant", "malicious"],
      ["Licence", "license"],
      ["Spam", "spam"],
    ]);
    expect(container.querySelector("textarea")?.maxLength).toBe(2000);
    expect(container.textContent).toContain("Aucun compte n’est nécessaire.");
  });

  it("posts anonymously, omits empty details, and shows the review confirmation", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const container = await renderForm();
    chooseReason(container, "malicious");
    const form = container.querySelector<HTMLFormElement>("form");
    if (!form) throw new Error("report form not found");

    await submitForm(form);

    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/public/catalog/skills/acme/release%2Fhelper/reports",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "malicious" }),
      }),
    );
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Stan");
    expect(container.textContent).toContain("sous 48 heures");
  });

  it.each([
    [400, "Le signalement est incomplet"],
    [404, "Cette compétence n’est plus disponible"],
    [429, "Trop de signalements ont été reçus"],
    [503, "temporairement indisponible"],
  ])("maps HTTP %s to truthful copy and retains input", async (status, message) => {
    const fetchMock = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal("fetch", fetchMock);
    const container = await renderForm();
    chooseReason(container, "license");
    enterDetails(container, "The license file is missing.");
    const form = container.querySelector<HTMLFormElement>("form");
    if (!form) throw new Error("report form not found");

    await submitForm(form);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(container.querySelector<HTMLSelectElement>("select")?.value).toBe("license");
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("The license file is missing.");
  });
});
