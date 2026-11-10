// Sürüm yayın yardımcıları: etiket/sürüm tutarlılığı ve updater `latest.json` üretimi.
// Neden betik: iş akışında tek satır kabuk yerine test edilebilir kural olsun;
// yanlış sürüm etiketi imzalı ama yanlış numaralı paket yayınlatır.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'erenntokgoz/kasam360';
const SEMVER = /^\d+\.\d+\.\d+$/;

/** `v0.3.1` -> `0.3.1`; başka biçim kabul edilmez (ön sürüm etiketi yayınlanmaz). */
export function versionFromTag(tag) {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag ?? '');
  if (!match) throw new Error(`Etiket v<major>.<minor>.<patch> biçiminde olmalı: ${tag}`);
  return match[1];
}

export function readVersions(root) {
  const cargo = readFileSync(path.join(root, 'backend/Cargo.toml'), 'utf8');
  const cargoVersion = /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
  return {
    'backend/Cargo.toml': cargoVersion,
    'backend/tauri.conf.json': JSON.parse(readFileSync(path.join(root, 'backend/tauri.conf.json'), 'utf8')).version,
    'desktop/package.json': JSON.parse(readFileSync(path.join(root, 'desktop/package.json'), 'utf8')).version,
  };
}

/** Etiket ve üç dosyadaki sürüm aynı olmalı; farklı olanlar adıyla bildirilir. */
export function assertVersionsMatch(tag, versions) {
  const expected = versionFromTag(tag);
  const wrong = Object.entries(versions).filter(([, version]) => version !== expected);
  if (wrong.length > 0) {
    const detail = wrong.map(([file, version]) => `${file}=${version ?? 'okunamadı'}`).join(', ');
    throw new Error(`Etiket ${tag} ama sürüm uyuşmuyor: ${detail}`);
  }
  return expected;
}

export function assertPubkeyConfigured(root) {
  const conf = JSON.parse(readFileSync(path.join(root, 'backend/tauri.conf.json'), 'utf8'));
  const pubkey = String(conf.plugins?.updater?.pubkey ?? '').trim();
  if (!pubkey || pubkey.startsWith('YOUR_')) {
    throw new Error('backend/tauri.conf.json plugins.updater.pubkey boş: docs/surum-yayinlama.md adımlarıyla genel anahtarı girin.');
  }
}

/** Tauri updater manifesti. `signature` .sig dosyasının düz içeriğidir. */
export function buildManifest({ version, signature, installerName, notes, now = new Date() }) {
  if (!SEMVER.test(version)) throw new Error(`Geçersiz sürüm: ${version}`);
  if (!signature?.trim()) throw new Error('İmza boş: paket imzalanmamış.');
  return {
    version,
    notes: notes ?? '',
    pub_date: now.toISOString(),
    platforms: {
      'windows-x86_64': {
        signature: signature.trim(),
        url: `https://github.com/${REPO}/releases/download/v${version}/${encodeURIComponent(installerName)}`,
      },
    },
  };
}

/** NSIS çıktısında tam bir kurulum + .sig çifti beklenir; belirsizlik hata sayılır. */
export function findInstaller(dir, version) {
  const installers = readdirSync(dir).filter((name) => name.endsWith('-setup.exe') && name.includes(`_${version}_`));
  if (installers.length !== 1) throw new Error(`${dir} içinde ${version} için tek kurulum dosyası bekleniyordu: ${installers.join(', ') || 'yok'}`);
  const signaturePath = path.join(dir, `${installers[0]}.sig`);
  return { installerName: installers[0], installerPath: path.join(dir, installers[0]), signaturePath, signature: readFileSync(signaturePath, 'utf8') };
}

function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const [command, ...args] = argv;
  if (command === 'check-version') {
    console.log(assertVersionsMatch(args[0], readVersions(root)));
  } else if (command === 'check-pubkey') {
    assertPubkeyConfigured(root);
  } else if (command === 'manifest') {
    const [tag, bundleDir, output] = args;
    const version = versionFromTag(tag);
    const { installerName, signature } = findInstaller(bundleDir, version);
    writeFileSync(output, `${JSON.stringify(buildManifest({ version, signature, installerName }), null, 2)}\n`);
    console.log(installerName);
  } else {
    throw new Error('Kullanım: check-version <etiket> | check-pubkey | manifest <etiket> <nsis-klasörü> <çıktı>');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exit(1); }
}
