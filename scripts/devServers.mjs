import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

// Port seçimi ile servis başlangıcı arasında diğer servisler aynı portu seçmesin.
export async function reservePort(preferred) {
  for (let port = preferred; port < Math.min(preferred + 100, 65536); port++) {
    const listening = await Promise.all(['127.0.0.1', '::1'].map(host => new Promise(resolve => {
      const socket = net.connect({ host, port });
      const done = value => { socket.destroy(); resolve(value); };
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.setTimeout(350, () => done(false));
    })));
    if (listening.some(Boolean)) continue;
    const servers = [];
    let failure;
    for (const host of ['127.0.0.1', '::1']) {
      const server = net.createServer(socket => socket.destroy());
      const error = await new Promise(resolve => {
        server.once('error', resolve);
        server.listen({ port, host, ipv6Only: host === '::1', exclusive: true }, () => resolve(null));
      });
      if (!error) servers.push(server);
      else if (!['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) { failure = error; break; }
    }
    const release = () => Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    if (!failure && servers.length) return { port, release };
    await release();
    if (failure && !['EADDRINUSE', 'EACCES'].includes(failure.code)) throw failure;
  }
  throw new Error(`${preferred} çevresinde boş port bulunamadı.`);
}

export function origins(ports) {
  const web = `http://127.0.0.1:${ports.web}`;
  return { web, api: `http://127.0.0.1:${ports.api}`, labs: `http://127.0.0.1:${ports.labs}`,
    desktop: `http://localhost:${ports.desktop}`, callback: `${web}/api/auth/callback/google` };
}

export function missingSmtpFields(fileEnv, inheritedEnv = process.env) {
  const effectiveEnv = { ...inheritedEnv, ...fileEnv };
  return ['SMTP_HOST', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'SMTP_FROM'].filter(name => !effectiveEnv[name]?.trim());
}

/** Next generated declarations belong to the launcher state directory, never the source tree. */
export function ensureNextProject(sourceDir, projectDir) {
  mkdirSync(projectDir, { recursive: true });
  for (const name of ['src', 'public', 'node_modules']) {
    const source = path.join(sourceDir, name);
    const target = path.join(projectDir, name);
    if (!existsSync(target)) symlinkSync(source, target, 'junction');
    else if (realpathSync(target) !== realpathSync(source)) {
      throw new Error(`Next yalıtılmış proje yolu başka bir hedefe bağlı: ${target}`);
    }
  }
  for (const name of ['package.json', 'next.config.ts', 'postcss.config.mjs', 'tsconfig.json']) {
    const source = path.join(sourceDir, name);
    const target = path.join(projectDir, name);
    if (existsSync(source) && (!existsSync(target) || readFileSync(source, 'utf8') !== readFileSync(target, 'utf8'))) {
      copyFileSync(source, target);
    }
  }
  return projectDir;
}

export async function serviceReady(url, child, stopped, timeoutMs = 240000) {
  const deadline = Date.now() + timeoutMs;
  while (!stopped() && Date.now() < deadline) {
    if (child.exitCode !== null || child.spawnFailed) return false;
    try { const response = await fetch(url, { signal: AbortSignal.timeout(1500) }); if (response.ok) return true; } catch { /* Başlangıçta port henüz açık olmayabilir. */ }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  return false;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dirs = { labs: path.resolve(root, '../360labs'), api: path.join(root, 'backend/api'),
    web: path.join(root, 'web'), desktop: path.join(root, 'desktop'), native: path.join(root, 'backend') };
  // --state-dir yalıtılmış kabul içindir: ayrı kilit, Mongo, Labs verisi, derleme klasörü ve native uygulama kimliği
  // kullanır; böylece kullanıcının açık başlatıcısına, kilitli exe'lerine ve yerel kasa verisine dokunmaz.
  const stateArg = process.argv.find(arg => arg.startsWith('--state-dir='));
  const isolated = Boolean(stateArg);
  const stateDir = stateArg ? path.resolve(stateArg.slice('--state-dir='.length)) : path.join(root, '.dev-servers');
  const stateFile = path.join(stateDir, 'addresses.json');
  const load = dir => existsSync(path.join(dir, '.env')) ? parseEnv(readFileSync(path.join(dir, '.env'), 'utf8')) : {};
  const apiEnv = load(dirs.api), labsEnv = load(dirs.labs);
  for (const dir of [dirs.api, dirs.web, dirs.desktop]) {
    if (!existsSync(path.join(dir, 'node_modules'))) throw new Error(`${dir}: önce npm install çalıştırılmalı.`);
  }
  if (!existsSync(path.join(dirs.labs, 'Cargo.toml'))) throw new Error('360labs kardeş klasörü bulunamadı.');
  const hash = createHash('sha256').update(`${root}|${stateDir}`.toLowerCase()).digest('hex').slice(0, 16);
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\kasam-dev-${hash}` : path.join(stateDir, 'launcher.sock');
  mkdirSync(stateDir, { recursive: true });
  if (process.argv.includes('--stop')) {
    await new Promise(resolve => {
      const socket = net.connect(pipe, () => socket.end('stop'));
      socket.once('error', () => { console.log('Çalışan başlatıcı bulunamadı.'); resolve(); });
      socket.once('close', resolve);
    });
    return;
  }
  const lock = net.createServer(socket => {
    socket.once('data', data => { if (data.toString() === 'stop') void stop(); });
    socket.on('error', () => {});
    socket.on('end', () => socket.end());
  });
  const lockError = await new Promise(resolve => { lock.once('error', resolve); lock.listen(pipe, () => resolve(null)); });
  if (lockError) {
    if (lockError.code !== 'EADDRINUSE') throw lockError;
    console.log('Bu proje için başlatıcı zaten çalışıyor.');
    if (existsSync(stateFile)) console.log(readFileSync(stateFile, 'utf8'));
    return;
  }
  // The project mirror stays below the source package root so Turbopack resolves
  // dependencies and keeps its generated distDir within one bounded project.
  // Its config/next-env files are per-launcher; only src/public/modules are shared.
  const webProjectDir = ensureNextProject(dirs.web, path.join(dirs.web, '.launcher-projects', hash));
  const children = [], reservations = [];
  let mongo, stopping = false, finish;
  const finished = new Promise(resolve => { finish = resolve; });
  async function stop() {
    if (stopping) return;
    stopping = true;
    for (const child of children.toReversed()) {
      if (child.exitCode !== null) continue;
      // Yalnız bu başlatıcının doğurduğu süreç ağacı kapatılır; port sahibi yabancı süreçlere dokunulmaz.
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill('SIGTERM');
    }
    for (const reservation of reservations) await reservation.release().catch(() => {});
    if (mongo) await mongo.stop();
    await new Promise(resolve => lock.close(resolve));
    writeFileSync(stateFile, JSON.stringify({ running: false }, null, 2));
    finish();
  }
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  function launch(name, executable, args, cwd, env) {
    const log = path.join(stateDir, `${name}.log`), fd = openSync(log, 'w');
    const child = spawn(executable, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', fd, fd] });
    closeSync(fd);
    children.push(child);
    child.on('error', error => { child.spawnFailed = true; console.error(`${name}: ${error.message}`); });
    child.on('exit', code => { if (!stopping && !(name === 'desktop-build' && code === 0)) console.error(`${name} kapandı (${code}). Diğer servisler korunuyor. Log: ${log}`); });
    return child;
  }
  async function ready(url, child, label) {
    const ok = await serviceReady(url, child, () => stopping);
    console.log(`${label}: ${ok ? 'HAZIR' : 'BAŞLATILAMADI (logu kontrol edin)'} — ${url}`);
    if (stopping) throw new Error('Başlatma iptal edildi.');
    return ok;
  }
  try {
    const selected = {};
    for (const [name, preferred] of Object.entries({ web: 3000, api: 4000, labs: 3600, desktop: 1420 })) {
      selected[name] = await reservePort(preferred); reservations.push(selected[name]);
    }
    const ports = Object.fromEntries(Object.entries(selected).map(([name, item]) => [name, item.port]));
    const urls = origins(ports);
    if (process.argv.includes('--check')) { console.log(JSON.stringify({ ports, ...urls }, null, 2)); return; }
    writeFileSync(stateFile, JSON.stringify({ running: true, ...urls }, null, 2));
    console.log(JSON.stringify(urls, null, 2));
    console.log('Google ayrı sunucu değildir. callback adresi Google Console izin listesinde bulunmalı.');
    console.log(`Loglar: ${stateDir}\nDurdurmak için Ctrl+C. Mevcut diğer süreçler korunur.`);
    // Varsayılan yerel geliştirme DB'si kalıcıdır; Atlas ancak açık seçenekle kullanılır.
    let mongoEnv = {};
    if (!process.argv.includes('--configured-db')) {
      const require = createRequire(path.join(dirs.api, 'package.json'));
      const { MongoMemoryReplSet } = require('mongodb-memory-server');
      // Replica set kendi adresini diskte saklar; her açılışta rastgele Mongo portu seçilmez.
      const mongoPortFile = path.join(stateDir, 'mongo-port.json');
      const previous = existsSync(mongoPortFile) ? JSON.parse(readFileSync(mongoPortFile, 'utf8')) : 27017;
      if (!Number.isInteger(previous) || previous < 1024 || previous > 65435) throw new Error('Yerel Mongo port kaydı geçersiz.');
      const mongoPort = await reservePort(previous); reservations.push(mongoPort);
      if (mongoPort.port !== previous) console.log(`Mongo ${previous} dolu: ${mongoPort.port} için ayrı yerel veri klasörü kullanılacak; eski veriler korunur.`);
      writeFileSync(mongoPortFile, JSON.stringify(mongoPort.port));
      const dbPath = path.join(stateDir, 'mongo', String(mongoPort.port)); mkdirSync(dbPath, { recursive: true });
      await mongoPort.release();
      mongo = await MongoMemoryReplSet.create({ binary: { downloadDir: path.join(dirs.api, 'node_modules/.cache/mongodb-memory-server') },
        replSet: { count: 1, name: 'kasam360-dev', storageEngine: 'wiredTiger' }, instanceOpts: [{ dbPath, port: mongoPort.port }] });
      if (stopping) throw new Error('Başlatma iptal edildi.');
      mongoEnv = { MONGODB_ACCOUNT_URI: mongo.getUri(), MONGODB_BUSINESS_URI: mongo.getUri(),
        MONGODB_ACCOUNT_DB: 'kasam360_dev_account', MONGODB_BUSINESS_DB: 'kasam360_dev_business' };
      console.log('Mongo: kalıcı yerel geliştirme verisi (.dev-servers/mongo).');
    }
    const common = { NODE_ENV: 'development', LOCAL_TEST_MODE: '0' };
    // Üretim imza anahtarı yerelde yoksa kasa hiç imzalı lisans alamaz. Durum klasörüne kalıcı bir
    // geliştirme anahtar çifti yazılır: özel yarısı API'ye, açık yarısı yalnız debug native derlemesine gider.
    let licenseSigning = {}, nativeLicenseKey = {};
    if (!apiEnv.LICENSE_SIGNING_KEY && !process.env.LICENSE_SIGNING_KEY) {
      const keyFile = path.join(stateDir, 'license-dev-key.json');
      if (!existsSync(keyFile)) {
        const { privateKey } = generateKeyPairSync('ed25519');
        writeFileSync(keyFile, JSON.stringify({ privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') }));
      }
      const devPrivate = JSON.parse(readFileSync(keyFile, 'utf8')).privateKey;
      const publicHex = createPublicKey({ key: Buffer.from(devPrivate, 'base64'), format: 'der', type: 'pkcs8' })
        .export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
      licenseSigning = { LICENSE_SIGNING_KEY: devPrivate };
      nativeLicenseKey = { KASAM360_DEV_LICENSE_PUBLIC_KEY: publicHex };
      console.log('Lisans: yalnız geliştirme için yerel imza anahtarı kullanılıyor (üretim anahtarı değil).');
    }
    if (!apiEnv.GOOGLE_CLIENT_ID || !apiEnv.GOOGLE_CLIENT_SECRET) console.log('Google giriş anahtarları API .env dosyasında eksik; Google girişi kapalı kalır.');
    const devMailDir = path.join(stateDir, 'mail');
    const missingMailConfig = missingSmtpFields(apiEnv, process.env);
    const smtpReady = missingMailConfig.length === 0;
    if (!smtpReady) console.log(`SMTP yapılandırması eksik (${missingMailConfig.join(', ')}): gerçek e-posta gönderilmez; yerel test postaları ${devMailDir} klasörüne kaydedilir.`);
    if (!apiEnv.LABS_CATALOG_TOKEN && !process.env.LABS_CATALOG_TOKEN) console.log('LABS_CATALOG_TOKEN eksik; sunucular açılır ancak gerçek paket kataloğu için Labs entegrasyon anahtarı gerekir.');
    // Labs hesap listesini API'nin iç ucundan okur; iki taraf aynı paylaşılan anahtarı görmezse liste boş kalır.
    const customerSecret = labsEnv.KASAM_CUSTOMER_SECRET || apiEnv.LABS_CUSTOMER_SECRET || randomBytes(32).toString('hex');
    await selected.labs.release();
    // Yalıtılmış Labs boş veriyle açılır; ilk yönetici rastgele şifreyle kurulur ve yalnız durum klasörüne yazılır.
    let labsBootstrap = {};
    if (isolated) {
      const adminFile = path.join(stateDir, 'labs-admin.json');
      if (!existsSync(adminFile)) writeFileSync(adminFile, JSON.stringify({ email: 'isolated-admin@kasam360.invalid', password: `Iso-${randomBytes(18).toString('hex')}-Aa9!` }, null, 2));
      const admin = JSON.parse(readFileSync(adminFile, 'utf8'));
      labsBootstrap = { ADMIN_BOOTSTRAP_EMAIL: admin.email, ADMIN_BOOTSTRAP_PASSWORD: admin.password };
      console.log(`Yalıtılmış Labs yöneticisi: ${admin.email} (şifre: ${adminFile})`);
    }
    const labsArgs = isolated ? ['run', '--target-dir', path.join(stateDir, 'target-labs')] : ['run'];
    const labs = launch('labs', 'cargo', labsArgs, dirs.labs, { ...labsEnv, ...common, ...labsBootstrap, ...(isolated ? { DATA_DIR: path.join(stateDir, 'labs-data') } : {}),
      CARGO_INCREMENTAL: '0', BIND_ADDR: `127.0.0.1:${ports.labs}`, APP_ORIGIN: urls.labs, KASAM_CUSTOMER_ORIGIN: urls.api, KASAM_CUSTOMER_SECRET: customerSecret });
    await ready(urls.labs, labs, 'Labs');
    await selected.api.release();
    const api = launch('api', process.execPath, ['--import', 'tsx', 'src/index.ts'], dirs.api, {
      ...apiEnv, ...common, ...mongoEnv, HOST: '127.0.0.1', PORT: String(ports.api), SITE_URL: urls.web,
      AUTH_SECRET: apiEnv.AUTH_SECRET || randomBytes(32).toString('hex'),
      ALLOWED_ORIGINS: [...new Set([...(apiEnv.ALLOWED_ORIGINS || '').split(','), urls.web, urls.api, urls.desktop, 'http://tauri.localhost'])].filter(Boolean).join(','),
      LABS_SUPPORT_ORIGIN: urls.labs, LABS_CATALOG_ORIGIN: urls.labs, ...licenseSigning, LABS_CUSTOMER_SECRET: customerSecret, ...(smtpReady ? {} : { DEV_MAIL_DIR: devMailDir }) });
    await ready(`${urls.api}/health`, api, 'API');
    await selected.web.release();
    // Native HTTP ve Google callback aynı adrese ulaşsın; web yalnız yerel IPv4'te dinlesin.
    const web = launch('web', process.execPath, [path.join(dirs.web, 'node_modules/next/dist/bin/next'), 'dev', '--port', String(ports.web), '--hostname', '127.0.0.1'], webProjectDir,
      { ...common, ...load(dirs.web), API_ORIGIN: urls.api });
    await ready(urls.web, web, 'Web');
    await selected.desktop.release();
    const desktop = launch('desktop-ui', process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(ports.desktop), '--host', 'localhost', '--strictPort'], dirs.desktop,
      { ...common, VITE_SITE_URL: urls.web });
    const desktopReady = await ready(urls.desktop, desktop, 'Desktop arayüzü');
    if (desktopReady && !process.argv.includes('--no-desktop')) {
      const original = JSON.parse(readFileSync(path.join(dirs.native, 'tauri.conf.json'), 'utf8'));
      const csp = original.app.security.csp.replace('connect-src ', `connect-src ${urls.web} `);
      const config = { ...(isolated ? { identifier: 'com.kasam360.desktop.isolated' } : {}), build: { beforeDevCommand: '', devUrl: urls.desktop }, app: { security: { csp } } };
      // Proje klasöründeki erişim kuralı yüzünden exe bu klasörde çalışırsa WebView2 0x800700AA ile açılmaz.
      // Bu yüzden önce derlenir (TAURI_CONFIG, tauri dev'in verdiği yapılandırmanın aynısı), sonra exe Temp çalışma dizininde açılır.
      // Site adresi `option_env!` ile derlemeye gömülür; yalnız çalıştırma ortamına vermek dolu port seçildiğinde yanlış adresi bırakır.
      const nativeTarget = isolated ? path.join(stateDir, 'target-native') : path.join(dirs.native, 'target');
      const build = launch('desktop-build', 'cargo', ['build', '--target-dir', nativeTarget], dirs.native, { ...common, TAURI_CONFIG: JSON.stringify(config), KASAM360_DEV_SITE_URL: urls.web, ...nativeLicenseKey });
      console.log('Masaüstü uygulaması derleniyor (ilk seferde birkaç dakika sürebilir)...');
      const built = await new Promise(resolve => { build.once('exit', code => resolve(code === 0)); build.once('error', () => resolve(false)); });
      if (stopping) throw new Error('Başlatma iptal edildi.');
      const exe = path.join(nativeTarget, 'debug', process.platform === 'win32' ? 'kasam360-core.exe' : 'kasam360-core');
      if (built && existsSync(exe)) {
        // Yalıtılmış kabulde native ekranlar otomasyonla sürülebilsin diye WebView2 yalnız 127.0.0.1 hata ayıklama portu açar.
        const debugPort = isolated ? process.argv.find(arg => arg.startsWith('--native-debug-port='))?.split('=')[1] : undefined;
        const webviewArgs = debugPort ? { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${Number(debugPort)} --remote-debugging-address=127.0.0.1` } : {};
        launch('desktop-native', exe, [], os.tmpdir(), { ...common, ...webviewArgs, KASAM360_DEV_SITE_URL: urls.web });
        console.log('Masaüstü uygulaması: AÇILDI');
      } else console.error(`Masaüstü uygulaması derlenemedi. Log: ${path.join(stateDir, 'desktop-build.log')}`);
    }
    console.log('Başlatma denemeleri tamamlandı; her servisin durumu yukarıda. Native ilk derlemesi ayrıca sürebilir.');
    await finished;
  } finally { await stop(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
