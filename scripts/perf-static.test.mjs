import assert from "node:assert/strict";
import test from "node:test";
import { inspectAssets, inspectLeftovers, inspectPreloads } from "./perf-static.mjs";

const kib = 1024;
const preloads = (source) => inspectPreloads("apps/web/src/app/page.tsx", source);
const blocking = (findings) => findings.filter((finding) => finding.severity === "blocking");

test("asset limits are strict byte boundaries and include every raster format", () => {
  for (const extension of ["png", "jpg", "jpeg", "webp", "avif", "gif", "bmp", "ico", "tif", "tiff"]) {
    assert.equal(blocking(inspectAssets([{ path: `public/file.${extension}`, size: 200 * kib }])).length, 0);
    assert.equal(blocking(inspectAssets([{ path: `public/file.${extension}`, size: 200 * kib + 1 }])).length, 1);
  }
  assert.deepEqual(inspectAssets([{ path: "public/file.svg", size: 50 * kib }]), []);
  assert.equal(blocking(inspectAssets([{ path: "public/file.SVG", size: 50 * kib + 1 }])).length, 1);
});

test("PNG/JPEG conversion warnings start above 100 KiB independently of the blocking cap", () => {
  for (const extension of ["png", "JPG", "jpeg"]) {
    assert.deepEqual(inspectAssets([{ path: `file.${extension}`, size: 100 * kib }]), []);
    const warning = inspectAssets([{ path: `file.${extension}`, size: 100 * kib + 1 }]);
    assert.equal(warning.length, 1);
    assert.equal(warning[0].severity, "warning");
    assert.match(warning[0].message, /WebP or AVIF/);
    assert.equal(inspectAssets([{ path: `file.${extension}`, size: 201 * kib }]).length, 2);
  }
  assert.deepEqual(inspectAssets([{ path: "file.avif", size: 150 * kib }, { path: "file.txt", size: 999999 }] ), []);
});

test("deleted metadata is ignored and renamed destinations are inspected", () => {
  assert.deepEqual(inspectAssets([{ path: "large.png", size: 999999, status: "D" }]), []);
  assert.equal(blocking(inspectAssets([{ path: "renamed.png", size: 999999, status: "R100" }])).length, 1);
});

test("leftover detection matches complete screenshot path segments", () => {
  const files = ["screenshots/pr-2182/home.png", "apps/web/screenshots/a.webp", "screenshots/pr-XXX/a.png", "screenshots", "foo\\screenshots\\x.png"];
  assert.equal(inspectLeftovers(files.map((path) => ({ path, size: 1 }))).length, files.length);
  assert.deepEqual(inspectLeftovers(["screenshots-guide.md", "public/myscreenshots/a.png", "docs/screenshot.png"].map((path) => ({ path, size: 1 }))), []);
  assert.deepEqual(inspectLeftovers([{ path: "screenshots/gone.png", status: "deleted" }]), []);
});

test("DO NOT MERGE is case insensitive across title, body, and label formats", () => {
  for (const pr of [{ title: "Do Not Merge" }, { body: "intro\nDO\nNOT\tMERGE\nend" }, { labels: ["do not merge"] }, { labels: [{ name: "Do Not Merge" }] }]) {
    assert.deepEqual(inspectLeftovers([], pr), [{ check: "leftovers", severity: "blocking", message: "Remove the DO NOT MERGE marker from pull request metadata." }]);
  }
  assert.deepEqual(inspectLeftovers([], { title: "Ready", labels: [{ name: "performance" }] }), []);
});

test("false priorities and ordinary eager images are safe even inside hidden maps", () => {
  assert.deepEqual(preloads(`const view = <div className="hidden">{items.map(x => <><Image priority={false} preload={false} fetchPriority="auto" /><img loading="eager" fetchPriority="low" /></>)}</div>;`), []);
});

test("comments and source string contents cannot masquerade as JSX", () => {
  assert.deepEqual(preloads(`// <Image priority /><Image priority /><Image priority />
    const text = '<Image priority className="hidden" />';
    const view = <div>{/* <Image priority className="hidden" /> */}</div>;`), []);
});

