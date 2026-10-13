import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { parseDocument as parseYamlDocument } from "yaml";
import { SKILL_NAME_RE, type CatalogCheckReport } from "@skillpack/contracts";
import { extractFrontmatter, parseFrontmatter } from "./frontmatter";
import { MAX_ARCHIVE_BYTES, MAX_ENTRY_COUNT, MAX_FILE_BYTES, MAX_SKILL_MD_BYTES } from "./constants";

/** The input is a frozen public ZIP. Keep this check independent of the canonical tar checksum. */
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP_UTF8_FLAG = 0x0800;
const UNIX_SYSTEM = 3;
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_DIRECTORY = 0o040000;
const UNIX_REGULAR = 0o100000;
const WIN32_RESERVED_BASENAME = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/i;
const SHARE_URL_RE = /\/s\/(?:[0-9a-f]{16}|[0-9a-f]{32})(?![0-9a-f])/i;

const BLOCKING = "blocking" as const;
const WARNING = "warning" as const;

type CatalogFinding = CatalogCheckReport["findings"][number];

interface CatalogZipEntry {
  name: string;
  directory: boolean;
  uncompressedSize: number;
  executable: boolean;
  method: number;
  dataStart: number;
  dataEnd: number;
}

interface CatalogZip {
  entries: CatalogZipEntry[];
  files: Map<string, Buffer>;
}

interface ZipIssueOptions {
  ruleId: string;
  path?: string;
}

interface ValidatedEntryName {
  name: string;
  directory: boolean;
}

/** Internal control-flow error. Its message is deliberately never exposed in a report. */
class CatalogZipIssue extends Error {
  readonly ruleId: string;
  readonly entryPath?: string;

  constructor(options: ZipIssueOptions) {
    super(options.ruleId);
    this.name = "CatalogZipIssue";
    this.ruleId = options.ruleId;
    this.entryPath = options.path;
  }
}

interface CatalogPackageInput {
  bytes?: Buffer;
  checksum: string;
  sizeBytes: number;
  slug: string;
  shareToken?: string | null;
}

/**
 * Check a frozen public ZIP before a moderator can approve it.
 *
 * The ZIP is checked in memory and no package script is executed. The report is intentionally
 * value-free: a finding contains only a stable rule id, a redacted path, and (when useful) a line.
 */
