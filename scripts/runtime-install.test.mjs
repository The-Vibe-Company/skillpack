import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";

const shellPath = new URL("../runtime/install.sh", import.meta.url);
const powershellPath = new URL("../runtime/install.ps1", import.meta.url);

test("native installers contain no interpreter dependency and use managed version slots", () => {
  const shell = readFileSync(shellPath, "utf8");
  const powershell = readFileSync(powershellPath, "utf8");
  for (const source of [shell, powershell]) {
    assert.doesNotMatch(source, /\b(?:python|node)(?:\.exe)?\b/i);
    assert.match(source, /SHA256|sha256/i);
    assert.match(source, /skillpack-runtime/);
    assert.match(source, /install\.json/);
    assert.match(source, /executablePath/);
    assert.match(source, /binaryPath/);
    assert.match(source, /versions/);
  }
  assert.match(shell, /Library\/Application Support\/skillpack/);
  assert.match(shell, /\.local\/bin/);
  assert.match(shell, /executablePath.*escaped_launcher/);
  assert.match(powershell, /LOCALAPPDATA/);
  assert.match(powershell, /executablePath = \$stable/);
  assert.match(powershell, /Get-FileHash/);
  assert.match(powershell, /Expand-Archive/);
  assert.match(powershell, /-LiteralPath/);
  assert.match(powershell, /Assert-ZipEntries/);
  assert.match(powershell, /HashSet/);
  assert.match(shell, /__SKILLPACK_PINNED_HASH_CASES__/);
  assert.match(powershell, /__SKILLPACK_PINNED_HASH_SWITCH__/);
});

test("POSIX installer exposes a checksum gate that fails closed", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "skillpack-install-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const payload = join(directory, "archive.tar.gz");
  writeFileSync(payload, "archive bytes");
  const checksum = createHash("sha256").update("archive bytes").digest("hex");
  const source = shellPath.pathname;
  const invoke = (expected) => execFileSync("/bin/sh", ["-c", `SKILLPACK_INSTALL_SOURCE_ONLY=1 . "$1"; verify_sha256 "$2" "$3"`, "installer-test", source, payload, expected], { encoding: "utf8" });
  assert.equal(invoke(checksum), "");
  assert.throws(() => invoke("0".repeat(64)), /checksum|exit status/);
});

test("POSIX installer rejects symlinked managed ancestors", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "skillpack-install-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const realRoot = join(directory, "real");
  const redirectedRoot = join(directory, "state");
  mkdirSync(realRoot);
  symlinkSync(realRoot, redirectedRoot);
  const source = shellPath.pathname;
  const managedPath = join(redirectedRoot, "cli", "versions");
  assert.throws(
    () => execFileSync("/bin/sh", ["-c", `SKILLPACK_INSTALL_SOURCE_ONLY=1 . "$1"; assert_no_symlink_ancestors "$2"`, "installer-test", source, managedPath], { encoding: "utf8" }),
    /symlink|exit status/,
  );
});

test("POSIX installer accepts an older managed launcher and rejects an unmanaged collision", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "skillpack-install-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const versions = join(directory, "versions");
  const bin = join(directory, "bin");
  mkdirSync(versions, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const oldBinary = join(versions, "0.1.0", "skillpack");
  mkdirSync(join(versions, "0.1.0"));
  writeFileSync(oldBinary, "older managed binary");
  const launcher = join(bin, "skillpack");
  symlinkSync(oldBinary, launcher);
  const receipt = join(directory, "install.json");
  const oldHash = createHash("sha256").update("older managed binary").digest("hex");
  writeFileSync(receipt, JSON.stringify({ executablePath: launcher, binaryPath: oldBinary, binarySha256: oldHash }));
  const source = shellPath.pathname;
  const invoke = () => execFileSync(
    "/bin/sh",
    ["-c", `SKILLPACK_INSTALL_SOURCE_ONLY=1 . "$1"; validate_existing_launcher "$2" "$3" "$4"`, "installer-test", source, launcher, versions, receipt],
    { encoding: "utf8" },
  );
  assert.equal(invoke(), "");
  rmSync(launcher);
  writeFileSync(launcher, "unmanaged binary");
  assert.throws(invoke, /unmanaged launcher|exit status/);
});

test("installers validate ownership before receipt replacement and activate before receipt commit", () => {
  const shell = readFileSync(shellPath, "utf8");
  const powershell = readFileSync(powershellPath, "utf8");
  assert.match(shell, /validate_existing_launcher/);
  assert.match(shell, /binarySha256/);
  assert.match(shell, /assert_no_symlink_ancestors "\$versions"/);
  assert.ok(shell.indexOf('validate_existing_launcher "$launcher"') < shell.indexOf('mv -f "$link_tmp" "$launcher"'));
  assert.ok(shell.indexOf('mv -f "$link_tmp" "$launcher"') < shell.indexOf('mv "$receipt_tmp" "$receipt"'));
  assert.match(powershell, /Assert-ManagedLauncher/);
  assert.match(powershell, /Assert-NoReparseAncestors/);
  assert.match(powershell, /Protect-PrivatePath/);
  assert.match(powershell, /binarySha256/);
  assert.ok(powershell.indexOf('Assert-ManagedLauncher $stable $versions $receiptPath') < powershell.indexOf('Move-Item -LiteralPath $stableTemporary -Destination $stable -Force'));
  assert.ok(powershell.indexOf('Move-Item -LiteralPath $stableTemporary -Destination $stable -Force') < powershell.indexOf('Move-Item -LiteralPath $receiptTemporary -Destination $receiptPath -Force'));
});

test("PowerShell release downloads use bounded HTTPS-only redirects", () => {
  const powershell = readFileSync(powershellPath, "utf8");
  const downloadStart = powershell.indexOf("function Download-Release");
  const downloadEnd = powershell.indexOf("\nfunction Assert-NoReparseAncestors", downloadStart);
  assert.ok(downloadStart >= 0 && downloadEnd > downloadStart);
  const download = powershell.slice(downloadStart, downloadEnd);
  assert.doesNotMatch(powershell, /\bInvoke-WebRequest\b/);
  assert.match(powershell, /function Assert-ReleaseUrl/);
  assert.match(powershell, /UserInfo/);
  assert.match(download, /HttpClientHandler/);
  assert.match(download, /AllowAutoRedirect\s*=\s*\$false/);
  assert.match(download, /\$maxRedirects\s*=\s*5/);
  assert.match(download, /\$redirects\s*-ge\s*\$maxRedirects/);
  assert.match(download, /\$response\.Headers\.Location/);
  assert.match(download, /@\(301, 302, 303, 307, 308\)/);
  assert.match(download, /Assert-ReleaseUrl \$next\.AbsoluteUri/);
  assert.ok(download.indexOf("Assert-ReleaseUrl $Url") < download.indexOf("SendAsync"));
  assert.ok(download.indexOf("$response.Dispose()") < download.indexOf("$client.Dispose()"));
  assert.ok(download.indexOf("$request.Dispose()") < download.indexOf("$client.Dispose()"));
  assert.match(download, /\$client\.Dispose\(\)/);
  assert.match(download, /\$handler\.Dispose\(\)/);
});

test("PowerShell installer pins a per-target digest before extraction", () => {
  const powershell = readFileSync(powershellPath, "utf8");
  assert.match(powershell, /Get-PinnedHash/);
  assert.match(powershell, /Expand-Archive/);
  assert.match(powershell, /SHA256SUMS/);
  assert.match(powershell, /Copy-Item -LiteralPath/);
});
