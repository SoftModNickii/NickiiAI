#!/bin/bash
# NICKII AI on a Raspberry Pi. Sections 11e and 4b of NICKIIAI.md.
#
# The Pi is the installation: access point, server and video store, and the only
# thing that stays in the gallery. The MacBook is an instrument she brings and
# takes away.
#
#   sudo ./scripts/setup-pi.sh --service     install the server, leave the network alone
#   sudo ./scripts/setup-pi.sh --ap          turn this Pi into the NICKII access point
#   sudo ./scripts/setup-pi.sh               both, service first
#   sudo ./scripts/setup-pi.sh --ap-confirm  the access point works, keep it
#
# --service is safe to run over SSH. --ap is not: the Pi leaves whatever network
# it is on to become its own, so an SSH session over Wi-Fi dies at that moment.
# That is success, not failure.
#
# Raspberry Pi OS has used NetworkManager since Bookworm, and NetworkManager can
# be the access point on its own: ipv4.method=shared brings its own DHCP and DNS.
# The older hostapd, dnsmasq and dhcpcd.conf arrangement is not used here and
# would fight NetworkManager for the interface if it were.

set -euo pipefail

[ "$(id -u)" = "0" ] || { echo "Needs root:  sudo $0 $*"; exit 1; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${SUDO_USER:-nickii-pi}"
SSID="${NICKII_SSID:-NICKII}"
PASS="${NICKII_WIFI_PASS:-}"
IP="${NICKII_AP_IP:-192.168.2.1}"
BAND="${NICKII_BAND:-bg}"          # bg = 2.4 GHz, better through walls. a = 5 GHz, faster.
REVERT="${NICKII_AP_REVERT:-720}"  # seconds before an unconfirmed access point gives up. 0 disables.
PORT="${NICKII_PORT:-443}"
MAC_HOST="${NICKII_MAC_HOST:-nickii.local}"   # her MacBook, over mDNS
CONTROL_PASS="${NICKII_PASSWORD:-}"

DO_SERVICE=0; DO_AP=0
case "${1:-both}" in
  --service) DO_SERVICE=1 ;;
  --ap)      DO_AP=1 ;;
  both|"")   DO_SERVICE=1; DO_AP=1 ;;
  --ap-confirm)
    # The access point is reachable, so stand the dead-man switch down.
    systemctl stop nickii-ap-revert.timer >/dev/null 2>&1 || true
    systemctl reset-failed nickii-ap-revert.service >/dev/null 2>&1 || true
    rm -f /usr/local/sbin/nickii-ap-revert.sh
    nmcli connection modify nickii-ap connection.autoconnect yes >/dev/null 2>&1 || true
    echo "Confirmed. ${SSID} is now this Pi's permanent network."
    exit 0 ;;
  *) echo "usage: $0 [--service|--ap|--ap-confirm]"; exit 1 ;;
esac

# ---------------------------------------------------------------- the service
if [ "$DO_SERVICE" = "1" ]; then
  echo "==> installing the server as a service"

  # Whisper cannot run usefully on a Pi and is only needed while she is live, so
  # it stays on the MacBook. That makes it the one part of this system living on
  # another machine, and the Pi has to be told where. A name rather than an
  # address: her Mac takes a new one from this Pi every time it joins, and a
  # wrong address here is silent. Everything reads green and no message arrives.
  if [ ! -f "${REPO}/.env" ]; then
    { echo "NICKII_PORT=${PORT}"
      # Guarded rather than an && one liner: under set -e a false test would end
      # the script here and leave the Pi with no service at all.
      if [ -n "$CONTROL_PASS" ]; then echo "NICKII_PASSWORD=${CONTROL_PASS}"; fi
      echo "NICKII_WHISPER_URL=http://${MAC_HOST}:8178/inference"
    } > "${REPO}/.env"
    chown "${RUN_USER}" "${REPO}/.env"; chmod 600 "${REPO}/.env"
    echo "    wrote .env"
  elif ! grep -q '^NICKII_WHISPER_URL=' "${REPO}/.env"; then
    echo "NICKII_WHISPER_URL=http://${MAC_HOST}:8178/inference" >> "${REPO}/.env"
    echo "    added NICKII_WHISPER_URL to the existing .env"
  fi

  cat > /etc/systemd/system/nickii.service <<EOF
