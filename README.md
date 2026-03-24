# NICKII AI - WebRTC Streaming System

A professional AI streaming interface with WebRTC support for live video/audio streaming and real-time viewer interaction.

## Features

- 🎥 **WebRTC Live Streaming** from OBS Virtual Camera
- 🎤 **Audio Support** via BlackHole 2ch or system audio
- 📱 **Mobile Optimized** UI with responsive design
- 👥 **Multiple Viewers** can connect simultaneously
- 🎛️ **Control Panel** with Matrix green theme
- 💬 **Real-time Prompts** from viewers to presenter
- 📹 **Optional Viewer Webcam** feedback to control panel
- 🎨 **Premium Pink/Glitter** AI aesthetic

## Quick Start

### Local Development
```bash
npm install
npm start
```

Visit:
- **Viewer Interface**: http://localhost:3000
- **Control Panel**: http://localhost:3000/control

## Deployment to Render.com

### Prerequisites
- GitHub repository with your code
- Render.com account (free tier available)

### Step-by-Step Deployment

1. **Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial NICKII AI commit"
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

2. **Connect to Render**:
   - Go to [render.com](https://render.com)
   - Sign up/login with GitHub
   - Click "New +" → "Web Service"
   - Connect your GitHub repository

3. **Configure Service**:
   - **Name**: `nickii-ai`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free tier is sufficient for testing

4. **Deploy**:
   - Click "Create Web Service"
   - Render will automatically deploy your app
   - You'll get a URL like: `https://nickii-ai-xxxx.onrender.com`

### Post-Deployment

- **Viewer Interface**: `https://your-app.onrender.com`
- **Control Panel**: `https://your-app.onrender.com/control`

## Usage Instructions

### For Presenters (Control Panel)
1. Open `/control` URL
2. Select camera source (OBS Virtual Camera recommended)
3. Select audio source (BlackHole 2ch for system audio)
4. Click "START CAMERA + MIC" or "START SCREEN SHARE + AUDIO"
5. Share the main URL with viewers

### For Viewers (Main Interface)  
1. Open the main URL
2. Click "Connect to Nickii AI"
3. Watch the stream (camera permission is optional)
4. Send prompts via the input field
5. Optional: Allow camera access to appear in presenter's return feed

## Technical Details

- **Backend**: Node.js + Express + WebSocket
- **Frontend**: Vanilla JavaScript + WebRTC
- **Styling**: Custom CSS with mobile-first responsive design
- **Real-time**: WebSocket for signaling, WebRTC for media

## Browser Compatibility

- ✅ Chrome/Chromium (recommended)
- ✅ Safari (including mobile)
- ✅ Firefox 
- ✅ Edge

## Audio/Video Sources

- **OBS Virtual Camera**: Recommended for professional streaming
- **BlackHole 2ch**: For routing system audio on macOS
- **Screen Share**: Built-in browser screen capture
- **Physical Camera/Mic**: Standard webcam/microphone

## Troubleshooting

### Common Issues
- **No Audio on Mobile**: Audio starts on first user interaction (tap screen)
- **Camera Permission**: Optional for viewers, required for presenters
- **WebRTC Connection**: Ensure HTTPS in production for best compatibility

### Free Tier Limitations
- Render free tier sleeps after 15 minutes of inactivity
- First request after sleep takes ~30 seconds to wake up
- Consider paid tier for production use

## License

ISC License