import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Product promise:
 * The public landing, blog and catalog paint without downloading the product stylesheets, while every
 * product screen keeps exactly the styles it had.
 *
 * Regression caught:
 * Every route blocked its first paint on all eighteen sheets (about 60 KiB gzipped), most of them for
 * the signed-in app. Splitting them risks a product route that renders unstyled because it forgot the
 * product bundle, or a product sheet that now loads after the marketing sheets and wins a cascade tie.
 *
 * Why this test is source-level:
 * Which stylesheets a route loads is decided by its static imports, and a cascade tie needs a global
 * selector, so reading the route files and the sheets is the lowest deterministic boundary.
 *
 * Failure proof:
 * Dropping the product import from a product route, importing it from a public route, leaving a
 * sheet out of both bundles, or adding an element-wide rule to a product sheet fails a case below.
 */

const appDir = new URL("../app/", import.meta.url).pathname;
const stylesDir = new URL("./", import.meta.url).pathname;
const PRODUCT_IMPORT = 'import "@/styles/product.css";';
/** Sheets a single public route imports itself instead of through globals.css. */
const HOME_ONLY = ["home.css"];

/** Routes rendered with the root stylesheet alone; everything else is a product route. */
const PUBLIC_ROUTES = [/^page\.tsx$/, /^blog\//, /^catalog\//, /^privacy\//, /^not-found\.tsx$/, /^layout\.tsx$/];

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return /^(page|layout|not-found|error|global-error)\.tsx$/.test(name) ? [relative(appDir, path)] : [];
  });
}

function imports(file: string): string[] {
  return Array.from(readFileSync(file, "utf8").matchAll(/@import "([^"]+)";/g), (match) => match[1]!.split("/").pop()!);
}

const read = (route: string) => readFileSync(join(appDir, route), "utf8");
const routes = routeFiles(appDir);
const isPublic = (route: string) => PUBLIC_ROUTES.some((pattern) => pattern.test(route));
const importsProduct = (route: string) => read(route).includes(PRODUCT_IMPORT);

/** The route file itself or a layout above it, below the root layout, imports the product sheets. */
function productCovered(route: string): boolean {
  if (importsProduct(route)) return true;
  const segments = route.split("/").slice(0, -1);
  return segments.some((_, index) => {
    const layout = [...segments.slice(0, index + 1), "layout.tsx"].join("/");
    return routes.includes(layout) && importsProduct(layout);
  });
}

describe("stylesheet split between public and product routes", () => {
  it("loads the product sheets on every product route, directly or through its layout", () => {
    const uncovered = routes.filter((route) => !isPublic(route) && !productCovered(route));

    expect(importsProduct("(app)/layout.tsx")).toBe(true);
    expect(importsProduct("global-error.tsx")).toBe(true);
    expect(uncovered).toEqual([]);
  });

  it("keeps the product sheets off the public routes", () => {
    expect(routes.filter(isPublic).filter(importsProduct)).toEqual([]);
  });

  it("bundles every stylesheet exactly once", () => {
    const shared = imports(join(appDir, "globals.css"));
    const product = imports(join(stylesDir, "product.css"));
    const sheets = readdirSync(stylesDir).filter((name) => name.endsWith(".css") && name !== "product.css");

    expect([...shared, ...product, ...HOME_ONLY].sort()).toEqual(sheets.sort());
  });

  // The home page's layout loads with its route only, so blog, catalog and privacy pages skip it.
  it("loads the home sheet from the home route alone", () => {
    const importers = routes.filter((route) => read(route).includes('import "@/styles/home.css";'));

    expect(importers).toEqual(["page.tsx"]);
    expect(imports(join(appDir, "globals.css"))).not.toContain("home.css");
  });

  // Loading the product sheets last could only flip a cascade tie through a selector that matches
  // public markup too; element-wide rules are the broad way in, so none may live there. Class-level
  // overlaps were checked when the split landed and need a manual look when a product sheet reuses a
  // shared class.
  it("keeps element-wide rules out of the product sheets", () => {
    const elementWide = imports(join(stylesDir, "product.css")).flatMap((sheet) => {
      const css = readFileSync(join(stylesDir, sheet), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const selectors = Array.from(css.matchAll(/(?:^|[{};])\s*([^{};@]+?)\s*\{/g), (match) => match[1]!)
        .flatMap((list) => list.split(","))
        .map((selector) => selector.trim())
        .filter((selector) => !/^(from|to|[\d.]+%)$/.test(selector));
      return selectors.filter((selector) => selector !== ":root" && !/[.#[]/.test(selector)).map((selector) => `${sheet}: ${selector}`);
    });

    expect(elementWide).toEqual([]);
  });
});
