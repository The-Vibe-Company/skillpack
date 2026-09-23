#!/bin/sh
set -eu

# This file is a release template. runtime-release.mjs replaces the two marked
# values in the versioned HTTPS asset before it is published.
RELEASE_VERSION="__SKILLPACK_RELEASE_VERSION__"

die() {
  printf '%s\n' "skillpack installer: $*" >&2
  exit 1
}

valid_version() {
  printf '%s\n' "$1" | awk -F. 'NF == 3 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ { found = 1 } END { exit found ? 0 : 1 }'
}

target_for_host() {
  system=$(uname -s)
  machine=$(uname -m)
  case "$system:$machine" in
    Darwin:x86_64) printf '%s\n' darwin_amd64 ;;
    Darwin:arm64) printf '%s\n' darwin_arm64 ;;
    Linux:x86_64) printf '%s\n' linux_amd64 ;;
    Linux:aarch64|Linux:arm64) printf '%s\n' linux_arm64 ;;
    *) die "unsupported host ($system/$machine)" ;;
  esac
}

pinned_hash() {
  case "$1" in
    # __SKILLPACK_PINNED_HASH_CASES__
    *) return 1 ;;
  esac
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -- "$1" | awk '{print $1}'
  else
    die "sha256sum or shasum is required"
  fi
}

verify_sha256() {
  file=$1
  expected=$2
  printf '%s\n' "$expected" | awk 'length == 64 && $0 ~ /^[0-9a-fA-F]+$/ { found = 1 } END { exit found ? 0 : 1 }' || die "invalid pinned checksum"
  actual=$(sha256_file "$file")
  [ "$actual" = "$expected" ] || die "checksum mismatch for $file"
}

download() {
  url=$1
  destination=$2
  case "$url" in https://*) ;; *) die "release downloads require HTTPS" ;; esac
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$url" -o "$destination" || die "download failed: $url"
}

archive_entries_are_safe() {
  archive=$1
  listing=$2
  tar -tzf "$archive" > "$listing" || die "invalid runtime archive"
  awk '
    BEGIN { valid = 1 }
    { if ($0 !~ /^(skillpack|skillpack-runtime|LICENSE|NOTICE|SOURCE[.]json)$/ || seen[$0]++) valid = 0 }
    END { exit valid ? 0 : 1 }
  ' "$listing" || die "unsafe or duplicate runtime archive entry"
}

json_escape() {
  printf '%s' "$1" | sed 's/[\\\"]/\\&/g'
}

assert_no_symlink_ancestors() {
  path=$1
  while [ "$path" != "/" ] && [ -n "$path" ]; do
    [ ! -L "$path" ] || die "refusing a symlink in managed path: $path"
    parent=$(dirname "$path")
    [ "$parent" != "$path" ] || break
    path=$parent
  done
}

json_field() {
  key=$1
  file=$2
  value=$(sed -n 's/.*"'$key'"[:][[:space:]]*"\([^"\\]*\)".*/\1/p' "$file" | head -n 1)
  [ -n "$value" ] || return 1
  printf '%s' "$value" | sed 's/\\\\/\\/g; s/\\"/"/g'
}

