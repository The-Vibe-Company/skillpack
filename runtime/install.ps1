param(
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$releaseVersion = "__SKILLPACK_RELEASE_VERSION__"

function Stop-Install([string]$Message) {
  throw "skillpack installer: $Message"
}

if ([string]::IsNullOrEmpty($Version)) {
  if (-not [string]::IsNullOrEmpty($env:SKILLPACK_VERSION)) { $Version = $env:SKILLPACK_VERSION }
  else { $Version = $releaseVersion }
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { Stop-Install "invalid release version" }

function Get-PinnedHash([string]$Target) {
  switch ($Target) {
    # __SKILLPACK_PINNED_HASH_SWITCH__
    default { Stop-Install "release has no pinned checksum for $Target" }
  }
}

function Get-Target() {
  $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  switch ($architecture.ToUpperInvariant()) {
    "AMD64" { return "windows_amd64" }
    "ARM64" { return "windows_arm64" }
    default { Stop-Install "unsupported host architecture: $architecture" }
  }
}

function Assert-ReleaseUrl([string]$Url) {
  try { $uri = [Uri]$Url } catch { Stop-Install "release download URL is invalid" }
  if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne "https" -or [string]::IsNullOrEmpty($uri.Host)) {
    Stop-Install "release downloads require HTTPS"
  }
  if (-not [string]::IsNullOrEmpty($uri.UserInfo)) {
    Stop-Install "release download URL must not contain credentials"
  }
  return $uri
}

function Download-Release([string]$Url, [string]$Destination) {
  $current = Assert-ReleaseUrl $Url
  $maxRedirects = 5
  $redirects = 0
  Add-Type -AssemblyName System.Net.Http
  $handler = New-Object -TypeName System.Net.Http.HttpClientHandler
  $handler.AllowAutoRedirect = $false
  $client = $null
  try {
    $client = New-Object -TypeName System.Net.Http.HttpClient -ArgumentList $handler
    while ($true) {
      $request = $null
      $response = $null
      try {
        $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $current)
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $status = [int]$response.StatusCode
        if (@(301, 302, 303, 307, 308) -contains $status) {
          if ($redirects -ge $maxRedirects) { Stop-Install "too many release download redirects" }
          $location = $response.Headers.Location
          if ($null -eq $location) { Stop-Install "release download redirect has no location" }
          $next = if ($location.IsAbsoluteUri) { $location } else { [Uri]::new($current, $location) }
          $current = Assert-ReleaseUrl $next.AbsoluteUri
          $redirects++
          continue
        }
        if (-not $response.IsSuccessStatusCode) { Stop-Install "release download returned HTTP $status" }
        $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        [IO.File]::WriteAllBytes($Destination, $bytes)
        return
      } finally {
        if ($null -ne $response) { $response.Dispose() }
        if ($null -ne $request) { $request.Dispose() }
      }
    }
  } catch [System.Net.Http.HttpRequestException] {
    Stop-Install "release download failed"
  } finally {
    if ($null -ne $client) { $client.Dispose() }
    $handler.Dispose()
  }
}

function Assert-NoReparseAncestors([string]$Path) {
  try { $current = [IO.Path]::GetFullPath($Path) } catch { Stop-Install "invalid managed path: $Path" }
  while ($true) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        Stop-Install "refusing a reparse point in managed path: $current"
      }
    }
    $parent = [IO.Directory]::GetParent($current)
    if ($null -eq $parent -or $parent.FullName -eq $current) { break }
    $current = $parent.FullName
  }
}

function Protect-PrivatePath([string]$Path, [bool]$Directory) {
  $principal = if ($env:USERDOMAIN -and $env:USERNAME) { "$($env:USERDOMAIN)\$($env:USERNAME)" } else { $env:USERNAME }
  if ([string]::IsNullOrWhiteSpace($principal)) { Stop-Install "cannot determine the Windows user for private ACLs" }
  $grant = if ($Directory) { "{0}:(OI)(CI)F" -f $principal } else { "{0}:F" -f $principal }
  & icacls.exe $Path /inheritance:r /grant:r $grant *> $null
  if ($LASTEXITCODE -ne 0) { Stop-Install "cannot set private ACLs on $Path" }
}

