#!/usr/bin/env bash

set -euo pipefail

release_type="patch"
version=""

usage() {
  cat <<'EOF'
Usage:
  ./scripts/release.sh [patch|minor|major]
  ./scripts/release.sh --version <x.y.z>

Options:
  --version, -v   Set an explicit version (for example: 1.2.3)
  --help, -h      Show this help message

Behavior:
  1) Bump package.json version (without npm git tag)
  2) Compile extension
  3) Package VSIX
  4) Create git annotated tag: v<version>
EOF
}

run_step() {
  echo "> $*"
  "$@"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    patch|minor|major)
      release_type="$1"
      shift
      ;;
    --version|-v)
      if [[ $# -lt 2 ]]; then
        echo "Error: --version requires a value." >&2
        exit 1
      fi
      version="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Error: unsupported argument '$1'." >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -n "$version" && "$release_type" != "patch" ]]; then
  echo "Error: use either release type or --version, not both." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ ! -f package.json ]]; then
  echo "Error: package.json not found. Run this script inside the extension repository." >&2
  exit 1
fi

if [[ -n "$version" ]]; then
  run_step npm version "$version" --no-git-tag-version
else
  run_step npm version "$release_type" --no-git-tag-version
fi

run_step npm run compile
run_step npx @vscode/vsce package

package_name="$(node -p "require('./package.json').name")"
package_version="$(node -p "require('./package.json').version")"

if [[ -z "$package_name" || -z "$package_version" ]]; then
  echo "Error: failed to read package name/version from package.json." >&2
  exit 1
fi

vsix_name="${package_name}-${package_version}.vsix"
vsix_path="${repo_root}/${vsix_name}"
if [[ ! -f "$vsix_path" ]]; then
  echo "Error: expected VSIX not found: $vsix_path" >&2
  exit 1
fi

tag_name="v${package_version}"
if git rev-parse -q --verify "refs/tags/${tag_name}" >/dev/null; then
  echo "Error: tag already exists: ${tag_name}" >&2
  exit 1
fi

run_step git tag -a "$tag_name" -m "release $tag_name"

echo "Tag created: $tag_name"
echo "Package completed: version $package_version"
echo "VSIX: $vsix_path"
