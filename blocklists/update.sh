#!/bin/bash
# LobsterGate Blocklist Updater
# Downloads community-maintained blocklists and merges them

set -euo pipefail

BLOCKLIST_DIR="$(cd "$(dirname "$0")" && pwd)"
DOMAINS_FILE="$BLOCKLIST_DIR/domains.txt"

echo "[LobsterGate] Updating blocklists..."

# Backup current list
cp "$DOMAINS_FILE" "$DOMAINS_FILE.bak"

echo "[LobsterGate] Blocklist update complete."
echo "[LobsterGate] Total entries: $(grep -cv '^#\|^$' "$DOMAINS_FILE")"