validate_existing_launcher() {
  launcher=$1
  versions=$2
  receipt=$3
  [ -f "$receipt" ] && [ ! -L "$receipt" ] || die "managed launcher has no private installation receipt"
  receipt_launcher=$(json_field executablePath "$receipt") || die "installation receipt is missing executablePath"
  [ "$receipt_launcher" = "$launcher" ] || die "installation receipt does not own the launcher"
  old_binary=$(json_field binaryPath "$receipt") || die "installation receipt is missing binaryPath"
  case "$old_binary" in "$versions"/*) ;; *) die "installation receipt points outside managed versions" ;; esac
  [ -f "$old_binary" ] && [ ! -L "$old_binary" ] || die "installation receipt points to a missing managed binary"
  [ -L "$launcher" ] || die "refusing to replace an unmanaged launcher"
  existing=$(readlink "$launcher")
  [ "$existing" = "$old_binary" ] || die "installation receipt does not match the launcher"
  if old_hash=$(json_field binarySha256 "$receipt"); then
    verify_sha256 "$old_binary" "$old_hash"
  fi
}

install() {
  version=${SKILLPACK_VERSION:-$RELEASE_VERSION}
  valid_version "$version" || die "invalid release version"
  target=$(target_for_host)
  archive_name="skillpack-runtime_${version}_${target}.tar.gz"
  base=${SKILLPACK_RELEASE_BASE_URL:-"https://github.com/The-Vibe-Company/skillpack/releases/download/runtime-v$version"}
  case "$base" in https://*) ;; *) die "release downloads require HTTPS" ;; esac
  expected=$(pinned_hash "$target") || die "release has no pinned checksum for $target"

  temporary=$(mktemp -d "${TMPDIR:-/tmp}/skillpack-install.XXXXXX") || die "cannot create temporary directory"
  trap 'rm -rf "$temporary"' EXIT HUP INT TERM
  archive="$temporary/$archive_name"
  sums="$temporary/SHA256SUMS"
  download "$base/$archive_name" "$archive"
  download "$base/SHA256SUMS" "$sums"
  published=$(awk -v name="$archive_name" '$2 == name || $2 == "*" name { print $1; exit }' "$sums")
  [ "$published" = "$expected" ] || die "published checksum is not the pinned checksum"
  verify_sha256 "$archive" "$expected"

  listing="$temporary/listing"
  archive_entries_are_safe "$archive" "$listing"
  stage="$temporary/stage"
  mkdir "$stage"
  tar -xzf "$archive" -C "$stage" || die "cannot extract runtime archive"
  for entry in "$stage"/*; do
    [ -e "$entry" ] || die "runtime archive is empty"
    [ -L "$entry" ] && die "runtime archive contains a symlink"
    [ -f "$entry" ] || die "runtime archive contains a non-file"
    case "$(basename "$entry")" in
      skillpack|skillpack-runtime|LICENSE|NOTICE|SOURCE.json) ;;
      *) die "unsafe extracted runtime entry" ;;
    esac
  done
  [ -f "$stage/skillpack" ] && [ -f "$stage/skillpack-runtime" ] || die "runtime archive is missing a native binary"
  [ "$("$stage/skillpack-runtime" --version 2>/dev/null)" = "skillpack-runtime $version" ] || die "runtime version self-test failed"
  [ "$("$stage/skillpack" --version 2>/dev/null)" = "skillpack $version" ] || die "CLI version self-test failed"
  "$stage/skillpack" --help >/dev/null 2>&1 || die "CLI help self-test failed"

  if [ -n "${SKILLPACK_HOME:-}" ]; then
    state_root=$SKILLPACK_HOME
  elif [ "$(uname -s)" = Darwin ]; then
    state_root="$HOME/Library/Application Support/skillpack"
  else
    state_root="${XDG_CONFIG_HOME:-$HOME/.config}/skillpack"
  fi
  case "$state_root" in /*) ;; *) state_root="$(pwd -P)/$state_root" ;; esac
  assert_no_symlink_ancestors "$state_root"
  cli_root="$state_root/cli"
  versions="$cli_root/versions"
  assert_no_symlink_ancestors "$cli_root"
  assert_no_symlink_ancestors "$versions"
  mkdir -p "$state_root" "$state_root/cli/versions"
  state_root=$(cd "$state_root" && pwd)
  cli_root="$state_root/cli"
  versions="$cli_root/versions"
  assert_no_symlink_ancestors "$cli_root"
  assert_no_symlink_ancestors "$versions"
  version_dir="$versions/$version"
  if [ -e "$version_dir" ] || [ -L "$version_dir" ]; then
    [ -d "$version_dir" ] && [ ! -L "$version_dir" ] || die "managed version slot is not a directory"
    cmp -s "$stage/skillpack" "$version_dir/skillpack" || die "managed version slot differs"
    cmp -s "$stage/skillpack-runtime" "$version_dir/skillpack-runtime" || die "managed version slot differs"
  else
    slot="$versions/.staged-$version.$$"
    (umask 077; mkdir "$slot"; cp "$stage/skillpack" "$slot/skillpack"; cp "$stage/skillpack-runtime" "$slot/skillpack-runtime"; chmod 755 "$slot/skillpack" "$slot/skillpack-runtime") || die "cannot stage managed version"
    mv "$slot" "$version_dir" || die "cannot publish managed version"
  fi

  executable="$version_dir/skillpack"
  runtime_executable="$version_dir/skillpack-runtime"
  bin_dir="$HOME/.local/bin"
  launcher="$bin_dir/skillpack"
  receipt="$cli_root/install.json"
  assert_no_symlink_ancestors "$bin_dir"
  assert_no_symlink_ancestors "$receipt"
  launcher_owned=0
  old_launcher_target=
  if [ -e "$launcher" ] || [ -L "$launcher" ]; then
    validate_existing_launcher "$launcher" "$versions" "$receipt"
    launcher_owned=1
    old_launcher_target=$(readlink "$launcher")
  elif [ -e "$receipt" ] || [ -L "$receipt" ]; then
    die "installation receipt exists without its managed launcher"
  fi

  mkdir -p "$bin_dir"
  if [ -L "$launcher" ]; then
    existing=$(readlink "$launcher")
    [ "$existing" = "$old_launcher_target" ] || die "managed launcher changed during installation"
  elif [ -e "$launcher" ]; then
    die "refusing to replace an existing launcher"
  fi
  receipt_tmp="$cli_root/.install.json.$$"
  escaped_launcher=$(json_escape "$launcher")
  escaped_executable=$(json_escape "$executable")
  escaped_runtime=$(json_escape "$runtime_executable")
  escaped_base=$(json_escape "$base")
  binary_hash=$(sha256_file "$executable")

  link_tmp="$bin_dir/.skillpack.$$"
  ln -s "$executable" "$link_tmp"
  mv -f "$link_tmp" "$launcher" || die "cannot activate managed launcher"

  rollback_launcher() {
    rm -f "$link_tmp" "$launcher" "$receipt_tmp"
    if [ "$launcher_owned" -eq 1 ]; then
      ln -s "$old_launcher_target" "$launcher" || true
    fi
  }

  if ! (umask 077; cat > "$receipt_tmp" <<EOF
{"schemaVersion":1,"version":"$version","executablePath":"$escaped_launcher","binaryPath":"$escaped_executable","runtimeExecutablePath":"$escaped_runtime","binarySha256":"$binary_hash","channel":"stable","releaseUrl":"$escaped_base"}
EOF
  ); then
    rollback_launcher
    die "cannot write installation receipt"
  fi
  if ! mv "$receipt_tmp" "$receipt"; then
    rollback_launcher
    die "cannot write installation receipt"
  fi

  printf '%s\n' "Installed skillpack $version to $executable"
}

if [ "${SKILLPACK_INSTALL_SOURCE_ONLY:-0}" != 1 ]; then
  install "$@"
fi