export function checkCatalogPackage(input: CatalogPackageInput): CatalogCheckReport {
  const findings: CatalogFinding[] = [];
  const seenFindings = new Set<string>();
  const addFinding = (ruleId: string, severity: CatalogFinding["severity"], path?: string, line?: number) => {
    const safePath = path ? redactPath(path, input.shareToken) : undefined;
    // Keep one useful occurrence for each rule/file pair so a large archive cannot create an
    // unbounded report from repeated copies of the same finding.
    const key = `${ruleId}\u0000${severity}\u0000${safePath ?? ""}`;
    if (seenFindings.has(key)) return;
    seenFindings.add(key);
    const finding: CatalogFinding = {
      rule_id: ruleId,
      severity,
    };
    if (safePath) finding.path = safePath;
    if (line && line > 0) finding.line = line;
    findings.push(finding);
  };

  const bytes = input.bytes;
  if (!bytes) {
    addFinding("package_bytes_missing", BLOCKING);
    return report(findings);
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
    addFinding("package_size_invalid", BLOCKING);
  } else if (bytes.length !== input.sizeBytes) {
    addFinding("package_size_mismatch", BLOCKING);
  }
  if (!SHA256_RE.test(input.checksum)) {
    addFinding("package_checksum_invalid", BLOCKING);
  } else {
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest !== input.checksum) addFinding("package_checksum_mismatch", BLOCKING);
  }

  // Integrity is a gate. Do not parse or inflate bytes that do not match the frozen release.
  if (findings.some((finding) => finding.severity === BLOCKING)) return report(findings);
  if (bytes.length > MAX_ARCHIVE_BYTES) {
    addFinding("archive_size", BLOCKING);
    return report(findings);
  }

  let archive: CatalogZip;
  try {
    archive = readCatalogZip(bytes);
  } catch (error) {
    if (error instanceof CatalogZipIssue) {
      addFinding(error.ruleId, BLOCKING, error.entryPath);
    } else {
      addFinding("archive_invalid", BLOCKING);
    }
    return report(findings);
  }

  const skillCandidates = archive.entries
    .filter((entry) => !entry.directory && entry.name.split("/").pop() === "SKILL.md")
    .sort((left, right) => {
      const depth = (value: string) => value.split("/").length;
      return depth(left.name) - depth(right.name) || left.name.localeCompare(right.name);
    });
  const selectedSkillPath = skillCandidates[0]?.name ?? null;
  // Multiple equally shallow roots could select different metadata in the canonical archive
  // inspector and this ZIP reader. Fail closed rather than approving a different SKILL.md.
  if (selectedSkillPath && skillCandidates[1]?.name.split("/").length === selectedSkillPath.split("/").length) {
    addFinding("skill_md_ambiguous", BLOCKING);
    return report(findings);
  }
  const rootSkill = selectedSkillPath ? archive.files.get(selectedSkillPath) : undefined;
  let rootSkillText: string | null = null;
  if (!rootSkill) {
    addFinding("skill_md_missing", BLOCKING, "SKILL.md");
  } else if (rootSkill.byteLength > MAX_SKILL_MD_BYTES) {
    addFinding("skill_md_oversize", BLOCKING, selectedSkillPath ?? "SKILL.md");
  } else {
    try {
      rootSkillText = new TextDecoder("utf-8", { fatal: true }).decode(rootSkill);
    } catch {
      addFinding("skill_md_invalid_utf8", BLOCKING, selectedSkillPath ?? "SKILL.md");
    }
  }

  let frontmatter: ReturnType<typeof parseFrontmatter> | null = null;
  if (rootSkillText !== null) {
    frontmatter = checkFrontmatter(rootSkillText);
    if (!frontmatter.ok) {
      addFinding("skill_frontmatter_invalid", BLOCKING, selectedSkillPath ?? "SKILL.md", lineForKey(rootSkillText, /^---/m));
      if (frontmatter.raw !== null) {
        const nameField = /^[ \t]*name[ \t]*:[ \t]*([^\r\n]*)$/im.exec(frontmatter.raw);
        const descriptionField = /^[ \t]*description[ \t]*:[ \t]*([^\r\n]*)$/im.exec(frontmatter.raw);
        const licenseField = /^[ \t]*license[ \t]*:[ \t]*([^\r\n]*)$/im.exec(frontmatter.raw);
        const rawName = nameField?.[1] ? frontmatterScalar(nameField[1]) : "";
        if (!rawName) {
          addFinding("skill_name_missing", BLOCKING, selectedSkillPath ?? "SKILL.md", lineForKey(rootSkillText, /^name\s*:/im));
        } else if (!SKILL_NAME_RE.test(rawName)) {
          addFinding("skill_name_invalid", BLOCKING, selectedSkillPath ?? "SKILL.md", lineForKey(rootSkillText, /^name\s*:/im));
        } else if (rawName !== input.slug) {
          addFinding("skill_name_mismatch", BLOCKING, selectedSkillPath ?? "SKILL.md", lineForKey(rootSkillText, /^name\s*:/im));
        }
        if (!descriptionField || !descriptionField[1]?.trim()) {
          addFinding("skill_description_missing", BLOCKING, selectedSkillPath ?? "SKILL.md", lineForKey(rootSkillText, /^description\s*:/im));
        }
        if (!licenseField || !licenseField[1]?.trim() || /^(["'])\s*\1$/.test(licenseField[1].trim())) {
          addFinding("license_missing", BLOCKING, selectedSkillPath ?? "SKILL.md", lineForKey(rootSkillText, /^license\s*:/im));
        }
      }
    } else {
      const name = frontmatter.data.name;
      const description = frontmatter.data.description;
      const trimmedName = name.trim();
      const trimmedDescription = description.trim();
      if (!trimmedName) addFinding("skill_name_missing", BLOCKING, selectedSkillPath ?? "SKILL.md", lineForKey(rootSkillText, /^name\s*:/im));
      else if (!SKILL_NAME_RE.test(trimmedName)) addFinding("skill_name_invalid", BLOCKING, selectedSkillPath ?? "SKILL.md", lineForKey(rootSkillText, /^name\s*:/im));
      else if (trimmedName !== input.slug) addFinding("skill_name_mismatch", BLOCKING, selectedSkillPath ?? "SKILL.md", lineForKey(rootSkillText, /^name\s*:/im));
      if (!trimmedDescription) addFinding("skill_description_missing", BLOCKING, selectedSkillPath ?? "SKILL.md", lineForKey(rootSkillText, /^description\s*:/im));

      const license = frontmatter.data.license;
      if (!license) addFinding("license_missing", BLOCKING, selectedSkillPath ?? "SKILL.md", lineForKey(rootSkillText, /^license\s*:/im));
      else if (license !== "MIT" && license !== "Apache-2.0") {
        addFinding("license_unsupported", BLOCKING, selectedSkillPath ?? "SKILL.md", lineForKey(rootSkillText, /^license\s*:/im));
      }
      if (frontmatter.body.trim().length < 100) {
        addFinding("body_thin", WARNING, selectedSkillPath ?? "SKILL.md");
      }

      checkLicenseFiles(archive.files, selectedSkillPath ?? "SKILL.md", license, addFinding);
    }
  }
  if (!SKILL_NAME_RE.test(input.slug)) addFinding("skill_slug_invalid", BLOCKING);

  // Scan every regular entry, including packaging-junk directories and binary files. This is
  // intentionally separate from the normal package display/extraction path, which may exclude
  // .git, node_modules, __MACOSX, and other non-runtime paths.
  for (const entry of archive.entries) {
    if (entry.directory) continue;
    const content = archive.files.get(entry.name);
    if (!content) continue;
    const source = content.toString("latin1");
    scanEntry(entry, content, source, input.shareToken, addFinding);
  }

  return report(findings);
}

function checkFrontmatter(md: string): ReturnType<typeof parseFrontmatter> {
  const { raw, body } = extractFrontmatter(md);
  // parseFrontmatter's YAML parser may emit warnings containing source excerpts. Inspect the
  // document without emitting diagnostics and reject warned input before invoking that parser.
  const document = raw === null ? null : parseYamlDocument(raw, { merge: false, logLevel: "error" });
  if (document && (document.errors.length || document.warnings.length)) {
    return { ok: false, error: "invalid catalog frontmatter", raw, body, warnings: [], legacy: { unknownFields: [] } };
  }
  return parseFrontmatter(md);
}

function report(findings: CatalogFinding[]): CatalogCheckReport {
  return {
    version: 1,
    passed: !findings.some((finding) => finding.severity === BLOCKING),
    findings,
  };
}

function frontmatterScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function lineForKey(source: string, expression: RegExp): number | undefined {
  const match = expression.exec(source);
  if (!match || match.index < 0) return undefined;
  return lineAt(source, match.index);
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function windowsPathSegmentViolation(segment: string): boolean {
  if ([...segment].some((character) => (character.codePointAt(0) ?? 0) <= 31)) return true;
  if (/[<>:"|?*]/.test(segment)) return true;
  if (/[ .]$/.test(segment)) return true;
  const basename = (segment.split(".", 1)[0] ?? "").replace(/[ .]+$/, "");
  return WIN32_RESERVED_BASENAME.test(basename);
}

function decodeEntryName(bytes: Buffer, utf8: boolean): string {
  if (!utf8 && bytes.some((byte) => byte > 0x7f)) throw new CatalogZipIssue({ ruleId: "archive_invalid" });
  try {
    return new TextDecoder(utf8 ? "utf-8" : "ascii", { fatal: true }).decode(bytes);
  } catch {
    throw new CatalogZipIssue({ ruleId: "archive_invalid" });
  }
}

function validateEntryName(name: string): ValidatedEntryName {
  if (!name || name.includes("\0") || name.includes("\\")) {
    throw new CatalogZipIssue({ ruleId: "archive_unsafe_path", path: name || undefined });
  }
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    throw new CatalogZipIssue({ ruleId: "archive_unsafe_path", path: name });
  }
  const directory = name.endsWith("/");
  const path = directory ? name.slice(0, -1) : name;
  const segments = path.split("/");
  if (!path || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new CatalogZipIssue({ ruleId: "archive_unsafe_path", path: name });
  }
  if (segments.some(windowsPathSegmentViolation)) {
    throw new CatalogZipIssue({ ruleId: "archive_unsafe_path", path: name });
  }
  return { name: path, directory };
}

function registerPortablePath(
  seen: Map<string, { display: string; kind: "directory" | "file" }>,
  name: string,
  directory: boolean,
): void {
  const segments = name.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    const display = segments.slice(0, index + 1).join("/");
    const key = display.normalize("NFC").toLocaleLowerCase("en-US");
    const kind = index === segments.length - 1 && !directory ? "file" : "directory";
    const previous = seen.get(key);
    if (previous && (previous.display !== display || previous.kind !== kind || index === segments.length - 1)) {
      throw new CatalogZipIssue({ ruleId: "archive_duplicate_path", path: name });
    }
    if (!previous) seen.set(key, { display, kind });
  }
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (offset >= 0 && archive.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new CatalogZipIssue({ ruleId: "archive_invalid" });
}

function readCatalogZip(archive: Buffer): CatalogZip {
  if (archive.length < 22) throw new CatalogZipIssue({ ruleId: "archive_invalid" });
  const eocd = findEndOfCentralDirectory(archive);
  const disk = archive.readUInt16LE(eocd + 4);
  const centralDisk = archive.readUInt16LE(eocd + 6);
  const entriesOnDisk = archive.readUInt16LE(eocd + 8);
  const entryCount = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new CatalogZipIssue({ ruleId: "archive_invalid" });
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new CatalogZipIssue({ ruleId: "archive_invalid" });
  }
  if (entryCount > MAX_ENTRY_COUNT) throw new CatalogZipIssue({ ruleId: "archive_entry_count" });
  if (centralOffset + centralSize > eocd || centralOffset + centralSize > archive.length) {
    throw new CatalogZipIssue({ ruleId: "archive_invalid" });
  }

  const entries: CatalogZipEntry[] = [];
  const seen = new Map<string, { display: string; kind: "directory" | "file" }>();
  let totalUncompressed = 0;
  let totalCompressed = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new CatalogZipIssue({ ruleId: "archive_invalid" });
    }
    const versionMadeBy = archive.readUInt16LE(offset + 4);
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const externalAttributes = archive.readUInt32LE(offset + 38);
    const localOffset = archive.readUInt32LE(offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > archive.length) throw new CatalogZipIssue({ ruleId: "archive_invalid" });
    if ((flags & 0x1) !== 0 || (method !== 0 && method !== 8)) {
      throw new CatalogZipIssue({ ruleId: "archive_invalid" });
    }

    const rawName = archive.subarray(offset + 46, offset + 46 + nameLength);
    const decodedName = decodeEntryName(rawName, (flags & ZIP_UTF8_FLAG) !== 0);
    const validated = validateEntryName(decodedName);
    registerPortablePath(seen, validated.name, validated.directory);

    let unixMode = 0;
    if ((versionMadeBy >>> 8) === UNIX_SYSTEM) {
      unixMode = externalAttributes >>> 16;
      const fileType = unixMode & UNIX_FILE_TYPE_MASK;
      if (fileType !== 0 && fileType !== UNIX_DIRECTORY && fileType !== UNIX_REGULAR) {
        throw new CatalogZipIssue({ ruleId: "archive_symlink", path: validated.name });
      }
      if (validated.directory && fileType === UNIX_REGULAR) {
        throw new CatalogZipIssue({ ruleId: "archive_invalid", path: validated.name });
      }
      if (!validated.directory && fileType === UNIX_DIRECTORY) {
        throw new CatalogZipIssue({ ruleId: "archive_invalid", path: validated.name });
      }
    }

    if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new CatalogZipIssue({ ruleId: "archive_invalid" });
    }
    const localFlags = archive.readUInt16LE(localOffset + 6);
    const localMethod = archive.readUInt16LE(localOffset + 8);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    const compressedEnd = localNameEnd + localExtraLength + compressedSize;
    if (localOffset >= centralOffset || compressedEnd > centralOffset) throw new CatalogZipIssue({ ruleId: "archive_invalid" });
    if (localFlags !== flags || localMethod !== method || !archive.subarray(localNameStart, localNameEnd).equals(rawName)) {
      throw new CatalogZipIssue({ ruleId: "archive_invalid" });
    }
    // Without a data descriptor, both headers must describe exactly the same file bytes.
    if ((flags & 8) === 0 && (archive.readUInt32LE(localOffset + 18) !== compressedSize
      || archive.readUInt32LE(localOffset + 22) !== uncompressedSize
      || archive.readUInt32LE(localOffset + 14) !== archive.readUInt32LE(offset + 16))) {
      throw new CatalogZipIssue({ ruleId: "archive_invalid" });
    }

    if (validated.directory) {
      if (uncompressedSize !== 0 || compressedSize !== 0) {
        throw new CatalogZipIssue({ ruleId: "archive_invalid", path: validated.name });
      }
    } else {
      totalCompressed += compressedSize;
      if (totalCompressed > MAX_ARCHIVE_BYTES) throw new CatalogZipIssue({ ruleId: "archive_size" });
      if (uncompressedSize > MAX_FILE_BYTES) {
        throw new CatalogZipIssue({ ruleId: "archive_file_size", path: validated.name });
      }
      totalUncompressed += uncompressedSize;
      if (totalUncompressed > MAX_ARCHIVE_BYTES) throw new CatalogZipIssue({ ruleId: "archive_size" });
    }
    entries.push({
      name: validated.name,
      directory: validated.directory,
      uncompressedSize,
      executable: !validated.directory && (unixMode & 0o111) !== 0,
      method,
      dataStart: localNameEnd + localExtraLength,
      dataEnd: compressedEnd,
    });
    offset = end;
  }
  if (offset !== centralOffset + centralSize) throw new CatalogZipIssue({ ruleId: "archive_invalid" });

  const files = new Map<string, Buffer>();
  let actualTotal = 0;
  const regularEntries = entries.filter((entry) => !entry.directory);
  for (const entry of regularEntries) {
    const compressed = archive.subarray(entry.dataStart, entry.dataEnd);
    let contents: Buffer;
    try {
      // zlib measures actual output and throws at this bound instead of truncating to a ZIP
      // declaration. The extra byte lets us detect underdeclared output, including empty files.
      contents = entry.method === 0 ? compressed : inflateRawSync(compressed, {
        maxOutputLength: Math.min(entry.uncompressedSize, MAX_FILE_BYTES) + 1,
      });
    } catch {
      throw new CatalogZipIssue({ ruleId: "archive_invalid", path: entry.name });
    }
    if (contents.byteLength !== entry.uncompressedSize) {
      throw new CatalogZipIssue({ ruleId: "archive_invalid" });
    }
    actualTotal += contents.byteLength;
    if (contents.byteLength > MAX_FILE_BYTES) {
      throw new CatalogZipIssue({ ruleId: "archive_file_size", path: entry.name });
    }
    if (actualTotal > MAX_ARCHIVE_BYTES) throw new CatalogZipIssue({ ruleId: "archive_size" });
    files.set(entry.name, Buffer.from(contents));
  }
  if (files.size !== regularEntries.length) {
    throw new CatalogZipIssue({ ruleId: "archive_invalid" });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries, files };
}

