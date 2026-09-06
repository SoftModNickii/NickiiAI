# Nickii AI - Video Loop Mode

This document describes how to run Nickii AI in a **standalone video loop mode** on the iPad without requiring the Mac server.

## Overview

You have two modes:

| Mode | Requires Server | Interactive | Use Case |
|------|----------------|------------|----------|
| **Live Mode** | ✅ Yes (Mac) | ✅ Yes | Normal operation with AI responses |
| **Video Loop Mode** | ❌ No | ❌ No (optional) | Autonomous playback, no Mac needed |

The video loop mode allows you to:
- Play a pre-recorded video in a continuous loop on the iPad
- Maintain the exact same visual appearance as the live Nickii AI
- Run completely independently without the Mac server
- Switch seamlessly between modes

## Quick Start

### 1. Prepare Your Video

Create or select your video loop file:
```bash
# Video should be:
# - MP4 format (H.264 codec recommended)
# - Portrait orientation (9:16 aspect ratio)
# - Loopable content (seamless transition)
# - Named: nickii-loop.mp4 (or any name you prefer)

# Place it in: NickiiAI/public/nickii-loop.mp4
```

### 2. Copy Files to iPad

**Option A: AirDrop (Recommended)**
1. Open Finder on Mac
2. Select both files:
   - `NickiiAI/public/video-loop.html`
   - `NickiiAI/public/nickii-loop.mp4` (your video)
3. Right-click → Share → AirDrop → Select your iPad
4. On iPad: Accept the files, save to "On My iPad" or iCloud Drive

**Option B: Simple HTTP Server**
```bash
# On Mac, in the NickiiAI directory:
cd /Users/nick/Documents/GitHub/NickiiAI
python3 -m http.server 8000

# On iPad: Open Safari and go to:
# http://YOUR-MAC-IP:8000/public/video-loop.html
```

**Option C: iCloud Drive**
1. Copy files to iCloud Drive folder on Mac
2. On iPad, open Files app → iCloud Drive
3. Navigate to the files and open video-loop.html in Safari

### 3. Open on iPad

1. **From local files**: Open Files app, find `video-loop.html`, tap and hold → "Open in Safari"
2. **From HTTP server**: Open Safari, enter the URL from Option B
3. **Enable sound**: Tap anywhere on the screen once (iOS requires user interaction for unmuted autoplay)

### 4. (Optional) Add to Home Screen

For a full-screen, app-like experience:
1. In Safari on iPad, tap the Share button (square with arrow)
2. Select "Add to Home Screen"
3. Name it "Nickii Video" or similar
4. Open from Home Screen for full-screen experience

### 5. (Optional) Enable Guided Access

To prevent users from exiting the video:
1. Go to Settings → Accessibility → Guided Access
2. Turn on Guided Access
3. Triple-click the side button to start Guided Access
4. Draw a circle around areas to disable (or disable all touch)
5. Start the session

## Switching Between Modes

### Switch to Video Loop Mode

```bash
# On Mac:
./scripts/switch-to-video-loop.sh start

# This will:
# - Stop the live server if running
# - Stop whisper if running
# - Confirm video-loop.html exists
# - Display instructions for iPad
```

### Switch Back to Live Mode

```bash
# On Mac:
./scripts/switch-to-video-loop.sh stop

# This will:
# - Start the live server
# - Start whisper if available
# - Display the normal URLs for iPad
```

### Check Current Mode

```bash
./scripts/switch-to-video-loop.sh status
```

## Configuration

### Video Loop HTML Customization

Edit `public/video-loop.html` to customize:

1. **Video source** (line ~200):
   ```html
   <source src="nickii-loop.mp4" type="video/mp4">
   ```

2. **Display text** (lines ~250-260):
   ```html
   <span class="en">Nickii AI</span>
   <span class="de">Kunst Installations Modus</span>
   ```

3. **Button text** (lines ~280-285):
   ```html
   <text class="a-en">Video Loop</textPath>
   <text class="a-de">Video Schleife</textPath>
   ```

4. **Status indicator** (line ~240):
   ```html
   <div id="status"><i class="dot"></i><span>Offline</span></div>
   ```

### Supported Video Formats

| Format | Codec | Notes |
|--------|-------|-------|
| MP4 | H.264 | Best compatibility |
| MP4 | H.265/HEVC | Good, but may need conversion |
| WebM | VP9 | Works, but less common on iOS |
| MOV | Various | Usually works, but larger files |

