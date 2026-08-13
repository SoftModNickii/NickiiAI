#!/bin/bash
# NICKII AI, one command to bring the installation up.
#
#   ./scripts/nickii.sh          start everything and open the controller
#   ./scripts/nickii.sh status   what is running right now
#   ./scripts/nickii.sh stop     shut the server and whisper down
#
# This is the rehearsal and show-day launcher, driven by hand. For a six hour
# unattended run the LaunchAgents in this folder are the real answer: they add
# KeepAlive and RunAtLoad, which this cannot. Both can coexist. If an agent has
# already started something, this notices and leaves it alone.
#
# OBS is deliberately not started here. It is a performance instrument, not a
# daemon, and section 12 of NICKIIAI.md keeps it under her hand.

set -uo pipefail

cd "$(dirname "$0")/.."
REPO="$PWD"
mkdir -p logs

PORT="${NICKII_PORT:-8443}"
WHISPER_PORT="${NICKII_WHISPER_PORT:-8178}"

bold=$'\033[1m'; dim=$'\033[2m'; green=$'\033[32m'; red=$'\033[31m'; yellow=$'\033[33m'; off=$'\033[0m'
ok(){   printf "  ${green}o${off}  %s\n" "$1"; }
bad(){  printf "  ${red}x${off}  %s\n" "$1"; }
warn(){ printf "  ${yellow}!${off}  %s\n" "$1"; }
note(){ printf "     ${dim}%s${off}\n" "$1"; }

listening(){ lsof -ti :"$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------- stop
if [ "${1:-start}" = "stop" ]; then
  printf "\n${bold}Stopping NICKII AI${off}\n\n"
  pkill -f "node $REPO/server.js" 2>/dev/null && ok "server stopped" || note "server was not running"
  pkill -f "node server.js" 2>/dev/null
  pkill -f "whisper-server" 2>/dev/null && ok "whisper stopped" || note "whisper was not running"
  printf "\n"
  exit 0
fi

# ---------------------------------------------------------------- status
show_status(){
  printf "\n${bold}NICKII AI${off}\n\n"

  listening "$WHISPER_PORT" && ok "whisper listening on $WHISPER_PORT" || bad "whisper is not running"
  listening "$PORT"        && ok "server listening on $PORT"          || bad "server is not running"

  if [ -f certs/nickii.local.pem ]; then
    local exp; exp="$(openssl x509 -in certs/nickii.local.pem -noout -enddate 2>/dev/null | sed 's/notAfter=//')"
    if openssl x509 -in certs/nickii.local.pem -noout -checkend 0 >/dev/null 2>&1; then
      ok "certificate valid until $exp"
    else
      bad "CERTIFICATE HAS EXPIRED ($exp), rerun scripts/setup-https.sh"
    fi
  else
    bad "no certificate: the iPad microphone will not work. Run scripts/setup-https.sh"
  fi

  pgrep -f "[d]ns.js" >/dev/null && ok "dns answering nickii.ai" \
    || note "dns not running (optional: sudo node scripts/dns.js)"

  if sudo -n pfctl -s nat 2>/dev/null | grep -q "$PORT"; then
    ok "port 443 reaches the app"
  else
    note "port 443 redirect off (optional: sudo ./scripts/setup-port443.sh)"
  fi
}

# ---------------------------------------------------------------- preflight
if [ "${1:-start}" = "status" ]; then
  show_status

  if listening "$PORT"; then
    printf "\n"
    curl -sk --max-time 4 "https://127.0.0.1:$PORT/health" 2>/dev/null \
      | python3 -m json.tool 2>/dev/null || note "health endpoint did not answer"
  fi
  printf "\n"
  exit 0
fi

printf "\n${bold}Starting NICKII AI${off}\n\n"

command -v node >/dev/null || { bad "node is not installed"; exit 1; }

# ---------------------------------------------------------------- certificate
# The Mac's address changes every time she moves network, and the certificate
# is issued for a fixed list of addresses. When they disagree the iPad gets a
# name mismatch and simply never loads, with nothing on either screen saying
# why. This has cost a whole afternoon twice. Reissue it before it can.
CURRENT_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '')"
if [ -n "$CURRENT_IP" ] && [ -f certs/nickii.local.pem ]; then
  if ! openssl x509 -in certs/nickii.local.pem -noout -text 2>/dev/null \
       | grep -q "IP Address:${CURRENT_IP}\b"; then
    warn "this Mac is now $CURRENT_IP, which the certificate does not cover"
    note "reissuing, the iPad does not need to trust anything again"
    ./scripts/setup-https.sh </dev/null >/dev/null 2>&1 \
      && ok "certificate reissued for $CURRENT_IP" \
      || bad "could not reissue, run ./scripts/setup-https.sh by hand"
    # The running server is holding the old certificate in memory.
    listening "$PORT" && { pkill -f "node server.js" 2>/dev/null; sleep 1; }
  fi
