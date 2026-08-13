# Network runbook: the MacBook as the router

Goal: the MacBook broadcasts Wi-Fi `NICKII`, the iPad joins it, the Mac is reachable at a
fixed address. No uplink required, no venue Wi-Fi, no internet.

Section 4 of NICKIIAI.md. Everything below runs on the Mac unless it says iPad.

---

## 1. Stable name

System Settings > General > About > Name: `nickii`, so the Mac answers to `nickii.local`.

```sh
sudo scutil --set HostName nickii
sudo scutil --set LocalHostName nickii
```

## 2. The network, with a dummy source

macOS cannot share Wi-Fi over Wi-Fi, but it does not need a real uplink to broadcast an
access point. Share from an interface that has nothing attached to it.

1. System Settings > General > Sharing > Internet Sharing (info icon).
2. "Share your connection from": **Thunderbolt Bridge** (or any unused Ethernet or USB
   adapter, nothing needs to be plugged into it).
3. "To devices using": **Wi-Fi**.
4. Wi-Fi Options: name `NICKII`, **WPA3 Personal**, strong password.
5. Toggle it on.

The Mac becomes the gateway at **192.168.2.1** with its own DHCP. Verify:

```sh
ifconfig bridge100
```

If sharing from an inactive interface is refused on this macOS version, plug in any USB
Ethernet adapter (attached to nothing) or move to the travel router. Test this on the exact
macOS version weeks before Linz, not in the venue.

## 3. iPad

Join `NICKII`. "No Internet Connection" is expected and fine.

On the exhibition iPad: forget every other saved network or disable Auto-Join on them, and
turn off Ask to Join Networks. Turn off "Hey Siri". Auto-Lock: Never.

## 4. The address

The visitor must never see an IP. The installation answers at **`https://nickii.ai`**,
which resolves only on this network and never leaves it.

Two pieces make that work:

```sh
sudo node scripts/dns.js          # answers nickii.ai with this Mac's address
sudo ./scripts/setup-port443.sh   # lets 443 reach the app, so there is no port in the URL
```

`dns.js` forwards every other name to the Mac's real resolver, so pointing a device at it
does not cost that device the rest of the internet. In the gallery there is no uplink and
those forwards simply time out, which is correct: hers is the only name that resolves there.

On the iPad, once: Settings > Wi-Fi > (i) next to the network > Configure DNS > Manual,
remove what is there, and add the Mac's address (`192.168.2.1` on the show network).

Neither survives a reboot, so both belong in the show runbook next to starting OBS.

- visitor surface: `https://nickii.ai/`
- controller: `https://nickii.ai/control`
- health: `https://nickii.ai/health`

Still reachable by name and number as a fallback: `https://nickii.local:8443/` and
`https://192.168.2.1:8443/`. The certificate covers all of them.

## 5. Fallback ladder

1. Small travel router (GL.iNet class) hosting the private network. The Mac keeps the same
   hostname and certificate, so nothing else changes.
2. Render cloud mode: `NICKII_MODE=render npm start`, which drops the local certificate
   requirement and re-enables STUN.

---

# One time setup on the Mac

## HTTPS

```sh
brew install mkcert
./scripts/setup-https.sh
```

Then AirDrop `rootCA.pem` to the iPad and enable **full trust** under
Settings > General > About > Certificate Trust Settings. AirDrop is peer to peer, so this
works with no internet. Full trust is easy to forget and everything silently fails
without it.

## Whisper

```sh
brew install whisper-cpp
./scripts/start-whisper.sh          # downloads the model on first run, needs internet
```

The model is `ggml-large-v3-turbo` in `~/models/`, English and German in one model.
whisper-server binds to 127.0.0.1 only and is never exposed on the Wi-Fi network.

## OBS, her instrument

OBS is the single mixing brain. Her foot pedals drive image and sound in one place, and
the browser never knows OBS exists: it just consumes two virtual devices.

