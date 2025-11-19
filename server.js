const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static('public'));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

app.get('/control', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'control.html'));
});

// Store connected clients
const clients = {
  viewers: new Set(),
  controller: null
};

wss.on('connection', (ws, req) => {
  console.log('New connection established');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'register-viewer':
          clients.viewers.add(ws);
          console.log('Viewer registered. Total viewers:', clients.viewers.size);
          break;

        case 'register-controller':
          clients.controller = ws;
          console.log('Controller registered');
          break;

        case 'video-chunk':
          // Broadcast video data to all viewers
          clients.viewers.forEach(viewer => {
            if (viewer.readyState === WebSocket.OPEN) {
              viewer.send(JSON.stringify({
                type: 'video-chunk',
                data: data.data
              }));
            }
          });
          break;

        case 'prompt':
          // Send prompt to controller
          if (clients.controller && clients.controller.readyState === WebSocket.OPEN) {
            clients.controller.send(JSON.stringify({
              type: 'prompt',
              text: data.text,
              timestamp: Date.now()
            }));
          }
          break;

        case 'webrtc-offer':
        case 'webrtc-answer':
        case 'webrtc-ice-candidate':
        case 'return-feed-offer':
        case 'return-feed-answer':
        case 'return-feed-ice':
          // Forward WebRTC signaling messages
          console.log('Forwarding WebRTC message:', data.type, 'to:', data.target);
          
          // FIXED: Send the parsed data as JSON, not the raw message
          if (data.target === 'controller' && clients.controller) {
            if (clients.controller.readyState === WebSocket.OPEN) {
              clients.controller.send(JSON.stringify(data));
            }
          } else if (data.target === 'viewer') {
            clients.viewers.forEach(viewer => {
              if (viewer.readyState === WebSocket.OPEN) {
                viewer.send(JSON.stringify(data));
              }
            });
          }
          break;
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    clients.viewers.delete(ws);
    if (clients.controller === ws) {
      clients.controller = null;
    }
    console.log('Connection closed. Viewers:', clients.viewers.size);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 NICKII AI Server running on port ${PORT}`);
  console.log(`📺 Client view: http://localhost:${PORT}/`);
  console.log(`🎛️  Control panel: http://localhost:${PORT}/control`);
});
