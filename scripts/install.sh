#!/usr/bin/env sh
set -eu

PACKAGE_SPEC="${PACKAGE_SPEC:-quang-mcp-google}"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node.js first: https://nodejs.org/" >&2
  exit 1
fi

echo "Installing ${PACKAGE_SPEC} globally..." >&2
npm install -g "${PACKAGE_SPEC}"

echo >&2
echo "Running setup..." >&2
kozocom-mcp setup "$@"
