import { extname } from "node:path";
import ts from "typescript";
import { z } from "zod";

const KIB = 1024;
const RASTER_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".bmp", ".ico", ".tif", ".tiff"]);
const pullRequestSchema = z.object({
  title: z.string().nullish(),
  body: z.string().nullish(),
  labels: z.array(z.union([z.string(), z.object({ name: z.string() }).transform((label) => label.name)])).nullish(),
});

function isPresent(file) {
  return !/^(?:D|deleted|removed)$/i.test(file.status ?? "");
}

/** Input metadata must describe only added, copied, modified, or renamed diff destinations. */
export function inspectAssets(files) {
  const findings = [];
  for (const file of files) {
    if (!isPresent(file)) continue;
    const extension = extname(file.path).toLowerCase();
    if (RASTER_EXTENSIONS.has(extension) && file.size > 200 * KIB) {
      findings.push({ check: "assets", severity: "blocking", message: "Raster asset exceeds 200 KiB.", path: file.path });
    }
    if (extension === ".svg" && file.size > 50 * KIB) {
      findings.push({ check: "assets", severity: "blocking", message: "SVG asset exceeds 50 KiB.", path: file.path });
    }
    if ([".png", ".jpg", ".jpeg"].includes(extension) && file.size > 100 * KIB) {
      findings.push({ check: "assets", severity: "warning", message: "Consider WebP or AVIF for this PNG/JPEG asset over 100 KiB.", path: file.path });
    }
  }
  return findings;
}

export function inspectLeftovers(files, pr = {}) {
  const findings = files.filter((file) => isPresent(file) && /(?:^|[\\/])screenshots(?:[\\/]|$)/i.test(file.path))
    .map((file) => ({ check: "leftovers", severity: "blocking", message: "Remove committed screenshot artifacts.", path: file.path }));
  const metadata = pullRequestSchema.parse(pr);
  if ([metadata.title, metadata.body, ...(metadata.labels ?? [])].some((value) => value != null && /do\s+not\s+merge/i.test(value))) {
    findings.push({ check: "leftovers", severity: "blocking", message: "Remove the DO NOT MERGE marker from pull request metadata." });
  }
  return findings;
}

function unwrap(expression) {
  while (expression && (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression))) {
    expression = expression.expression;
  }
  return expression;
}

// Resolve literals only. Unknown expressions are warnings, never guessed to be true.
function literal(expression) {
  expression = unwrap(expression);
  if (!expression) return { known: false };
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return { known: true, value: true };
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return { known: true, value: false };
  if (expression.kind === ts.SyntaxKind.NullKeyword) return { known: true, value: null };
  if (ts.isIdentifier(expression) && expression.text === "undefined") return { known: true, value: undefined };
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return { known: true, kind: "string", value: expression.text };
  if (ts.isNumericLiteral(expression)) return { known: true, value: Number(expression.text) };
  return { known: false };
}

function attributeValue(attribute) {
  if (!attribute.initializer) return { known: true, value: true };
  if (ts.isStringLiteral(attribute.initializer)) return { known: true, kind: "string", value: attribute.initializer.text };
  return ts.isJsxExpression(attribute.initializer) ? literal(attribute.initializer.expression) : { known: false };
}

function attributes(opening) {
  const result = new Map();
  for (const attribute of opening.attributes.properties) {
    if (ts.isJsxAttribute(attribute)) result.set(attribute.name.getText(), attributeValue(attribute));
    else {
      // A spread can override an earlier explicit value, but a later explicit value wins.
      for (const key of ["priority", "preload", "fetchPriority", "className", "rel", "as"]) result.set(key, { known: false });
      for (const key of result.keys()) result.set(key, { known: false });
    }
  }
  return result;
}

function isMobileHidden(value) {
  return value.split(/\s+/).some((token) => {
    const parts = token.replace(/^!|!$/g, "").split(":");
    return parts.at(-1) === "hidden" && (parts.length === 1 || parts.slice(0, -1).some((part) => part.startsWith("max-")));
  });
}

function openingOf(node) {
  if (ts.isJsxSelfClosingElement(node)) return node;
  if (ts.isJsxElement(node)) return node.openingElement;
  return undefined;
}

function visibility(node) {
  let dynamic = false;
  for (let ancestor = node; ancestor; ancestor = ancestor.parent) {
    const opening = openingOf(ancestor);
    if (!opening) continue;
    const className = attributes(opening).get("className");
    if (!className) continue;
    if (className.known && className.kind === "string" && isMobileHidden(className.value)) return "hidden";
    if (!className.known) dynamic = true;
  }
  return dynamic ? "dynamic" : "visible";
}

function isMapCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const expression = unwrap(node.expression);
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text === "map";
  return ts.isElementAccessExpression(expression) && literal(expression.argumentExpression).value === "map";
}

function repeated(node) {
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (ts.isArrayLiteralExpression(ancestor)) return true;
    if ((ts.isArrowFunction(ancestor) || ts.isFunctionExpression(ancestor)) && isMapCall(ancestor.parent)
      && ancestor.parent.arguments.includes(ancestor)) return true;
  }
  return false;
}

/**
 * Inspect syntax, not runtime composition. The two-image budget is per source file;
 * imported components, CSS, named callbacks, and conditional branches need review.
 */
export function inspectPreloads(path, source) {
  const kind = /\.[cm]?ts$/i.test(path) ? ts.ScriptKind.TS : /\.[cm]?jsx?$/i.test(path) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const findings = [];
  const imageNames = new Set(["Image", "img"]);
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.moduleSpecifier.text === "next/image" && statement.importClause?.name) {
      imageNames.add(statement.importClause.name.text);
    }
  }
  const add = (severity, message, node) => findings.push({ check: "preload", severity, message, path,
    line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
  if (file.parseDiagnostics.length) add("warning", "Source could not be fully parsed; review image preload usage manually.", file);
  const definite = [];
  function visit(node) {
    const opening = openingOf(node);
    if (opening) {
      const tag = opening.tagName.getText(file);
      const props = attributes(opening);
      let priority = false;
      let dynamic = false;
      if (imageNames.has(tag)) {
        for (const name of ["priority", "preload", "fetchPriority"]) {
          const value = props.get(name);
          if (!value) continue;
          if (!value.known) dynamic = true;
          else if (name === "fetchPriority" ? value.value === "high" : Boolean(value.value)) priority = true;
        }
      } else if (tag === "link") {
        const rel = props.get("rel");
        const as = props.get("as");
        if (rel?.known && rel.kind === "string" && rel.value.toLowerCase().split(/\s+/).includes("preload")) {
          if (as?.known && as.value === "image") priority = true;
          else if (as && !as.known) dynamic = true;
        }
      }
      if (priority || dynamic) {
        if (priority) {
          definite.push(node);
          if (repeated(node)) add("blocking", "Priority image is repeated in a map callback or JSX array.", node);
        } else add("warning", "Dynamic image priority requires manual review.", node);
        const state = visibility(node);
        if (state === "hidden") add(priority ? "blocking" : "warning", "Priority image is hidden on mobile.", node);
        else if (state === "dynamic") add("warning", "Dynamic image visibility requires manual review of mobile preloading.", node);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (definite.length > 2) add("blocking", "Source file exceeds the maximum of two priority image preloads.", definite[2]);
  return findings;
}
