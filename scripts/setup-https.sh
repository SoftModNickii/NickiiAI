#!/bin/bash
# NICKII AI, local HTTPS certificate.
# Section 5 of NICKIIAI.md.
#
# getUserMedia only works in a secure context, and http://192.168.2.1 is not
# one. This issues a certificate for every name the iPad might use.

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert is not installed."
  echo "  brew install mkcert"
  exit 1
fi

echo "Installing the local CA (asks for your password once)..."
mkcert -install

mkdir -p certs

# The show names, plus whatever this Mac answers to right now, so the same
# certificate works on today's Wi-Fi and on the NICKII network in Linz.
# nickii.ai is the address the visitor sees. It resolves only on this network,
# from scripts/dns.js, and never leaves it.
NAMES=(nickii.ai www.nickii.ai nickii.local 192.168.2.1 localhost 127.0.0.1)

LOCALHOST_NAME="$(scutil --get LocalHostName 2>/dev/null || true)"
if [ -n "$LOCALHOST_NAME" ] && [ "$LOCALHOST_NAME" != "nickii" ]; then
  NAMES+=("${LOCALHOST_NAME}.local")
fi

for iface in $(ifconfig -l); do
  ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
  [ -z "$ip" ] && continue
  case " ${NAMES[*]} " in *" $ip "*) continue ;; esac
  NAMES+=("$ip")
done

echo "Issuing the certificate for: ${NAMES[*]}"
mkcert \
  -cert-file certs/nickii.local.pem \
  -key-file certs/nickii.local-key.pem \
  "${NAMES[@]}"

CAROOT="$(mkcert -CAROOT)"

echo
echo "Done. Certificate written to certs/"
openssl x509 -in certs/nickii.local.pem -noout -enddate | sed 's/notAfter=/expires: /'
echo
echo "Next, trust the CA on the iPad (this works offline):"
echo "  1. AirDrop this file to the iPad:"
echo "       $CAROOT/rootCA.pem"
echo "  2. iPad: open it, then Settings > General > VPN & Device Management,"
echo "     install the profile."
echo "  3. iPad: Settings > General > About > Certificate Trust Settings,"
echo "     enable FULL TRUST for the mkcert root."
echo
echo "Step 3 is easy to forget and everything silently fails without it."
echo
echo "Reveal the CA folder now? (y/n)"
read -r reply
if [ "$reply" = "y" ]; then open "$CAROOT"; fi