fi

# ---------------------------------------------------------------- whisper
if listening "$WHISPER_PORT"; then
  ok "whisper already running"
elif ! command -v whisper-server >/dev/null; then
  warn "whisper-server not installed, transcription will fail"
  note "brew install whisper-cpp"
else
  printf "     starting whisper... "
  nohup ./scripts/start-whisper.sh > logs/whisper.log 2>&1 &
  for _ in $(seq 1 60); do listening "$WHISPER_PORT" && break; sleep 1; done
  if listening "$WHISPER_PORT"; then printf "${green}up${off}\n"
  else printf "${red}failed${off}\n"; note "see logs/whisper.log (the model may still be downloading)"; fi
fi

# ---------------------------------------------------------------- server
if listening "$PORT"; then
  ok "server already running"
else
  printf "     starting server...  "
  nohup node server.js > logs/server.log 2>&1 &
  for _ in $(seq 1 30); do listening "$PORT" && break; sleep 0.5; done
  if listening "$PORT"; then printf "${green}up${off}\n"
  else printf "${red}failed${off}\n"; tail -5 logs/server.log; exit 1; fi
fi

# Wait for it to actually answer, not merely to hold the port.
for _ in $(seq 1 20); do
  curl -sk --max-time 2 "https://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 0.5
done

show_status

# ---------------------------------------------------------------- the address
# The DNS and the port 443 redirect both need root and neither survives a
# reboot, so they are the two things most likely to be missing. Offer them here
# rather than making her remember two sudo commands on a show morning. If she
# declines, or it fails, everything still works on nickii.local:8443.
NEED_DNS=0; NEED_443=0
pgrep -f "[d]ns.js" >/dev/null || NEED_DNS=1
sudo -n pfctl -s nat 2>/dev/null | grep -q "$PORT" || NEED_443=1

if [ "$NEED_DNS" = "1" ] || [ "$NEED_443" = "1" ]; then
  printf "\n     Turn on the plain ${bold}https://nickii.ai${off} address? "
  printf "${dim}(asks for your password)${off} [y/N] "
  read -r reply
  if [ "${reply:-n}" = "y" ] || [ "${reply:-n}" = "Y" ]; then
    CMD=""
    [ "$NEED_DNS" = "1" ] && CMD="cd '$REPO' && nohup node scripts/dns.js > logs/dns.log 2>&1 &"
    [ "$NEED_443" = "1" ] && CMD="$CMD cd '$REPO' && NICKII_PORT=$PORT ./scripts/setup-port443.sh > logs/port443.log 2>&1;"
    if osascript -e "do shell script \"$CMD\" with administrator privileges" >/dev/null 2>&1; then
      sleep 1
      pgrep -f "[d]ns.js" >/dev/null && ok "dns answering nickii.ai" || warn "dns did not start, see logs/dns.log"
    else
      warn "skipped, everything still works on the addresses below"
    fi
  fi
fi

# ---------------------------------------------------------------- addresses
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '')"
HOST="$(scutil --get LocalHostName 2>/dev/null || echo nickii).local"

printf "\n${bold}Open on the iPad${off}\n"
if pgrep -f "[d]ns.js" >/dev/null; then
  printf "     ${bold}https://nickii.ai${off}\n"
  note "iPad DNS must point at this Mac: Settings, Wi-Fi, (i), Configure DNS, Manual"
fi
printf "     https://%s:%s/\n" "$HOST" "$PORT"
[ -n "$IP" ] && printf "     https://%s:%s/${dim}   (if the name does not resolve)${off}\n" "$IP" "$PORT"

printf "\n${bold}Before visitors${off}\n"
note "OBS: scene collection loaded, Virtual Camera started, monitoring to BlackHole"
note "Controller: Cmd+. and check Picture reads 1920 x 1080, limited by none"
note "Earpiece in, output device confirmed, monitor level tested"
printf "\n"

open "https://127.0.0.1:$PORT/control" 2>/dev/null

printf "${dim}Leave this window open. Close it and the system keeps running;${off}\n"
printf "${dim}./scripts/nickii.sh stop shuts it down.${off}\n\n"
