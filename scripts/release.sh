#!/usr/bin/env bash
# Cut a new release. Bumps version, runs checks, commits, tags, and pushes.
# Pushing the v<version> tag triggers .github/workflows/publish.yml, which
# builds with the embedded OAuth client and runs `npm publish` (trusted publishing).
#
# Usage: scripts/release.sh [patch|minor|major|<exact-version>]   (default: patch)
set -euo pipefail
cd "$(dirname "$0")/.."

BUMP="${1:-patch}"

# Must be on main with a clean tree, in sync with origin.
branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = "main" ] || { echo "error: on '$branch', release from 'main'"; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "error: working tree dirty, commit or stash first"; exit 1; }
git fetch origin main --quiet
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "error: local main differs from origin/main"; exit 1; }

# Verify before bumping.
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm admin:build
pnpm build

# Bump version (no git tag yet — we tag with a leading 'v' ourselves).
version=$(npm version "$BUMP" --no-git-tag-version)   # e.g. v0.1.3
echo "Releasing $version"

git add package.json
git commit -m "${version#v}"
git tag "$version"
git push origin main "$version"

echo "Pushed $version. CI will publish to npm: https://github.com/quangtd-kozocom/terra-mcp-google/actions"