function checkLicenseFiles(
  files: Map<string, Buffer>,
  selectedSkillPath: string,
  declaredLicense: string | undefined,
  addFinding: (ruleId: string, severity: CatalogFinding["severity"], path?: string, line?: number) => void,
): void {
  if (!declaredLicense) return;
  const packageRoot = selectedSkillPath.includes("/")
    ? selectedSkillPath.slice(0, selectedSkillPath.lastIndexOf("/") + 1)
    : "";
  for (const [path, bytes] of files) {
    if (!path.startsWith(packageRoot)) continue;
    const relative = path.slice(packageRoot.length);
    if (relative.includes("/")) continue;
    const basename = relative.toLowerCase();
    if (basename !== "license" && basename !== "license.txt" && basename !== "license.md") continue;
    const source = bytes.toString("latin1");
    const saysMit = /\bMIT License\b|Permission is hereby granted, free of charge/i.test(source);
    const saysApache = /\bApache License\b|\bApache-2\.0\b/i.test(source);
    if ((declaredLicense === "MIT" && saysApache && !saysMit) || (declaredLicense === "Apache-2.0" && saysMit && !saysApache)) {
      addFinding("license_contradiction", BLOCKING, path, lineForKey(source, /\b(?:MIT|Apache)\b/i));
    }
  }
}

