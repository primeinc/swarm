#!/usr/bin/env bash
# Clean up test session files from global sessions directory
#
# Usage: ./scripts/clean-test-sessions.sh [--dry-run]

set -euo pipefail

SESSIONS_DIR="$HOME/.config/swarm-tools/sessions"
DRY_RUN=false

# Parse arguments
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# Check if sessions directory exists
if [[ ! -d "$SESSIONS_DIR" ]]; then
  echo "Sessions directory not found: $SESSIONS_DIR"
  exit 1
fi

# Count test files
test_files=$(find "$SESSIONS_DIR" -maxdepth 1 -type f \( -name "test*.jsonl" -o -name "no-context*.jsonl" -o -name "timing-test*.jsonl" \) | wc -l | tr -d ' ')

if [[ "$test_files" -eq 0 ]]; then
  echo "✓ No test session files found"
  exit 0
fi

echo "Found $test_files test session files"

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "Files that would be deleted:"
  find "$SESSIONS_DIR" -maxdepth 1 -type f \( -name "test*.jsonl" -o -name "no-context*.jsonl" -o -name "timing-test*.jsonl" \)
  echo ""
  echo "Run without --dry-run to delete"
else
  # Delete test files
  find "$SESSIONS_DIR" -maxdepth 1 -type f \( -name "test*.jsonl" -o -name "no-context*.jsonl" -o -name "timing-test*.jsonl" \) -delete
  echo "✓ Deleted $test_files test session files"
fi
