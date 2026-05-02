#!/usr/bin/env node

'use strict';

const os   = require('os');
const fs   = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT    = __dirname;
const MOBILE  = path.join(ROOT, 'mobile');
const BACKEND = path.join(ROOT, 'backend');

// ─── 1. Resolve local IPv4 from active Wi-Fi / LAN adapter ───────────────────
function getLocalIPv4() {
  const ifaces = os.networkInterfaces();
  // Prefer Wi-Fi adapter
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (/wi.?fi|wlan|wireless/i.test(name)) {
      for (const a of addrs) {
        if (a.family === 'IPv4' && !a.internal) return a.address;
      }
    }
  }
  // Fallback: any non-loopback IPv4
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  throw new Error('Could not detect a local IPv4 address. Make sure Wi-Fi is active.');
}

// ─── 2. Patch BASE_URL in the React Native API client ────────────────────────
function patchApiClient(ipv4) {
  const clientPath = path.join(MOBILE, 'src', 'api', 'client.ts');
  if (!fs.existsSync(clientPath)) {
    console.error(`[autoboot] ERROR: API client not found at: ${clientPath}`);
    process.exit(1);
  }

  let src    = fs.readFileSync(clientPath, 'utf8');
  const newUrl = `http://${ipv4}:5000`;

  // Matches any http://...:5000 string literal (single/double/backtick quotes)
  const re = /(['"`])http:\/\/[^'"`]+:5000\1/g;
  if (!re.test(src)) {
    console.warn('[autoboot] WARNING: No :5000 URL found in client.ts — skipping patch.');
    return;
  }

  src = src.replace(re, `'${newUrl}'`);
  fs.writeFileSync(clientPath, src, 'utf8');
  console.log(`[autoboot] ✔ Patched BASE_URL → ${newUrl}`);
}

// ─── 3. Ensure mobile dependencies are installed ─────────────────────────────
function ensureMobileDeps() {
  const nm = path.join(MOBILE, 'node_modules');
  if (fs.existsSync(nm)) {
    console.log('[autoboot] ✔ mobile/node_modules already present — skipping npm install.');
    return;
  }
  console.log('[autoboot] mobile/node_modules not found — running npm install...');
  const result = spawnSync('npm', ['install'], {
    cwd: MOBILE,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    console.error('[autoboot] npm install failed inside mobile/. Aborting.');
    process.exit(1);
  }
  console.log('[autoboot] ✔ npm install complete.');
}

// ─── 4. Spawn backend server ──────────────────────────────────────────────────
function startBackend() {
  const serverScript = path.join(BACKEND, 'server.js');
  if (!fs.existsSync(serverScript)) {
    console.error(`[autoboot] ERROR: Backend server not found at: ${serverScript}`);
    process.exit(1);
  }

  console.log('[autoboot] Clearing port 5000…');
  killPort(5000);

  console.log('[autoboot] Starting backend server…');
  const server = spawn('node', ['server.js'], {
    cwd: BACKEND,
    stdio: 'inherit',
    env: { ...process.env },
    shell: false,
  });

  server.on('error', (err) => {
    console.error(`[autoboot] Backend spawn error: ${err.message}`);
    process.exit(1);
  });

  server.on('exit', (code, signal) => {
    if (code !== 0) {
      console.error(`[autoboot] Backend exited (code=${code}, signal=${signal})`);
      process.exit(code ?? 1);
    }
  });
}

// ─── 5. ADB reverse — tunnel ports to USB-connected Android device ──────────
function adbReverse(ports) {
  try {
    const check = spawnSync('adb', ['devices'], { encoding: 'utf8', shell: true });
    const lines = (check.stdout || '').split(/\r?\n/).filter(l => l && !l.startsWith('List'));
    const connected = lines.some(l => /\bdevice\b/.test(l));
    if (!connected) {
      console.warn('[autoboot] ⚠ No ADB device detected — skipping adb reverse (USB not connected?).');
      return;
    }
    for (const port of ports) {
      const r = spawnSync('adb', ['reverse', `tcp:${port}`, `tcp:${port}`], {
        encoding: 'utf8',
        shell: true,
      });
      if (r.status === 0) {
        console.log(`[autoboot] ✔ adb reverse tcp:${port} → tcp:${port}`);
      } else {
        console.warn(`[autoboot] ⚠ adb reverse tcp:${port} failed: ${r.stderr || r.stdout}`);
      }
    }
  } catch (e) {
    console.warn(`[autoboot] Could not run adb reverse: ${e.message}`);
  }
}

// ─── 6. Kill any process occupying a port (Windows) ─────────────────────────
function killPort(port) {
  try {
    // Find PIDs listening on the given port
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-Command',
        `$p = netstat -ano | Select-String ":${port}\\s" | ForEach-Object { ($_ -split '\\s+')[-1] } | Sort-Object -Unique; $p`
      ],
      { encoding: 'utf8' }
    );
    const pids = (result.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (pids.length === 0) {
      console.log(`[autoboot] Port ${port} is free.`);
      return;
    }
    for (const pid of pids) {
      if (!pid || pid === '0') continue;
      console.log(`[autoboot] Killing PID ${pid} on port ${port}…`);
      spawnSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' });
    }
    console.log(`[autoboot] ✔ Port ${port} cleared.`);
  } catch (e) {
    console.warn(`[autoboot] Could not clear port ${port}: ${e.message}`);
  }
}

// ─── 6. Spawn Metro bundler (must run inside mobile/) ─────────────────────────
function startMetro() {
  console.log('[autoboot] Clearing port 8081…');
  killPort(8081);

  console.log('[autoboot] Starting Metro bundler (inside mobile/)…');

  // On Windows, .cmd shims must be invoked via cmd /c to avoid EINVAL with shell:false
  const rnBin = path.join(MOBILE, 'node_modules', '.bin', 'react-native.cmd');

  const metro = spawn('cmd', ['/c', rnBin, 'start', '--reset-cache'], {
    cwd: MOBILE,
    stdio: 'inherit',
    env: { ...process.env },
    shell: false,
  });

  metro.on('error', (err) => {
    console.error(`[autoboot] Metro spawn error: ${err.message}`);
    process.exit(1);
  });

  metro.on('exit', (code, signal) => {
    console.warn(`[autoboot] Metro exited (code=${code}, signal=${signal})`);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(function main() {
  console.log('\n[autoboot] ── Kasam360 Dev Boot ──────────────────────────────');

  const ipv4 = (() => {
    try {
      const ip = getLocalIPv4();
      console.log(`[autoboot] Detected local IPv4: ${ip}`);
      return ip;
    } catch (err) {
      console.error(`[autoboot] ${err.message}`);
      process.exit(1);
    }
  })();

  patchApiClient(ipv4);
  ensureMobileDeps();
  startBackend();

  // Tunnel both ports to USB-connected Android device before Metro starts
  adbReverse([5000, 8081]);

  startMetro();

  console.log('[autoboot] ─────────────────────────────────────────────────────');
  console.log('[autoboot] 📱 If STILL unable to load script, shake device →');
  console.log('[autoboot]    Dev Settings → Debug server host → set: 127.0.0.1:8081');
  console.log('[autoboot] ─────────────────────────────────────────────────────\n');
})();
