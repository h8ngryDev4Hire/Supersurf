#!/bin/bash
# Git commit helper with checkpoint numbering
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT" || { echo "Error: Could not navigate to project root"; exit 1; }

if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "Error: Not a git repository"
  exit 1
fi

echo "Running tests..."
pnpm test || { echo "Tests failed. Aborting commit."; exit 1; }

echo "Running build..."
pnpm build || { echo "Build failed. Aborting commit."; exit 1; }

COMMIT_MSG_ARG=$1
CHECKPOINT_COUNT=$(git --no-pager log --oneline | head -1 | grep -oE '#[0-9]+' | grep -oE '[0-9]+' || echo "0")
NEXT_CHECKPOINT=$((CHECKPOINT_COUNT + 1))

git add .

if [ -z "$COMMIT_MSG_ARG" ]; then
  git commit -m "checkpoint #$NEXT_CHECKPOINT"
else
  git commit -m "checkpoint #$NEXT_CHECKPOINT - $COMMIT_MSG_ARG"
fi

git push