test("mobile-hidden classes on images and ancestors block definite priority", () => {
  for (const className of ["hidden", "hidden sm:block", "hidden md:flex", "max-sm:hidden", "max-md:hidden", "!hidden"]) {
    const own = blocking(preloads(`const view = <Image priority className="${className}" />;`));
    assert.equal(own.length, 1, className);
    assert.match(own[0].message, /hidden on mobile/);
    const ancestor = blocking(preloads(`const view = <section className="${className}"><div><Image preload={true} /></div></section>;`));
    assert.equal(ancestor.length, 1, className);
  }
  assert.deepEqual(preloads('const view = <section className="md:hidden"><Image priority /></section>;'), []);
});

test("literal class expressions resolve while variable classes warn without blocking", () => {
  assert.equal(blocking(preloads('const view = <div className={"hidden md:block"}><Image priority /></div>;')).length, 1);
  const findings = preloads('const view = <div className={classes}><Image priority /></div>;');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "warning");
  assert.match(findings[0].message, /visibility/);
});

test("map callbacks block priorities through nested wrappers and function forms", () => {
  for (const expression of [
    'items.map(x => <Image priority />)',
    'items.map(x => <div><><Image preload /></></div>)',
    'items.map(function (x) { return <Image fetchPriority="high" />; })',
    'items["map"](x => <Image priority />)',
    'items.map(x => { const render = () => <Image priority />; return render(); })',
  ]) {
    const findings = blocking(preloads(`const view = ${expression};`));
    assert.equal(findings.length, 1, expression);
    assert.match(findings[0].message, /repeated/);
  }
});

test("static JSX arrays are inspected without treating ordinary sibling JSX as a loop", () => {
  assert.equal(blocking(preloads('const view = [<Image key="a" priority />, <Image key="b" preload />];')).length, 2);
  assert.deepEqual(preloads('const view = <><Image priority /><Image preload /></>;'), []);
});

test("the file budget includes flags on Image aliases, native images, and image preload links", () => {
  const findings = preloads(`import HeroImage from "next/image";
    const view = <><HeroImage priority /><img fetchPriority={"high"} /><link rel="preload" as="image" href="/hero.webp" /></>;`);
  assert.equal(blocking(findings).length, 1);
  assert.match(findings[0].message, /maximum of two/);
  assert.equal(findings[0].line, 2);
  assert.deepEqual(preloads('const view = <><link rel="preload" as="font" /><link rel="stylesheet" as="image" /><Image priority /><Image preload /></>;'), []);
});

test("dynamic flags are advisory and are not counted as definite preloads", () => {
  const findings = preloads('const view = <><Image priority={isHero} /><Image preload={props.preload} /><img fetchPriority={priority} /><Image priority /><Image priority /></>;');
  assert.equal(findings.length, 3);
  assert.ok(findings.every((finding) => finding.severity === "warning"));
  assert.equal(blocking(preloads('const view = items.map(x => <Image priority={isHero} />);')).length, 0);
});

test("spread overrides are uncertain and later explicit false values remain safe", () => {
  assert.equal(preloads('const view = <Image priority {...props} />;')[0].severity, "warning");
  assert.ok(preloads('const view = <Image {...props} />;').every((finding) => finding.severity === "warning"));
  assert.deepEqual(preloads('const view = <Image {...props} priority={false} preload={false} fetchPriority="low" />;'), []);
});

test("findings carry locations without leaking source or metadata strings", () => {
  const secret = "sensitive-marker-never-echo";
  const source = `const view = <div className="hidden"><Image src="${secret}" priority /></div>;`;
  const findings = [...preloads(source), ...inspectLeftovers([], { body: `DO NOT MERGE ${secret}` })];
  assert.ok(!JSON.stringify(findings).includes(secret));
  assert.equal(findings[0].path, "apps/web/src/app/page.tsx");
  assert.equal(findings[0].line, 1);
});

test("JSX source files and literal wrapped booleans are supported", () => {
  assert.equal(blocking(inspectPreloads("page.jsx", 'const view = <Image priority className="hidden" />;')).length, 1);
  assert.deepEqual(preloads('const view = <Image priority={(false as boolean)} preload={null} />;'), []);
  assert.deepEqual(inspectPreloads("types.ts", 'const value = <string>unknownValue;'), []);
});

test("unparseable source requests manual review without quoting diagnostics", () => {
  const findings = preloads('const view = <Image priority className="sensitive-marker-never-echo"');
  assert.ok(findings.some((finding) => finding.severity === "warning" && /parsed/.test(finding.message)));
  assert.ok(!JSON.stringify(findings).includes("sensitive-marker-never-echo"));
});