1. Install OBS and [BlackHole 2ch](https://existential.audio/blackhole/).
2. Build the scene collection, bind scenes and effects to the foot pedals, and bind one
   pedal to **mute/unmute her microphone**. That mute is now her only "talk / do not talk"
   control, because there is no other reply channel in the system.
3. Start Virtual Camera. It appears to the browser as "OBS Virtual Camera".
4. In OBS Advanced Audio Properties, set her microphone to **Monitor and Output**, and in
   Settings > Audio set the Monitoring Device to **BlackHole 2ch**. That is what puts her
   live voice on the outgoing WebRTC track.
5. On the controller page, the two devices are matched by label from `config.js`
   (`preferredDevices`). The hidden operator panel (Cmd+.) has a picker if a label
   ever differs.

OBS is started by hand as part of the show runbook. It is a performance instrument, not a
daemon, so it is deliberately not supervised by launchd.

## Keeping the server and whisper alive

```sh
sed "s|__NICKII_DIR__|$PWD|g" scripts/com.nickii.ai.plist      > ~/Library/LaunchAgents/com.nickii.ai.plist
sed "s|__NICKII_DIR__|$PWD|g" scripts/com.nickii.whisper.plist > ~/Library/LaunchAgents/com.nickii.whisper.plist

launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nickii.ai.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nickii.whisper.plist
```

Both have `RunAtLoad` and `KeepAlive`, so they come back after a crash or a reboot. The
server agent also holds the Mac awake with `caffeinate -dims`.

Restart one by hand:

```sh
launchctl kickstart -k gui/$(id -u)/com.nickii.ai
```

## The launcher

```sh
./scripts/make-launcher.sh          # once, puts "NICKII AI.app" on the Desktop
```

Double-clicking it opens a Terminal and runs `scripts/nickii.sh`: it starts whisper and the
server if they are not already up, waits until `/health` actually answers rather than just
until the port is held, prints what is and is not running, and opens the controller.

It deliberately shows a visible Terminal. On a show day the useful question is not "did it
launch" but "is whisper up, is the certificate valid, is the picture 1920 wide", and those
answers have to be somewhere you can see them.

```sh
./scripts/nickii.sh          # start, and open the controller
./scripts/nickii.sh status   # what is running, plus the health endpoint
./scripts/nickii.sh stop     # shut the server and whisper down
```

Rerun `make-launcher.sh` if the repo moves: the launcher stores an absolute path.

This is the by-hand launcher. For a six hour unattended run the LaunchAgents above are still
the real answer, because they add `KeepAlive` and `RunAtLoad` and this cannot. Both can
coexist: if an agent already started something, the launcher notices and leaves it alone.

## The iPad app, and locking it down

**Add to Home Screen.** On the iPad, open `https://nickii.ai` (or `https://nickii.local:8443`)
in Safari, then Share, then Add to Home Screen. It installs as **Nickii AI** with the ring
icon, and launches with no Safari chrome, no address bar and no tab strip. That is the app.

Grant the microphone permission **inside the Home Screen app**, not only in Safari. A Home
Screen web app can hold its own permission state, and a visitor meeting a permission prompt
is the fiction over.

**Guided Access is the kiosk lock, and nothing in the web app can replace it.** A web page
cannot stop a swipe to the Home Screen; that is the operating system's decision, not the
page's. Guided Access is Apple's answer and it is stronger than anything a page could do.

1. Settings > Accessibility > Guided Access: on.
2. Passcode Settings > Set Guided Access Passcode. Choose one nobody will guess and write it
   somewhere that is not the iPad.
3. Turn **Mirror Display Auto-Lock** off, and set Display Auto-Lock to Never.
4. Launch the Home Screen app, then **triple-click the top button** to start Guided Access.
5. Before starting, tap Options and turn off Sleep/Wake, Volume, Motion and Keyboards. That
   stops a visitor sleeping the iPad or turning her voice down.
6. To leave: **triple-click the top button** and enter the passcode. It is three presses, not
   four, and the passcode is what actually protects it.

For a permanent installation that cannot be exited even with the passcode, Apple Configurator
on a Mac can put the iPad in Single App Mode, which needs a cable and a supervised device to
undo. That is stronger than Guided Access and worth considering if the iPad is unattended
overnight.

**On the glass itself**, four taps in the top left corner within two seconds opens a read-only
operator panel: link state, whether her feed is arriving and at what resolution, whether the
render pass is running or has fallen back, both peer connections, the microphone, and the
server's health. It reports only. It cannot let anyone out of the app, which is the point:
diagnosing a dead feed mid-show should not mean taking the installation out of kiosk mode in
front of a visitor.

## Mac show settings

Automatic updates off. Notifications off (Focus). Audio output locked to the earpiece.
Nothing else may hold OBS Virtual Camera or BlackHole while the show runs.
