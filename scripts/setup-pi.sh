#!/bin/bash
# NICKII AI on a Raspberry Pi. Section 11e.
#
# The Pi is the installation: it is the access point, the server and the video
# store, and it is the only thing that stays in the gallery. The MacBook is an
# instrument she brings and takes away.
#
# Run once on a fresh Raspberry Pi OS (Bookworm or later), as a normal user:
#
#   sudo ./scripts/setup-pi.sh
#
# Afterwards the Pi broadcasts NICKII, serves the app, and starts itself after
# a power cut with nothing plugged in and nobody present.

set -euo pipefail

[ "$(id -u)" = "0" ] || { echo "Needs root:  sudo $0"; exit 1; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${SUDO_USER:-pi}"
SSID="${NICKII_SSID:-NICKII}"
PASS="${NICKII_WIFI_PASS:-}"
IP="192.168.2.1"

if [ -z "$PASS" ]; then
  echo "Set a Wi-Fi password first:"
  echo "  sudo NICKII_WIFI_PASS='something-long' $0"
  exit 1
fi
[ ${#PASS} -ge 8 ] || { echo "WPA needs at least 8 characters."; exit 1; }

echo
echo "NICKII AI, Raspberry Pi setup"
echo "  repo:  $REPO"
echo "  user:  $RUN_USER"
echo "  ssid:  $SSID at $IP"
echo

# ---------------------------------------------------------------- packages
apt-get update -qq
apt-get install -y -qq nodejs npm hostapd dnsmasq >/dev/null
systemctl unmask hostapd 2>/dev/null || true

# ---------------------------------------------------------------- the network
# NetworkManager ships on Bookworm and will fight hostapd over wlan0 unless it
# is told this interface is not its business.
if systemctl is-active --quiet NetworkManager; then
  mkdir -p /etc/NetworkManager/conf.d
  cat > /etc/NetworkManager/conf.d/nickii-unmanaged.conf <<EOF
[keyfile]
unmanaged-devices=interface-name:wlan0
EOF
  systemctl reload NetworkManager || true
fi

cat > /etc/hostapd/hostapd.conf <<EOF
interface=wlan0
driver=nl80211
ssid=${SSID}
hw_mode=g
channel=7
wmm_enabled=1
auth_algs=1
ignore_broadcast_ssid=0
wpa=2
wpa_passphrase=${PASS}
wpa_key_mgmt=WPA-PSK
rsn_pairwise=CCMP
# Client isolation must stay OFF. The iPad and the MacBook have to reach each
# other directly: the media connections use host ICE candidates only, with no
# STUN and no TURN, so anything between them means no picture and no sound.
ap_isolate=0
EOF
sed -i 's|^#\?DAEMON_CONF=.*|DAEMON_CONF="/etc/hostapd/hostapd.conf"|' /etc/default/hostapd

cat > /etc/dnsmasq.d/nickii.conf <<EOF
interface=wlan0
dhcp-range=192.168.2.10,192.168.2.60,255.255.255.0,24h
# Hers is the only name that resolves here, and it resolves to this Pi.
address=/nickii.ai/${IP}
address=/www.nickii.ai/${IP}
EOF

# Static address on the AP side, so the certificate never has to be reissued.
if ! grep -q "nickii" /etc/dhcpcd.conf 2>/dev/null; then
  cat >> /etc/dhcpcd.conf <<EOF

# nickii
interface wlan0
static ip_address=${IP}/24
nohook wpa_supplicant
EOF
fi

# ---------------------------------------------------------------- the app
sudo -u "$RUN_USER" npm --prefix "$REPO" install --omit=dev --silent

# 443 without root: let the service bind low ports rather than run as root.
setcap 'cap_net_bind_service=+ep' "$(command -v node)" || true

cat > /etc/systemd/system/nickii.service <<EOF
[Unit]
Description=NICKII AI
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${REPO}
Environment=NICKII_PORT=443
EnvironmentFile=-${REPO}/.env
ExecStart=$(command -v node) ${REPO}/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now hostapd dnsmasq nickii >/dev/null 2>&1 || true

echo
echo "Done. After a reboot the Pi comes up on its own."
echo
echo "  network   ${SSID}"
echo "  iPad      https://nickii.ai/"
echo "  her       https://nickii.ai/control"
echo
echo "Still to do, once:"
echo "  1. Put the certificate in ${REPO}/certs/ (issued for nickii.ai and ${IP})"
echo "  2. Put the sequences in ${REPO}/public/video/  (see the README there)"
echo "  3. Set the controller password in ${REPO}/.env :  NICKII_PASSWORD=..."
echo "  4. Trust the mkcert root on the iPad, then Add to Home Screen"
echo
echo "  systemctl status nickii     is it running"
echo "  journalctl -u nickii -f     what it is doing"
echo
