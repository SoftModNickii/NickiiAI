#!/bin/bash
# Push this working copy to the Pi and restart it.
#
#   ./scripts/deploy-to-pi.sh
#
# Run it from the Mac while joined to NICKII. It needs no internet, which is the
# point: on the installation's own network there is no uplink, so anything that
# has to happen there has to be able to happen without one.
#
# It never touches the four things that live only on the Pi: the certificate,
# the .env with her password, the sequences in public/video, and node_modules.
# Those are the installation's own, and a deploy that overwrote them would take
# the show down rather than update it.

set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
USER_AT="${NICKII_PI_USER:-nickii-pi}"

bold=$'\033[1m'; off=$'\033[0m'; dim=$'\033[2m'
grn=$'\033[32m'; red=$'\033[31m'; ylw=$'\033[33m'
ok(){   printf "  ${grn}OK${off}   %s\n" "$1"; }
bad(){  printf "  ${red}NO${off}   %s\n" "$1"; }
warn(){ printf "  ${ylw}--${off}   %s\n" "$1"; }
note(){ printf "       ${dim}%s${off}\n" "$1"; }

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 -o BatchMode=yes)

# This is launched by double-click, so the window would otherwise close on
# whatever it was saying, and the failures are the part worth reading.
hold(){ [ -t 0 ] || return 0; printf "\n     ${dim}Press any key to close.${off}"; read -r -n 1 -s; echo; }
trap hold EXIT

printf "\n${bold}Deploy to the Pi${off}\n\n"

# ---------------------------------------------------------------- find it
# 192.168.2.1 is the Pi being the installation. The others are it still being a
# guest on somebody's network, which is how it looks before the show is built.
HOST=""
for cand in 192.168.2.1 nickii.ai nickii-pi.local; do
  if ping -c1 -W1 "$cand" >/dev/null 2>&1 && \
     ssh "${SSH_OPTS[@]}" "$USER_AT@$cand" true >/dev/null 2>&1; then
    HOST="$cand"; break
  fi
done

if [ -z "$HOST" ]; then
  bad "cannot reach the Pi"
  note "Join the NICKII network. If the Pi is not an access point yet, it is"
  note "still on whatever Wi-Fi it was imaged with, and this Mac has to be there."
  exit 1
fi
ok "the Pi answers at $HOST"

ON_AP=0
[ "$HOST" = "192.168.2.1" ] && ON_AP=1

# ---------------------------------------------------------------- send it
# public/video is excluded deliberately and always: the real sequences are
# hundreds of megabytes, they live on the Pi, and they are not in git either.
printf "\n  sending the source\n"
rsync -az --delete \
  --exclude '.git/' --exclude 'node_modules/' --exclude 'certs/' \
  --exclude 'logs/' --exclude '.env' --exclude 'public/video/' \
  --exclude '.DS_Store' --exclude 'public/_*.html' \
  -e "ssh ${SSH_OPTS[*]}" \
  "$REPO/" "$USER_AT@$HOST:/home/$USER_AT/nickii/" 2>&1 | sed 's/^/       /'

if [ "${PIPESTATUS[0]}" != "0" ]; then bad "rsync failed"; exit 1; fi
ok "source is on the Pi"

# The sequences go separately, and never with --delete. They are hundreds of
# megabytes and they are not in git, so on a bad day this working copy is the
# one without them, and a delete would empty the installation instead of
# updating it. rsync sends only what actually differs, so an unchanged loop
# costs nothing and a newly cut one goes over on its own.
if compgen -G "$REPO/public/video/*.mp4" >/dev/null 2>&1; then
  printf "\n  sending the sequences\n"
  rsync -a --info=progress2 \
    -e "ssh ${SSH_OPTS[*]}" \
    "$REPO"/public/video/*.mp4 \
    "$USER_AT@$HOST:/home/$USER_AT/nickii/public/video/" 2>&1 | sed 's/^/       /'
  [ "${PIPESTATUS[0]}" = "0" ] && ok "the sequences are current" || warn "the sequences did not all go over"
else
  warn "no sequences in this working copy, the Pi keeps the ones it has"
fi

# Dependencies only when they actually changed, because npm on a Pi is slow and
# a deploy that takes two minutes is a deploy nobody runs before a show.
ssh "${SSH_OPTS[@]}" "$USER_AT@$HOST" \
  'cd ~/nickii && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1' \
  && ok "dependencies are current" || warn "npm install had something to say"

# ---------------------------------------------------------------- restart it
ssh "${SSH_OPTS[@]}" "$USER_AT@$HOST" 'sudo systemctl restart nickii' >/dev/null 2>&1 \
  && ok "service restarted" || { bad "could not restart the service"; exit 1; }

# ---------------------------------------------------------------- prove it
printf "\n  checking\n"
HEALTH=""
for i in $(seq 1 20); do
  HEALTH="$(curl -sk --max-time 3 "https://$HOST/health" 2>/dev/null)"
  case "$HEALTH" in *'"ok":true'*) break ;; esac
  sleep 1
done

case "$HEALTH" in
  *'"ok":true'*)
    ok "the installation is answering"
    SURF="$(printf '%s' "$HEALTH" | sed -n 's/.*"surface":"\([a-z]*\)".*/\1/p')"
    note "surface: ${SURF:-unknown}"
    ;;
  *)
    bad "the server is not answering after the restart"
    note "ssh $USER_AT@$HOST 'journalctl -u nickii -n 30 --no-pager'"
    exit 1
    ;;
esac

curl -sko /dev/null -w "" --max-time 5 "https://$HOST/video/calm.mp4" \
  && ok "the sequences are being served" || warn "the loop video did not answer"

# ---------------------------------------------------------------- keep it
# The access point undoes itself unless somebody confirms it works. Being here,
# over that access point, having just been answered by it, is that confirmation.
if [ "$ON_AP" = "1" ]; then
  ssh "${SSH_OPTS[@]}" "$USER_AT@$HOST" \
    'sudo /home/'"$USER_AT"'/nickii/scripts/setup-pi.sh --ap-confirm' 2>&1 | sed 's/^/       /'
  ok "the NICKII network is permanent now"
else
  warn "not on the NICKII network, so the access point was not confirmed"
fi

printf "\n     iPad        ${bold}https://nickii.ai/${off}\n"
printf "     controller  https://nickii.ai/control\n\n"