interface SecurityRule {
  id: string;
  expression: RegExp;
}

const SECURITY_RULES: readonly SecurityRule[] = [
  { id: "secret_aws", expression: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: "secret_github", expression: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  { id: "secret_pem_private_key", expression: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/ },
  { id: "secret_slack", expression: /\b(?:xox[baprs]-[A-Za-z0-9-]{10,}|xapp-\d+-[A-Za-z0-9-]{10,})\b|https?:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,}\/B[A-Z0-9]{8,}\/[A-Za-z0-9]{16,}/ },
  { id: "secret_stripe", expression: /\b(?:(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,})\b/ },
  { id: "shell_pipe", expression: /\b(?:curl|wget)\b[\s\S]{0,500}?\|\s*(?:env\s+)?(?:[A-Za-z0-9._/-]*\/)?(?:sh|bash|zsh|dash)\b/i },
  { id: "base64_decode_exec", expression: /(?:\bbase64\b[\s\S]{0,300}?(?:-d|--decode)\b[\s\S]{0,300}?(?:\|\s*|&&?\s*|;\s*|\$\(\s*)(?:env\s+)?(?:[A-Za-z0-9._/-]*\/)?(?:sh|bash|zsh|dash|python|node|perl|ruby)\b|\b(?:eval|sh|bash|zsh|dash|python|node|perl|ruby)\b[^\r\n]{0,300}?\bbase64\b[\s\S]{0,300}?(?:-d|--decode)\b)/i },
  { id: "base64_decode_exec", expression: /\b(?:exec|eval|Function|os\.system|subprocess\.(?:run|call|Popen))\s*\([\s\S]{0,300}?(?:(?:\b(?:base64\.)?b64decode|\batob)\s*\(|\bBuffer\.from\s*\([^\r\n)]{0,300}?["']base64["'])/ },
  { id: "url_shortener", expression: /https?:\/\/(?:www\.)?(?:bit\.ly|bitly\.com|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rb\.gy|shorturl\.at|tiny\.cc|lnkd\.in)(?::\d+)?(?:[/?#]|\s|$)/i },
];

const HIGH_ENTROPY_ASSIGNMENT = /(?:^|[^A-Za-z0-9_])["'`]?(?:[A-Za-z0-9_.-]*(?:api[_-]?key|secret(?:[_-]?access[_-]?key)?|client[_-]?secret|access[_-]?token)[A-Za-z0-9_.-]*)["'`]?\s*[:=]\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|`([^`\r\n]+)`|([A-Za-z0-9+/_\-.=]+))/gi;
const JWT_RE = /\b(eyJ[A-Za-z0-9_-]{5,})\.([A-Za-z0-9_-]{5,})\.([A-Za-z0-9_-]{5,})\b/g;
const INSTALL_PUBLIC_RE = /\binstall\b[^\r\n]{0,240}?--public(?:=|\s+)["'`]?([A-Za-z0-9][A-Za-z0-9._-]{7,})["'`]?(?=\s|$|[^A-Za-z0-9])/gi;
const SHARE_TOKEN_PLACEHOLDER_RE = /^(?:token|share[-_ ]?token|your[-_ ]?(?:share[-_ ]?)?token|public[-_ ]?token)$/i;

function findJwt(source: string): RegExpExecArray | null {
  JWT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = JWT_RE.exec(source)) !== null) {
    const encodedHeader = match[1];
    const encodedPayload = match[2];
    if (!encodedHeader || !encodedPayload) continue;
    try {
      const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
      const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
      if (Object.prototype.toString.call(header) === "[object Object]"
        && Object.prototype.toString.call(payload) === "[object Object]") return match;
    } catch {
      // A three-segment string is not enough to be a JWT; continue scanning for a valid token.
    }
  }
  return null;
}

function highEntropyValue(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length < 20 || normalized.length > 4096) return false;
  if (
    /^(?:change[-_ ]?me|placeholder|dummy|redacted|null|undefined|replace[-_ ]?me)$/i.test(normalized)
    || /^(?:example-api-key-placeholder|example[-_ ]?(?:secret|token|api[-_ ]?key)[-_ ]?placeholder)$/i.test(normalized)
    || /^(?:your[-_ ]?(?:api[-_ ]?key|secret|token)|process\.env(?:\.[A-Za-z_][A-Za-z0-9_]*|\[[A-Za-z_][A-Za-z0-9_]*\]))$/i.test(normalized)
    || /^\$\{[^}\r\n]+\}$/.test(normalized)
    || /^<[^>]+>$/.test(normalized)
  ) return false;
  const counts = new Map<string, number>();
  for (const character of normalized) counts.set(character, (counts.get(character) ?? 0) + 1);
  if (counts.size < 8) return false;
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / normalized.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy >= 3.1;
}

function findPublicInstallToken(source: string): RegExpExecArray | null {
  INSTALL_PUBLIC_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INSTALL_PUBLIC_RE.exec(source)) !== null) {
    const token = match[1] ?? "";
    if (!SHARE_TOKEN_PLACEHOLDER_RE.test(token)) return match;
  }
  return null;
}

function scanEntry(
  entry: CatalogZipEntry,
  bytes: Buffer,
  source: string,
  shareToken: string | null | undefined,
  addFinding: (ruleId: string, severity: CatalogFinding["severity"], path?: string, line?: number) => void,
): void {
  const path = entry.name;
  const sourceForScan = `${path}\n${source}`;

  if (entry.executable) addFinding("archive_executable", BLOCKING, path);
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    addFinding("binary_elf", BLOCKING, path);
  }
  if (
    bytes.length >= 4 && (
      bytes.subarray(0, 4).equals(Buffer.from([0xfe, 0xed, 0xfa, 0xce])) ||
      bytes.subarray(0, 4).equals(Buffer.from([0xce, 0xfa, 0xed, 0xfe])) ||
      bytes.subarray(0, 4).equals(Buffer.from([0xfe, 0xed, 0xfa, 0xcf])) ||
      bytes.subarray(0, 4).equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe])) ||
      bytes.subarray(0, 4).equals(Buffer.from([0xca, 0xfe, 0xba, 0xbe])) ||
      bytes.subarray(0, 4).equals(Buffer.from([0xbe, 0xba, 0xfe, 0xca])) ||
      bytes.subarray(0, 4).equals(Buffer.from([0xca, 0xfe, 0xba, 0xbf])) ||
      bytes.subarray(0, 4).equals(Buffer.from([0xbf, 0xba, 0xfe, 0xca]))
    )
  ) addFinding("binary_macho", BLOCKING, path);
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) addFinding("binary_pe", BLOCKING, path);

  for (const rule of SECURITY_RULES) {
    const match = rule.expression.exec(sourceForScan);
    if (!match) continue;
    addFinding(rule.id, BLOCKING, path, sourceLine(source, match.index, path));
  }
  const jwt = findJwt(sourceForScan);
  if (jwt) {
    addFinding("secret_jwt", BLOCKING, path, sourceLine(source, jwt.index, path));
  }

  HIGH_ENTROPY_ASSIGNMENT.lastIndex = 0;
  let assignment: RegExpExecArray | null;
  while ((assignment = HIGH_ENTROPY_ASSIGNMENT.exec(sourceForScan)) !== null) {
    const value = assignment.slice(1).find((candidate): candidate is string => candidate !== undefined) ?? "";
    if (highEntropyValue(value)) {
      addFinding("secret_high_entropy_assignment", BLOCKING, path, sourceLine(source, assignment.index, path));
      break;
    }
  }

  const exactShareToken = shareToken?.trim();
  const exactOffset = exactShareToken ? sourceForScan.indexOf(exactShareToken) : -1;
  const shareMatch = SHARE_URL_RE.exec(sourceForScan);
  const installMatch = findPublicInstallToken(sourceForScan);
  const offsets = [exactOffset, shareMatch?.index ?? -1, installMatch?.index ?? -1].filter(offset => offset >= 0);
  if (offsets.length) {
    addFinding("share_token_exposure", BLOCKING, path, sourceLine(source, Math.min(...offsets), path));
  }

}

