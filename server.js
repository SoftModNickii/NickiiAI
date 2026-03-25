const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
 
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;
 
app.use(express.static('public'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'client.html')));
app.get('/control', (req, res) => res.sendFile(path.join(__dirname, 'public', 'control.html')));
 
const clients = {
  viewers: new Set(),
  controller: null,
  connectionCount: 0, // Track connections for rate limiting
  maxConnections: 100 // Prevent overwhelming the server
};
 
// ── THE FIX ──
// Cache the last offer + ICE candidates from the controller.
// Any viewer that joins late gets them immediately on registration.
let cachedOffer = null;
let cachedIceCandidates = [];
 
wss.on('connection', (ws, req) => {
  // Basic rate limiting
  if (clients.connectionCount >= clients.maxConnections) {
    console.log('Connection limit reached, rejecting connection');
    ws.close(1013, 'Server overloaded');
    return;
  }
  
  clients.connectionCount++;
  console.log('New connection. Total connections:', clients.connectionCount);
 
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
 
      switch (data.type) {
 
        case 'register-viewer':
          clients.viewers.add(ws);
          console.log('Viewer registered. Total:', clients.viewers.size);
 
          // Tell controller how many viewers
          sendToController({ type: 'viewer-count', count: clients.viewers.size });
 
          // If we have a cached offer, send it immediately to this viewer
          // so they don't have to wait for the controller to resend
          if (cachedOffer) {
            console.log('Sending cached offer to new viewer');
            ws.send(JSON.stringify({ type: 'webrtc-offer', offer: cachedOffer }));
            // Also replay all cached ICE candidates
            cachedIceCandidates.forEach(candidate => {
              ws.send(JSON.stringify({ type: 'webrtc-ice-candidate', candidate }));
            });
          } else {
            // No cached offer yet — ask controller to create a fresh one
            sendToController({ type: 'request-offer' });
          }
          break;
 
        case 'register-controller':
          clients.controller = ws;
          // Reset cache when controller reconnects
          cachedOffer = null;
          cachedIceCandidates = [];
          console.log('Controller registered');
          sendToController({ type: 'viewer-count', count: clients.viewers.size });
          break;
 
        case 'webrtc-offer':
          // Cache it for late-joining viewers
          cachedOffer = data.offer;
          cachedIceCandidates = [];
          console.log('Offer cached. Broadcasting to', clients.viewers.size, 'viewers');
          broadcastToViewers(data);
          break;
 
        case 'webrtc-ice-candidate':
          if (data.target === 'viewer') {
            // Cache ICE candidates too
            if (data.candidate) cachedIceCandidates.push(data.candidate);
            broadcastToViewers(data);
          } else if (data.target === 'controller') {
            sendToController(data);
          }
          break;
 
        case 'webrtc-answer':
          // Answer goes back to controller
          sendToController(data);
          break;
 
        case 'prompt':
          console.log('Prompt received:', data.text);
          sendToController({ type: 'prompt', text: data.text, timestamp: Date.now() });
          break;
 
        case 'return-feed-offer':
        case 'return-feed-answer':
        case 'return-feed-ice':
          // Return feed signaling — forward to correct target
          if (data.target === 'controller') sendToController(data);
          else broadcastToViewers(data);
          break;
      }
 
    } catch (err) {
      console.error('Error:', err);
    }
  });
 
  ws.on('close', () => {
    clients.connectionCount--;
    const wasViewer = clients.viewers.has(ws);
    clients.viewers.delete(ws);
 
    if (clients.controller === ws) {
      clients.controller = null;
      // Clear cache when controller disconnects
      cachedOffer = null;
      cachedIceCandidates = [];
      console.log('Controller disconnected — cache cleared');
    }
 
    if (wasViewer) {
      console.log('Viewer left. Remaining viewers:', clients.viewers.size, 'Total connections:', clients.connectionCount);
      sendToController({ type: 'viewer-count', count: clients.viewers.size });
    }
  });
 
  ws.on('error', console.error);
});
 
function sendToController(data) {
  if (clients.controller && clients.controller.readyState === WebSocket.OPEN) {
    clients.controller.send(JSON.stringify(data));
  }
}
 
function broadcastToViewers(data) {
  clients.viewers.forEach(viewer => {
    if (viewer.readyState === WebSocket.OPEN) {
      viewer.send(JSON.stringify(data));
    }
  });
}
 
server.listen(PORT, () => {
  console.log(`NICKII AI running on port ${PORT}`);
});
 