#!/bin/bash
# NICKII AI, serve on the bare address.
#
# The app listens on 8443 as an ordinary user process. This redirects inbound
# 443 to it, so the visitor surface answers at https://nickii.ai with no port
# in the address. Nothing runs as root except the packet filter itself.
#
#   sudo ./scripts/setup-port443.sh          turn it on
#   sudo ./scripts/setup-port443.sh --off    take it back off
#
# Only traffic addressed to this Mac is touched, and the rule lives in its own
# anchor so it never disturbs anything else in the firewall.

set -euo pipefail

ANCHOR_NAME="com.nickii"
ANCHOR_FILE="/etc/pf.anchors/${ANCHOR_NAME}"
PF_CONF="/etc/pf.conf"
TARGET_PORT="${NICKII_PORT:-8443}"

if [ "$(id -u)" != "0" ]; then
  echo "This one needs root, because it changes the packet filter."
  echo "  sudo $0 $*"
  exit 1
fi

if [ "${1:-}" = "--off" ]; then
  pfctl -a "$ANCHOR_NAME" -F nat 2>/dev/null || true
  rm -f "$ANCHOR_FILE"
  # Leave the rdr-anchor line in pf.conf: it is inert with no anchor file, and
  # removing it risks mangling a config we did not write.
  pfctl -f "$PF_CONF" 2>/dev/null || true
  echo "Redirect removed. The app is reachable on :${TARGET_PORT} again."
  exit 0
fi

# Only redirect traffic aimed at interfaces that actually exist, so pf does not
# refuse the whole ruleset over a missing bridge100 when sharing is off.
RULES=""
for iface in en0 en1 bridge100; do
  if ifconfig "$iface" >/dev/null 2>&1; then
    RULES="${RULES}rdr pass on ${iface} inet proto tcp from any to (${iface}) port 443 -> 127.0.0.1 port ${TARGET_PORT}"$'\n'
  fi
done
RULES="${RULES}rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 443 -> 127.0.0.1 port ${TARGET_PORT}"$'\n'

printf '%s' "$RULES" > "$ANCHOR_FILE"
chmod 644 "$ANCHOR_FILE"

if ! grep -q "rdr-anchor \"${ANCHOR_NAME}\"" "$PF_CONF"; then
  cp "$PF_CONF" "${PF_CONF}.nickii-backup"
  # rdr-anchor has to sit with the other translation rules, before any filter
  # rules, or pf rejects the file.
  awk -v anchor="rdr-anchor \"${ANCHOR_NAME}\"" '
    !done && /^rdr-anchor/ { print anchor; done=1 }
    { print }
    END { if (!done) print anchor }
  ' "${PF_CONF}.nickii-backup" > "$PF_CONF"
  echo "Added rdr-anchor to ${PF_CONF} (backup at ${PF_CONF}.nickii-backup)"
fi

pfctl -f "$PF_CONF" 2>&1 | grep -v "^No ALTQ support" || true
pfctl -e 2>&1 | grep -v "^No ALTQ support" || true
pfctl -a "$ANCHOR_NAME" -f "$ANCHOR_FILE" 2>&1 | grep -v "^No ALTQ support" || true

echo
echo "Port 443 now reaches the app on ${TARGET_PORT}."
pfctl -a "$ANCHOR_NAME" -s nat 2>/dev/null || true
echo
echo "This does not survive a reboot. Run it again after restarting the Mac,"
echo "or add it to the show runbook alongside starting OBS."