function sourceLine(source: string, offset: number, path: string): number | undefined {
  // A match in the filename has no file-content line; do not invent line 1 for it.
  return offset < path.length ? undefined : lineAt(source, Math.max(0, offset - path.length - 1));
}

function redactPath(path: string, shareToken?: string | null): string {
  // A PEM-shaped filename may contain key material after the marker, including separators.
  if (/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/i.test(path)) return "[REDACTED]";
  let redacted = path;
  if (shareToken) redacted = redacted.split(shareToken).join("[REDACTED]");
  redacted = redacted.replace(
    /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|(?:AKIA|ASIA)[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|xapp-\d+-[A-Za-z0-9-]{10,}|https?:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,}\/B[A-Z0-9]{8,}\/[A-Za-z0-9]{16,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}|[0-9a-f]{16}(?:[0-9a-f]{16})?/gi,
    "[REDACTED]",
  );
  // Assignment values can span path separators and include variable-name suffixes. Redact the
  // entire remainder rather than retaining any portion of an apparent credential in the report.
  return redacted.replace(
    /([A-Za-z0-9_.-]*(?:api[_-]?key|secret|client[_-]?secret|access[_-]?token)[A-Za-z0-9_.-]*["'`]?\s*[:=])[\s\S]*/gi,
    "$1[REDACTED]",
  );
}
