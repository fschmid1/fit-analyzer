#!/usr/bin/env bash
#
# Sets up a new workspace by copying the .env file and data folder from the main
# repository. Run this script from inside the new workspace directory.
#
# Usage:
#   ./scripts/setup-workspace.sh <path-to-main-repo>
#
# Example:
#   cd /path/to/new/workspace
#   /path/to/main/repo/scripts/setup-workspace.sh /path/to/main/repo

set -euo pipefail

WORKSPACE_PATH="$(pwd)"
MAIN_REPO_PATH="${1:-}"

if [ -z "$MAIN_REPO_PATH" ]; then
	echo "Error: Main repo path not provided."
	echo "Usage: $0 <path-to-main-repo>"
	exit 1
fi

MAIN_REPO_PATH="$(realpath "$MAIN_REPO_PATH")"
WORKSPACE_PATH="$(realpath "$WORKSPACE_PATH")"

if [ "$MAIN_REPO_PATH" = "$WORKSPACE_PATH" ]; then
	echo "Already in the main repository, nothing to do."
	exit 0
fi

echo "Main repo: $MAIN_REPO_PATH"
echo "Workspace: $WORKSPACE_PATH"

# Copy .env
ENV_SRC="$MAIN_REPO_PATH/apps/server/.env"
ENV_DST="$WORKSPACE_PATH/apps/server/.env"

if [ -f "$ENV_SRC" ]; then
	mkdir -p "$(dirname "$ENV_DST")"
	cp "$ENV_SRC" "$ENV_DST"
	echo "Copied .env"
else
	echo "No .env found at $ENV_SRC, skipping."
fi

# Copy data folder
DATA_SRC="$MAIN_REPO_PATH/apps/server/data"
DATA_DST="$WORKSPACE_PATH/apps/server/data"

if [ -d "$DATA_SRC" ]; then
	mkdir -p "$(dirname "$DATA_DST")"
	cp -r "$DATA_SRC" "$DATA_DST"
	echo "Copied data folder"
else
	echo "No data folder found at $DATA_SRC, skipping."
fi

echo "Done!"