function Assert-ManagedLauncher([string]$Stable, [string]$Versions, [string]$ReceiptPath) {
  if (-not (Test-Path -LiteralPath $ReceiptPath -PathType Leaf)) {
    Stop-Install "managed launcher has no private installation receipt"
  }
  $receiptItem = Get-Item -LiteralPath $ReceiptPath -Force
  if (($receiptItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    Stop-Install "installation receipt must not be a reparse point"
  }
  try {
    $receipt = Get-Content -LiteralPath $ReceiptPath -Raw | ConvertFrom-Json
  } catch {
    Stop-Install "installation receipt is not valid JSON"
  }
  if ([string]$receipt.executablePath -ne $Stable) { Stop-Install "installation receipt does not own the launcher" }
  $oldBinary = [string]$receipt.binaryPath
  $versionsPrefix = ([IO.Path]::GetFullPath($Versions)).TrimEnd('\') + '\'
  if (-not [IO.Path]::GetFullPath($oldBinary).StartsWith($versionsPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    Stop-Install "installation receipt points outside managed versions"
  }
  if (-not (Test-Path -LiteralPath $oldBinary -PathType Leaf)) { Stop-Install "installation receipt points to a missing managed binary" }
  if (-not (Test-Path -LiteralPath $Stable -PathType Leaf)) { Stop-Install "managed launcher is not a regular file" }
  $oldBinaryItem = Get-Item -LiteralPath $oldBinary -Force
  if (($oldBinaryItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    Stop-Install "managed binary must not be a reparse point"
  }
  $stableItem = Get-Item -LiteralPath $Stable -Force
  if (($stableItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    Stop-Install "stable launcher must not be a reparse point"
  }
  $stableHash = (Get-FileHash -LiteralPath $Stable -Algorithm SHA256).Hash
  if ($receipt.binarySha256) {
    if ($stableHash -ne ([string]$receipt.binarySha256).ToUpperInvariant()) { Stop-Install "managed launcher checksum differs from its receipt" }
  } elseif ($stableHash -ne (Get-FileHash -LiteralPath $oldBinary -Algorithm SHA256).Hash) {
    Stop-Install "managed launcher does not match its receipt"
  }
}

function Assert-ArchiveEntries([string]$Directory) {
  $allowed = @("skillpack.exe", "skillpack-runtime.exe", "LICENSE", "NOTICE", "SOURCE.json")
  foreach ($entry in @(Get-ChildItem -LiteralPath $Directory -Force)) {
    if ($entry.PSIsContainer -or $entry.LinkType -or $allowed -notcontains $entry.Name) {
      Stop-Install "unsafe runtime archive entry: $($entry.Name)"
    }
  }
  foreach ($required in @("skillpack.exe", "skillpack-runtime.exe")) {
    $path = Join-Path $Directory $required
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Stop-Install "runtime archive is missing $required" }
  }
}

function Assert-ZipEntries([string]$Archive) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $allowed = @("skillpack.exe", "skillpack-runtime.exe", "LICENSE", "NOTICE", "SOURCE.json")
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'
  $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    foreach ($entry in $zip.Entries) {
      if ($entry.FullName.EndsWith('/') -or $allowed -notcontains $entry.FullName -or -not $seen.Add($entry.FullName)) {
        Stop-Install "unsafe or duplicate runtime archive entry: $($entry.FullName)"
      }
    }
  } finally {
    $zip.Dispose()
  }
}

$target = Get-Target
$base = if ($env:SKILLPACK_RELEASE_BASE_URL) { $env:SKILLPACK_RELEASE_BASE_URL } else { "https://github.com/The-Vibe-Company/skillpack/releases/download/runtime-v$Version" }
if ($base -notmatch '^https://') { Stop-Install "release downloads require HTTPS" }
$archiveName = "skillpack-runtime_${Version}_${target}.zip"
$expected = Get-PinnedHash $target
if ($expected -notmatch '^[0-9a-fA-F]{64}$') { Stop-Install "invalid pinned checksum" }

$temporary = Join-Path ([IO.Path]::GetTempPath()) ("skillpack-install-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  $archive = Join-Path $temporary $archiveName
  $sumsPath = Join-Path $temporary "SHA256SUMS"
  Download-Release "$base/$archiveName" $archive
  Download-Release "$base/SHA256SUMS" $sumsPath
  $published = $null
  foreach ($line in @(Get-Content -LiteralPath $sumsPath)) {
    $parts = $line -split '\s+', 2
    if ($parts.Count -eq 2 -and ($parts[1] -eq $archiveName -or $parts[1] -eq "*$archiveName")) {
      $published = $parts[0]
      break
    }
  }
  if ($published -ne $expected) { Stop-Install "published checksum is not the pinned checksum" }
  $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected.ToLowerInvariant()) { Stop-Install "checksum mismatch for $archiveName" }

  Assert-ZipEntries $archive
  $stage = Join-Path $temporary "stage"
  Expand-Archive -LiteralPath $archive -DestinationPath $stage
  Assert-ArchiveEntries $stage
  $runtime = Join-Path $stage "skillpack-runtime.exe"
  $cli = Join-Path $stage "skillpack.exe"
  $runtimeVersion = (& $runtime --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $runtimeVersion -ne "skillpack-runtime $Version") { Stop-Install "runtime version self-test failed" }
  $cliVersion = (& $cli --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $cliVersion -ne "skillpack $Version") { Stop-Install "CLI version self-test failed" }
  & $cli --help *> $null
  if ($LASTEXITCODE -ne 0) { Stop-Install "CLI help self-test failed" }

  $stateRoot = if ($env:SKILLPACK_HOME) { $env:SKILLPACK_HOME } else { Join-Path $env:APPDATA "skillpack" }
  try { $stateRoot = [IO.Path]::GetFullPath($stateRoot) } catch { Stop-Install "invalid managed state path" }
  $cliRoot = Join-Path $stateRoot "cli"
  $versions = Join-Path $cliRoot "versions"
  $stableDirectory = Join-Path $env:LOCALAPPDATA "Skillpack\bin"
  $stable = Join-Path $stableDirectory "skillpack.exe"
  $receiptPath = Join-Path $cliRoot "install.json"

  # Check every existing ancestor before creating anything. A junction or other
  # reparse point here could redirect the install outside the user's state root.
  foreach ($managedPath in @($stateRoot, $cliRoot, $versions, $stableDirectory, $receiptPath, $stable)) {
    Assert-NoReparseAncestors $managedPath
  }
  New-Item -ItemType Directory -Force -Path $versions | Out-Null
  Assert-NoReparseAncestors $stateRoot
  Assert-NoReparseAncestors $cliRoot
  Assert-NoReparseAncestors $versions
  Protect-PrivatePath $stateRoot $true
  Protect-PrivatePath $cliRoot $true
  Protect-PrivatePath $versions $true
  New-Item -ItemType Directory -Force -Path $stableDirectory | Out-Null
  Assert-NoReparseAncestors $stableDirectory
  Protect-PrivatePath $stableDirectory $true

  # Validate ownership before staging or replacing a stable launcher. An
  # existing receipt and binary must prove that this installer owns the path.
  if (Test-Path -LiteralPath $stable) {
    Assert-ManagedLauncher $stable $versions $receiptPath
  } elseif (Test-Path -LiteralPath $receiptPath) {
    Stop-Install "installation receipt exists without its managed launcher"
  }
  if (Test-Path -LiteralPath $receiptPath -PathType Container) {
    Stop-Install "installation receipt path is a directory"
  }

  $versionDirectory = Join-Path $versions $Version
  Assert-NoReparseAncestors $versionDirectory
  if (Test-Path -LiteralPath $versionDirectory) {
    if (-not (Get-Item -LiteralPath $versionDirectory).PSIsContainer) { Stop-Install "managed version slot is not a directory" }
    foreach ($name in @("skillpack.exe", "skillpack-runtime.exe")) {
      $installed = Join-Path $versionDirectory $name
      $source = Join-Path $stage $name
      Assert-NoReparseAncestors $installed
      if (-not (Test-Path -LiteralPath $installed -PathType Leaf) -or
          (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash) {
        Stop-Install "managed version slot differs"
      }
    }
  } else {
    $slot = Join-Path $versions (".staged-" + [Guid]::NewGuid().ToString("N"))
    Assert-NoReparseAncestors $slot
    New-Item -ItemType Directory -Path $slot | Out-Null
    Copy-Item -LiteralPath (Join-Path $stage "skillpack.exe") -Destination (Join-Path $slot "skillpack.exe")
    Copy-Item -LiteralPath (Join-Path $stage "skillpack-runtime.exe") -Destination (Join-Path $slot "skillpack-runtime.exe")
    Move-Item -LiteralPath $slot -Destination $versionDirectory
    Assert-NoReparseAncestors $versionDirectory
  }

  $executable = Join-Path $versionDirectory "skillpack.exe"
  $runtimeExecutable = Join-Path $versionDirectory "skillpack-runtime.exe"
  $receiptTemporary = Join-Path $cliRoot (".install-" + [Guid]::NewGuid().ToString("N") + ".json")
  $stableTemporary = Join-Path $stableDirectory (".skillpack-" + [Guid]::NewGuid().ToString("N") + ".exe")
  $oldStableBackup = Join-Path $temporary "stable.previous.exe"
  $oldReceiptBackup = Join-Path $temporary "receipt.previous.json"
  $hadStable = Test-Path -LiteralPath $stable -PathType Leaf
  $hadReceipt = Test-Path -LiteralPath $receiptPath -PathType Leaf
  if ($hadStable) { Copy-Item -LiteralPath $stable -Destination $oldStableBackup }
  if ($hadReceipt) { Copy-Item -LiteralPath $receiptPath -Destination $oldReceiptBackup }
  try {
    Copy-Item -LiteralPath $executable -Destination $stableTemporary
    Move-Item -LiteralPath $stableTemporary -Destination $stable -Force

    $binaryHash = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
    $receipt = [ordered]@{ schemaVersion = 1; version = $Version; executablePath = $stable; binaryPath = $executable; runtimeExecutablePath = $runtimeExecutable; binarySha256 = $binaryHash; channel = "stable"; releaseUrl = $base } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($receiptTemporary, $receipt + [Environment]::NewLine)
    Move-Item -LiteralPath $receiptTemporary -Destination $receiptPath -Force
    Protect-PrivatePath $receiptPath $false
  } catch {
    if (Test-Path -LiteralPath $stableTemporary) { Remove-Item -LiteralPath $stableTemporary -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $stable) { Remove-Item -LiteralPath $stable -Force -ErrorAction SilentlyContinue }
    if ($hadStable -and (Test-Path -LiteralPath $oldStableBackup -PathType Leaf)) {
      Copy-Item -LiteralPath $oldStableBackup -Destination $stable -Force
    }
    if (Test-Path -LiteralPath $receiptTemporary) { Remove-Item -LiteralPath $receiptTemporary -Force -ErrorAction SilentlyContinue }
    if ($hadReceipt -and (Test-Path -LiteralPath $oldReceiptBackup -PathType Leaf)) {
      Copy-Item -LiteralPath $oldReceiptBackup -Destination $receiptPath -Force
    } elseif (Test-Path -LiteralPath $receiptPath) {
      Remove-Item -LiteralPath $receiptPath -Force -ErrorAction SilentlyContinue
    }
    throw
  }
  Write-Output "Installed skillpack $Version to $executable"
} finally {
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue }
}
