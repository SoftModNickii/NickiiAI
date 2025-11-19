# NICKII AI - Deployment Guide

## 🚀 Quick Start

This guide will help you set up NICKII AI so it works on two different computers over the internet.

---

## 📋 What You're Setting Up

- **Webpage 1 (Client)**: Beautiful pink/white AI interface for viewers
- **Webpage 2 (Control)**: Backend control panel where you manage OBS stream
- **Server**: Connects both webpages together

---

## 🔧 Step 1: Install Node.js

If you don't have Node.js installed:

1. Go to https://nodejs.org/
2. Download and install the LTS version
3. Verify installation by opening terminal and typing:
   ```
   node --version
   ```

---

## 💻 Step 2: Set Up the Project Locally

### On your main computer:

1. Open terminal/command prompt
2. Navigate to the project folder:
   ```bash
   cd /tmp/nickii-ai
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Start the server:
   ```bash
   npm start
   ```

5. You should see:
   ```
   🚀 NICKII AI Server running on port 3000
   📺 Client view: http://localhost:3000/
   🎛️  Control panel: http://localhost:3000/control
   ```

6. Test locally:
   - Open browser → `http://localhost:3000/` (Client view)
   - Open another tab → `http://localhost:3000/control` (Control panel)

---

## 🌐 Step 3: Deploy to Internet (Choose One Method)

### **Option A: Render.com (Recommended - FREE)**

1. **Create account**: Go to https://render.com and sign up

2. **Create new Web Service**:
   - Click "New +" → "Web Service"
   - Connect your GitHub account OR choose "Deploy from Git"
   
3. **If using GitHub**:
   - Create a new repo on GitHub
   - Upload your `nickii-ai` folder
   - Select the repo in Render

4. **Configure the service**:
   - Name: `nickii-ai`
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: `Free`

5. **Deploy**: Click "Create Web Service"

6. **Get your URL**: After deployment, you'll get a URL like:
   ```
   https://nickii-ai.onrender.com
   ```

7. **Access your pages**:
   - Client: `https://nickii-ai.onrender.com/`
   - Control: `https://nickii-ai.onrender.com/control`

---

### **Option B: Railway.app (Also FREE)**

1. Go to https://railway.app
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Upload your code to GitHub first, then select it
5. Railway auto-detects Node.js and deploys
6. You'll get a URL like `https://nickii-ai.up.railway.app`

---

### **Option C: Heroku (FREE tier available)**

1. Install Heroku CLI: https://devcli.heroku.com/
2. Login: `heroku login`
3. Create app:
   ```bash
   cd /tmp/nickii-ai
   git init
   git add .
   git commit -m "Initial commit"
   heroku create nickii-ai
   git push heroku master
   ```
4. Your app: `https://nickii-ai.herokuapp.com`

---

## 🎥 Step 4: Set Up OBS (Computer with OBS)

### For macOS/Windows:

1. **Install OBS Virtual Camera** (if not already):
   - OBS Studio → Tools → Start Virtual Camera

2. **In Control Panel webpage** (`your-url.com/control`):
   - Click "Start Stream"
   - Browser will ask for screen/camera permission
   - Select "OBS Virtual Camera" from the list
   - Or select your OBS window/screen

3. **Alternative**: Use window capture:
   - Share your screen/OBS window instead of virtual camera
   - Works the same way!

---

## 📱 Step 5: Access from Different Computers

### Computer 1 (Your OBS computer):
```
https://your-deployed-url.com/control
```
- This is your control panel
- Start stream here
- See incoming prompts here

### Computer 2 (Viewer computer):
```
https://your-deployed-url.com/
```
- This is the NICKII AI client interface
- See the live stream here
- Type prompts here

---

## ✅ Testing the Setup

1. **On Control Computer**:
   - Open control panel
   - Click "Start Stream"
   - Select OBS Virtual Camera or screen
   - You should see "STREAMING" status

2. **On Viewer Computer**:
   - Open client page
   - You should see video appear
   - Type a prompt and press send
   - Check control panel - prompt should appear there!

---

## 🔥 Troubleshooting

### Video not showing:
- Make sure OBS Virtual Camera is running
- Try screen share instead
- Check browser permissions (camera/screen access)
- Refresh both pages

### Pages can't connect:
- Make sure server is deployed and running
- Check if URL is correct (https, not http)
- Clear browser cache
- Check browser console for errors (F12)

### Prompts not appearing:
- Check WebSocket connection (should show "CONNECTED")
- Refresh both pages
- Check internet connection

### Free tier sleeping (Render.com):
- Free tier sleeps after 15 min of inactivity
- First load takes 30-60 seconds to wake up
- Keep a tab open to prevent sleep
- Or upgrade to paid tier ($7/mo)

---

## 🎨 Customization

### Change colors in client view:
Edit `/tmp/nickii-ai/public/client.html` - look for gradient colors in CSS

### Change control panel colors:
Edit `/tmp/nickii-ai/public/control.html` - change `#00ff41` to your color

---

## 📞 Common Issues

**"Cannot connect to server"**
- Server might be starting (wait 30-60 sec on free tier)
- Check if server URL is correct
- Try https:// instead of http://

**"No video source found"**
- OBS Virtual Camera must be started in OBS
- Or use screen sharing as alternative
- Give browser permission to access camera/screen

**"CORS errors"**
- This shouldn't happen with this setup
- If it does, server might not be deployed correctly

---

## 🎯 Next Steps

1. **Custom domain**: Most hosting services let you add custom domains
2. **SSL Certificate**: Comes free with Render/Railway/Heroku
3. **Analytics**: Add tracking to see viewer count
4. **Chat feature**: Can be added if needed

---

## 💡 Tips

- Keep control panel open while streaming
- Test with both pages on same computer first
- OBS Virtual Camera is easier than screen share
- Free tiers work great for testing/small audiences
- For high traffic, upgrade to paid hosting

---

## 🆘 Need Help?

Common commands:
```bash
# Check if server is running locally
npm start

# Restart server
# Press Ctrl+C then npm start again

# Check Node.js version
node --version

# Reinstall dependencies
npm install
```

---

**You're all set! 🎉**

Your NICKII AI system is ready to stream!
