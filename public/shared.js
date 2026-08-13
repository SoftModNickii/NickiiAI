// NICKII AI, shared connection layer.
// Section 9 "Connection layer" of NICKIIAI.md. Used by client.html and control.html.
//
// One socket per page, with:
//   - origin derived wss:// URL, so the same files work locally and on Render
//   - automatic role registration on every (re)connect
//   - client heartbeat every 20 s expecting hb-ack, which catches half open
//     sockets that a TCP level ping does not
//   - exponential backoff reconnect with jitter, reset after 60 s stable
//   - intentionalClose flag so a deliberate close does not reconnect
//   - a liveness watchdog escalating from "recover" to "reload"

(function (global) {
  'use strict';

  var DEFAULTS = {
    sampleRate: 16000,
    maxUtteranceSeconds: 30,
    heartbeatClientMs: 20000,
    reconnect: { baseMs: 1000, maxMs: 30000, factor: 2, jitter: 0.1 },
    watchdogNoFeedMs: 15000,
    watchdogReloadMs: 45000,
    preferredDevices: { video: 'OBS Virtual Camera', audio: 'BlackHole' },
    render: { sharpen: 0.34, clarity: 0.40, bloom: 0.40, lightWrap: 0.50, saturation: 0.90 },
    iceServers: [],
  };

  var STABLE_MS = 60000;   // connected this long resets the backoff

  // The server is the single source of configuration. These defaults only
  // cover the window before /config.json answers, or a failed fetch.
  function loadConfig() {
    return fetch('/config.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (c) {
        var merged = {};
        Object.keys(DEFAULTS).forEach(function (k) { merged[k] = DEFAULTS[k]; });
        Object.keys(c || {}).forEach(function (k) { if (c[k] !== undefined && c[k] !== null) merged[k] = c[k]; });
        return merged;
      })
      .catch(function () { return DEFAULTS; });
  }

  function socketUrl() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host;
  }

  function createSocket(opts) {
    var cfg = opts.config || DEFAULTS;
    var rc = cfg.reconnect || DEFAULTS.reconnect;

    var ws = null;
    var attempt = 0;
    var intentionalClose = false;
    var connectedAt = 0;
    var hbTimer = null;
    var watchdogTimer = null;
    var reconnectTimer = null;

    var pendingHbSince = 0; // when the oldest unanswered hb went out, 0 if all answered
    var lastFrameAt = 0;    // last observed progress on the incoming video
    var escalated = false;  // recovery already attempted this stale episode

    function status(s, detail) {
      if (opts.onStatus) { try { opts.onStatus(s, detail); } catch (e) {} }
    }

    function connect() {
      clearTimeout(reconnectTimer);
      try {
        ws = new WebSocket(socketUrl());
      } catch (e) {
        return scheduleReconnect();
      }
      ws.binaryType = 'arraybuffer';

      ws.onopen = function () {
        connectedAt = Date.now();
        pendingHbSince = 0;
        escalated = false;
        send({ type: opts.role === 'controller' ? 'register-controller' : 'register-viewer' });
        status('open');
        if (opts.onOpen) opts.onOpen();
        startHeartbeat();
      };

      ws.onmessage = function (ev) {
        if (typeof ev.data !== 'string') {
          if (opts.onBinary) opts.onBinary(ev.data);
          return;
        }
        var data;
        try { data = JSON.parse(ev.data); } catch (e) { return; }
        if (data.type === 'hb-ack') { pendingHbSince = 0; return; }
        if (opts.onJson) opts.onJson(data);
      };

      ws.onclose = function () {
        stopHeartbeat();
        status('closed');
        if (opts.onClose) opts.onClose();
        if (!intentionalClose) scheduleReconnect();
      };

      ws.onerror = function () { /* onclose always follows, handle it there */ };
    }

    function scheduleReconnect() {
      // A connection that stayed up for a while starts over from the base delay.
      if (connectedAt && Date.now() - connectedAt > STABLE_MS) attempt = 0;
      connectedAt = 0;

      var delay = Math.min(rc.baseMs * Math.pow(rc.factor, attempt), rc.maxMs);
      delay = delay + delay * rc.jitter * (Math.random() * 2 - 1);
      attempt += 1;
      status('reconnecting', Math.round(delay));
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, Math.max(250, Math.round(delay)));
    }

    function startHeartbeat() {
      stopHeartbeat();
      hbTimer = setInterval(function () {
        // Time the socket by how long an hb has gone unanswered, not by how
        // long since the last ack. Acks are only ever as fresh as the interval,
        // so "last ack was 15 s ago" is normal, not a fault.
        if (send({ type: 'hb' }) && !pendingHbSince) pendingHbSince = Date.now();
      }, cfg.heartbeatClientMs);
      watchdogTimer = setInterval(checkWatchdog, 2000);
    }

    function stopHeartbeat() {
      clearInterval(hbTimer); hbTimer = null;
      clearInterval(watchdogTimer); watchdogTimer = null;
    }

    // Alive means either the socket is answering or the video is still moving.
    // Both silent for watchdogNoFeedMs means something is wedged.
    function checkWatchdog() {
      var now = Date.now();
      var socketQuiet = pendingHbSince ? now - pendingHbSince : 0;
      var frameQuiet = lastFrameAt ? now - lastFrameAt : Infinity;
      var quietFor = Math.min(socketQuiet, frameQuiet);
      if (quietFor === Infinity) return;

      if (quietFor < cfg.watchdogNoFeedMs) { escalated = false; return; }

      if (quietFor > cfg.watchdogReloadMs) {
        status('dead', quietFor);
        if (opts.onDead) opts.onDead(quietFor);
        else location.reload();
        return;
      }
      if (!escalated) {
        escalated = true;
        status('stale', quietFor);
        if (opts.onStale) opts.onStale(quietFor);
      }
    }

    function send(obj) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
        return true;
      }
      return false;
    }

    function sendBinary(buf) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(buf);
        return true;
      }
      return false;
    }

    connect();

    return {
      send: send,
      sendBinary: sendBinary,
      // The client calls this when the incoming video actually advances, which
      // is the only proof the feed itself is alive.
      noteFrame: function () { lastFrameAt = Date.now(); escalated = false; },
      isOpen: function () { return !!ws && ws.readyState === WebSocket.OPEN; },
      close: function () {
        intentionalClose = true;
        stopHeartbeat();
        clearTimeout(reconnectTimer);
        if (ws) ws.close();
      },
      config: cfg,
    };
  }

  global.NickiiNet = { loadConfig: loadConfig, createSocket: createSocket, DEFAULTS: DEFAULTS };
})(window);
