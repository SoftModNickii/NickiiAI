// NICKII AI, the address.
//
// The visitor must never see an IP. This answers DNS for nickii.ai (and any
// subdomain of it) with the Mac's own address, so the iPad reaches the
// installation at https://nickii.ai and the fiction holds even if someone
// glances at the address bar during setup.
//
// Everything else is forwarded to the Mac's real resolver, so pointing the
// iPad here does not cost it the rest of the internet. In the gallery there is
// no uplink and those forwards simply time out, which is correct: the only
// name that resolves on that network is hers.
//
// Port 53 needs root:  sudo node scripts/dns.js
// Override:            NICKII_DOMAIN=nickii.ai NICKII_IP=10.0.0.177

const dgram = require('dgram');
const os = require('os');
const { execSync } = require('child_process');

const DOMAIN = (process.env.NICKII_DOMAIN || 'nickii.ai').toLowerCase();
const PORT = parseInt(process.env.NICKII_DNS_PORT, 10) || 53;
const TTL = 60;

function localAddress() {
  if (process.env.NICKII_IP) return process.env.NICKII_IP;
  // Prefer the Internet Sharing bridge (the show network), then normal Wi-Fi.
  const ifaces = os.networkInterfaces();
  const order = ['bridge100', 'en0', 'en1'];
  for (const name of order.concat(Object.keys(ifaces))) {
    for (const a of ifaces[name] || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return '127.0.0.1';
}

function upstreamResolver() {
  if (process.env.NICKII_UPSTREAM) return process.env.NICKII_UPSTREAM;
  try {
    const out = execSync('scutil --dns', { encoding: 'utf8' });
    const hit = out.split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('nameserver['))
      .map((l) => l.split(':')[1].trim())
      .filter((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !ip.startsWith('127.'));
    if (hit.length) return hit[0];
  } catch (_) {}
  return '1.1.1.1';
}

const IP = localAddress();
const UPSTREAM = upstreamResolver();

// ------------------------------------------------------------ packet helpers
function readName(buf, offset) {
  const labels = [];
  let jumped = false;
  let pos = offset;
  let end = offset;
  let guard = 0;

  while (pos < buf.length && guard++ < 128) {
    const len = buf[pos];
    if (len === 0) { pos += 1; if (!jumped) end = pos; break; }
    if ((len & 0xc0) === 0xc0) {                 // compression pointer
      const ptr = ((len & 0x3f) << 8) | buf[pos + 1];
      if (!jumped) end = pos + 2;
      pos = ptr;
      jumped = true;
      continue;
    }
    labels.push(buf.toString('ascii', pos + 1, pos + 1 + len));
    pos += 1 + len;
    if (!jumped) end = pos;
  }
  return { name: labels.join('.').toLowerCase(), end };
}

function isOurs(name) {
  return name === DOMAIN || name.endsWith('.' + DOMAIN);
}

function answerA(query, questionEnd, ip) {
  const header = Buffer.from(query.slice(0, 12));
  header.writeUInt16BE(0x8180, 2);   // response, recursion desired + available
  header.writeUInt16BE(1, 4);        // QDCOUNT
  header.writeUInt16BE(1, 6);        // ANCOUNT
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);

  const question = query.slice(12, questionEnd);

  const rr = Buffer.alloc(16);
  rr.writeUInt16BE(0xc00c, 0);       // pointer back to the question name
  rr.writeUInt16BE(1, 2);            // TYPE A
  rr.writeUInt16BE(1, 4);            // CLASS IN
  rr.writeUInt32BE(TTL, 6);
  rr.writeUInt16BE(4, 10);           // RDLENGTH
  ip.split('.').forEach((o, i) => { rr[12 + i] = parseInt(o, 10); });

  return Buffer.concat([header, question, rr]);
}

// NOERROR with no answers. Used for AAAA on our own name, so the client falls
// straight back to IPv4 instead of treating the name as nonexistent.
function answerEmpty(query, questionEnd) {
  const header = Buffer.from(query.slice(0, 12));
  header.writeUInt16BE(0x8180, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(0, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);
  return Buffer.concat([header, query.slice(12, questionEnd)]);
}

// ------------------------------------------------------------ server
const server = dgram.createSocket('udp4');

server.on('message', (msg, rinfo) => {
  if (msg.length < 12) return;

  let name, qtype, questionEnd;
  try {
    const q = readName(msg, 12);
    name = q.name;
    qtype = msg.readUInt16BE(q.end);
    questionEnd = q.end + 4;
  } catch (_) {
    return;
  }

  if (isOurs(name)) {
    const reply = (qtype === 1)
      ? answerA(msg, questionEnd, IP)
      : answerEmpty(msg, questionEnd);
    server.send(reply, rinfo.port, rinfo.address);
    if (qtype === 1) console.log(`${name} -> ${IP}  (${rinfo.address})`);
    return;
  }

  // Not ours: relay it and pass the answer straight back.
  const relay = dgram.createSocket('udp4');
  const timer = setTimeout(() => { try { relay.close(); } catch (_) {} }, 3000);
  relay.on('message', (res) => {
    clearTimeout(timer);
    server.send(res, rinfo.port, rinfo.address);
    try { relay.close(); } catch (_) {}
  });
  relay.on('error', () => { clearTimeout(timer); try { relay.close(); } catch (_) {} });
  relay.send(msg, 53, UPSTREAM);
});

server.on('error', (err) => {
  if (err.code === 'EACCES') {
    console.error('\n  Port 53 needs root.  Run:  sudo node scripts/dns.js\n');
  } else if (err.code === 'EADDRINUSE') {
    console.error('\n  Port 53 is already in use. Another DNS server is running.\n');
  } else {
    console.error(err.message);
  }
  process.exit(1);
});

server.bind(PORT, '0.0.0.0', () => {
  console.log('');
  console.log(`  NICKII DNS on 0.0.0.0:${PORT}`);
  console.log(`  ${DOMAIN} (and *.${DOMAIN}) -> ${IP}`);
  console.log(`  everything else -> ${UPSTREAM}`);
  console.log('');
  console.log(`  On the iPad: Settings > Wi-Fi > (i) > Configure DNS > Manual,`);
  console.log(`  remove what is there and add ${IP}`);
  console.log('');
});
