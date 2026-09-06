#!/bin/bash
# Switch between live Nickii AI and video loop mode
#
# Usage:
#   ./scripts/switch-to-video-loop.sh start    - Start video loop mode on iPad
#   ./scripts/switch-to-video-loop.sh stop     - Stop video loop mode, return to live
#   ./scripts/switch-to-video-loop.sh status   - Show current mode
#
# How it works:
#   This script helps you switch between the live Nickii AI (which requires
#   the server on this Mac) and a standalone video loop version that runs
#   entirely on the iPad without any server connection.
#
#   For video loop mode:
#   1. The video-loop.html file must be copied to the iPad
#   2. The iPad must have the video file in the same directory
#   3. Open video-loop.html in Safari on the iPad
#
#   To switch back to live mode, simply open the normal URL (nickii.ai or nickii.local:8443)

set -uo pipefail

cd "$(dirname "$0")/.."
REPO="$PWD"

PORT="${NICKII_PORT:-8443}"

bold=$'\033[1m'; dim=$'\033[2m'; green=$'\033[32m'; red=$'\033[31m'; yellow=$'\033[33m'; off=$'\033[0m'
ok(){   printf "  ${green}o${off}  %s\n" "$1"; }
bad(){  printf "  ${red}x${off}  %s\n" "$1"; }
warn(){ printf "  ${yellow}!${off}  %s\n" "$1"; }
note(){ printf "     ${dim}%s${off}\n" "$1"; }

listening(){ lsof -ti :"$1" >/dev/null 2>&1; }

# Check if video loop file exists
VIDEO_LOOP_HTML="$REPO/public/video-loop.html"

show_status() {
  printf "\n${bold}NICKII AI - Mode Switch Status${off}\n\n"
  
  if listening "$PORT"; then
    ok "Live server is running on port $PORT"
    printf "\n     Current mode: ${bold}LIVE (server-based)${off}\n"
    note "iPad should be connected to: https://nickii.ai or https://nickii.local:$PORT"
  else
    warn "Live server is not running"
    printf "\n     Current mode: ${bold}STANDALONE (video loop)${off} possible\n"
    note "iPad should open: $VIDEO_LOOP_HTML"
  fi
  
  if [ -f "$VIDEO_LOOP_HTML" ]; then
    ok "Video loop HTML file exists at $VIDEO_LOOP_HTML"
  else
    bad "Video loop HTML file not found!"
  fi
  
  printf "\n"
}

show_instructions() {
  printf "\n${bold}HOW TO USE VIDEO LOOP MODE${off}\n\n"
  
  note "1. Prepare your video file:"
  note "   - Create or edit your video loop (MP4 format recommended)"
  note "   - Name it something like 'nickii-loop.mp4'"
  note "   - Place it in the same folder as video-loop.html"
  
  printf "\n"
  note "2. Copy files to iPad:"
  note "   Option A: AirDrop both video-loop.html and your video file to iPad"
  note "   Option B: Use iCloud Drive or similar cloud storage"
  note "   Option C: Host on a simple web server and open the URL on iPad"
  
  printf "\n"
  note "3. On the iPad:"
  note "   - Open Safari and navigate to video-loop.html"
  note "   - Tap to enable sound (iOS requires this for autoplay)"
  note "   - For best experience: Add to Home Screen"
  note "   - Use Guided Access (Settings > Accessibility) to lock the screen"
  
  printf "\n"
  note "4. To switch back to live mode:"
  note "   - Stop this script if running in loop mode"
  note "   - Start the normal server: ./scripts/nickii.sh start"
  note "   - On iPad, open: https://nickii.ai or https://nickii.local:$PORT"
  
  printf "\n"
  note "5. Quick switching:"
  note "   - Keep both URLs bookmarked on iPad"
  note "   - Use this script to manage server state"
  
  printf "\n"
}

case "${1:-status}" in
  start)
    printf "\n${bold}Starting Video Loop Mode${off}\n\n"
    
    # Stop the live server if running
    if listening "$PORT"; then
      warn "Live server is running, stopping it..."
      pkill -f "node $REPO/server.js" 2>/dev/null
      pkill -f "node server.js" 2>/dev/null
      sleep 2
      ok "Live server stopped"
    else
      note "Live server was not running"
    fi
    
    # Stop whisper if running
    if pgrep -f "whisper-server" >/dev/null; then
      warn "Whisper server is running, stopping it..."
      pkill -f "whisper-server" 2>/dev/null
      sleep 1
      ok "Whisper server stopped"
    fi
    
    # Verify video loop file exists
    if [ ! -f "$VIDEO_LOOP_HTML" ]; then
      bad "Video loop HTML file not found!"
      note "Run: cp public/client.html public/video-loop.html and edit it"
      exit 1
    fi
    
    ok "Video loop mode ready"
    printf "\n"
    printf "     ${bold}On iPad, open:${off}\n"
    printf "     file:///path/to/video-loop.html (if local file)\n"
    printf "     OR\n"
    printf "     http://your-mac-ip/video-loop.html (if served)\n"
    printf "\n"
    printf "     ${bold}Or use:${off}\n"
    printf "     python3 -m http.server 8000\n"
    printf "     Then open: http://your-mac-ip:8000/public/video-loop.html\n"
    printf "\n"
    ;;

  stop)
    printf "\n${bold}Returning to Live Mode${off}\n\n"
    
    # Check if server is already running
    if listening "$PORT"; then
      ok "Live server is already running"
    else
      printf "     Starting live server... "
      nohup node server.js > logs/server.log 2>&1 &
      for _ in $(seq 1 30); do listening "$PORT" && break; sleep 0.5; done
      if listening "$PORT"; then 
        printf "${green}up${off}\n"
      else
        printf "${red}failed${off}\n"
        note "see logs/server.log"
        exit 1
      fi
    fi
    
    # Start whisper if available
    WHISPER_PORT="${NICKII_WHISPER_PORT:-8178}"
    if command -v whisper-server >/dev/null && ! listening "$WHISPER_PORT"; then
      printf "     Starting whisper... "
      nohup ./scripts/start-whisper.sh > logs/whisper.log 2>&1 &
      for _ in $(seq 1 60); do listening "$WHISPER_PORT" && break; sleep 1; done
      if listening "$WHISPER_PORT"; then 
        printf "${green}up${off}\n"
      else
        printf "${red}failed${off}\n"
        note "see logs/whisper.log"
      fi
    fi
    
    ok "Live mode ready"
    printf "\n"
    printf "     ${bold}On iPad, open:${off}\n"
    printf "     https://nickii.ai\n"
    printf "     OR\n"
    printf "     https://nickii.local:$PORT/\n"
    printf "\n"
    ;;

  status)
    show_status
    ;;

  help|instructions)
    show_instructions
    ;;

  *)
    printf "\n${bold}Usage:${off} ./scripts/switch-to-video-loop.sh [start|stop|status|help]\n\n"
    note "start   - Stop live server, prepare for video loop mode"
    note "stop    - Start live server, return to normal mode"
    note "status  - Show current mode"
    note "help    - Show detailed instructions"
    printf "\n"
    show_status
    ;;
esac