[Unit]
Description=NICKII AI
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${REPO}
Environment=NICKII_PORT=${PORT}
EnvironmentFile=-${REPO}/.env
ExecStart=$(command -v node) ${REPO}/server.js
Restart=always
RestartSec=3
# Binding 443 as a normal user. Granting the capability here rather than with
# setcap on the node binary, because setcap is wiped by every node upgrade.
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable nickii >/dev/null 2>&1
  systemctl restart nickii
  sleep 3
  systemctl is-active --quiet nickii && echo "    service running on port ${PORT}" \
    || { echo "    service FAILED:"; journalctl -u nickii -n 15 --no-pager | sed 's/^/      /'; }
fi

# ---------------------------------------------------------------- the network
if [ "$DO_AP" = "1" ]; then
  [ -n "$PASS" ] || { echo "Set a Wi-Fi password:  sudo NICKII_WIFI_PASS='...' $0 --ap"; exit 1; }
  [ ${#PASS} -ge 8 ] || { echo "WPA needs at least 8 characters."; exit 1; }

  echo "==> making this Pi the ${SSID} access point at ${IP}"

  # Hers is the only name that resolves on this network, and it resolves here.
  # NetworkManager runs its own dnsmasq for shared connections; this is how you
  # add to it.
  mkdir -p /etc/NetworkManager/dnsmasq-shared.d
  cat > /etc/NetworkManager/dnsmasq-shared.d/nickii.conf <<EOF
address=/nickii.ai/${IP}
address=/www.nickii.ai/${IP}
EOF

  nmcli connection delete nickii-ap >/dev/null 2>&1 || true
  nmcli connection add type wifi ifname wlan0 con-name nickii-ap autoconnect yes ssid "$SSID" >/dev/null
  nmcli connection modify nickii-ap \
    802-11-wireless.mode ap \
    802-11-wireless.band "$BAND" \
    wifi-sec.key-mgmt wpa-psk \
    wifi-sec.psk "$PASS" \
    ipv4.method shared \
    ipv4.addresses "${IP}/24" \
    ipv6.method disabled \
    connection.autoconnect-priority 100
  # This is load bearing: the iPad and the MacBook must reach each other
  # directly. The media connections use host ICE candidates only, no STUN and
  # no TURN, so any client isolation means no picture and no sound (4b).
  nmcli connection modify nickii-ap 802-11-wireless.ap-isolation 0 2>/dev/null || true

  # A dead-man switch, because of how this is actually run: over SSH, on a Pi
  # with no keyboard and no screen. If the access point does not come up, there
  # is nothing left to log in with. So the Pi returns to the network it was on
  # unless somebody confirms the access point works.
  PREV="$(nmcli -t -f NAME,DEVICE connection show --active | awk -F: '$2 == "wlan0" { print $1; exit }')"
  if [ -n "$PREV" ] && [ "$REVERT" != "0" ]; then
    cat > /usr/local/sbin/nickii-ap-revert.sh <<EOF
#!/bin/bash
nmcli connection modify nickii-ap connection.autoconnect no || true
nmcli connection down nickii-ap || true
nmcli connection up "${PREV}" || true
EOF
    chmod +x /usr/local/sbin/nickii-ap-revert.sh
    systemctl reset-failed nickii-ap-revert.service >/dev/null 2>&1 || true
    systemd-run --unit=nickii-ap-revert --on-active="$REVERT" \
      /usr/local/sbin/nickii-ap-revert.sh >/dev/null 2>&1 || true
    echo "    if this fails, the Pi returns to ${PREV} in $((REVERT / 60)) minutes"
  fi

  echo "    activating, this connection will drop if you are on Wi-Fi"
  systemd-run --unit=nickii-ap-up --on-active=3 \
    nmcli connection up nickii-ap >/dev/null 2>&1 || nmcli connection up nickii-ap || true
fi

echo
echo "Done."
echo "  network   ${SSID}"
echo "  iPad      https://nickii.ai/"
echo "  her       https://nickii.ai/control"
echo
if [ "$DO_AP" = "1" ] && [ "$REVERT" != "0" ]; then
  echo "  Join ${SSID}, check https://nickii.ai/ answers, then make it permanent:"
  echo "    sudo $0 --ap-confirm"
  echo
fi
echo "  systemctl status nickii     is it running"
echo "  journalctl -u nickii -f     what it is doing"