**Recommendation**: Use MP4 with H.264 codec, baseline profile for maximum compatibility.

### Video Specifications

For best results:
- **Resolution**: 1080×1920 (portrait) or 720×1280
- **Frame Rate**: 24fps, 25fps, 30fps, or 60fps
- **Bitrate**: 5-10 Mbps for good quality
- **Duration**: Any length (will loop seamlessly)
- **Audio**: AAC, 44.1kHz or 48kHz, stereo

## Advanced Usage

### Multiple Video Loops

You can create multiple video loop HTML files with different content:

```bash
# Copy the template
cp public/video-loop.html public/video-loop-1.html
cp public/video-loop.html public/video-loop-2.html

# Edit each to point to different videos
# In video-loop-1.html:
#   <source src="loop-1.mp4" type="video/mp4">
# In video-loop-2.html:
#   <source src="loop-2.mp4" type="video/mp4">
```

### Remote Video Hosting

For larger videos or dynamic content:

1. Upload your video to a web server or cloud storage
2. Make sure the URL is directly accessible (not behind authentication)
3. Edit the video source in video-loop.html:
   ```html
   <source src="https://your-server.com/videos/nickii-loop.mp4" type="video/mp4">
   ```

**Important**: The server must support CORS or the video won't play on iPad.

### Offline-First with Fallback

For reliability, you can include multiple sources:

```html
<video id="feed" autoplay playsinline loop muted>
  <!-- Try local first -->
  <source src="nickii-loop.mp4" type="video/mp4">
  <!-- Fall back to remote -->
  <source src="https://backup-server.com/nickii-loop.mp4" type="video/mp4">
  <!-- Final fallback message -->
  Video file not available.
</video>
```

## Troubleshooting

### Video Won't Play

1. **Check file location**: Ensure the video file is in the same directory as video-loop.html
2. **Check file permissions**: On iPad, verify you can open the video directly in Files app
3. **Check format**: Convert to MP4 with H.264 if using a different format
4. **Check iOS restrictions**: iOS may block autoplay with sound without user interaction

### No Sound

1. **Tap the screen**: iOS requires a user gesture to enable unmuted autoplay
2. **Check mute switch**: Ensure the iPad isn't muted (physical switch or control center)
3. **Check video file**: Verify the video has an audio track

### Video Not Looping

1. **Check HTML**: Ensure `loop` attribute is present on the `<video>` element
2. **Check video encoding**: Some videos have encoding issues that prevent seamless looping

### Visual Differences from Live Mode

The video loop mode uses a slightly simplified version of the interface:
- The button is visual only (not interactive for voice input)
- Audio controls are hidden (not applicable)
- Status shows "Offline" instead of "Online"

These differences are intentional to indicate the mode clearly.

## Performance Tips

1. **Video Optimization**:
   - Use HandBrake or FFmpeg to optimize videos
   - Target file size: <50MB for quick loading
   - Use constant frame rate (CFR) not variable (VFR)

2. **FFmpeg Conversion Example**:
   ```bash
   ffmpeg -i input.mov -c:v libx264 -preset slow -crf 22 -c:a aac -b:a 128k -movflags +faststart nickii-loop.mp4
   ```

3. **Testing**:
   - Test videos in Safari on iPad before deployment
   - Check both portrait and landscape orientations
   - Verify on multiple iOS versions if possible

## Security Considerations

- Videos stored locally on iPad are only accessible to apps with file access
- Remote videos should be hosted on HTTPS for security
- No authentication is required for video loop mode (intentional)

## Updates

When updating your video content:
1. Replace the video file (keep the same filename)
2. Clear Safari cache on iPad if changes don't appear
3. Re-open video-loop.html to load the new content

## Related Files

- `public/video-loop.html` - Main video loop HTML file
- `scripts/switch-to-video-loop.sh` - Mode switching script
- `public/client.html` - Original live client (reference)

## Known Limitations

1. **iOS Autoplay**: iOS Safari blocks unmuted autoplay without user interaction. This is a browser limitation, not a bug.

2. **Guided Access**: When using Guided Access, the screen may dim after a period of inactivity. Adjust auto-lock settings as needed.

3. **Background Playback**: iOS may pause video playback when the app is in the background. This is expected behavior.

4. **Multiple Videos**: The current implementation supports one video per HTML file. For multiple videos, create multiple HTML files.
