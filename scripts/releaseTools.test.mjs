import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertVersionsMatch, buildManifest, findInstaller, readVersions, versionFromTag } from './releaseTools.mjs';

test('Etiketten sürüm alınır, biçimsiz etiket reddedilir', () => {
  assert.equal(versionFromTag('v0.3.1'), '0.3.1');
  assert.throws(() => versionFromTag('0.3.1'));
  assert.throws(() => versionFromTag('v0.3.1-beta'));
});

test('Etiket ile dosya sürümleri uyuşmazsa uyuşmayan dosya adlandırılır', () => {
  const same = { 'backend/Cargo.toml': '0.3.0', 'backend/tauri.conf.json': '0.3.0', 'desktop/package.json': '0.3.0' };
  assert.equal(assertVersionsMatch('v0.3.0', same), '0.3.0');
  assert.throws(() => assertVersionsMatch('v0.3.0', { ...same, 'desktop/package.json': '0.2.0' }), /desktop\/package\.json=0\.2\.0/);
});

test('Depodaki üç sürüm şu an birbiriyle tutarlı', () => {
  const versions = readVersions(path.resolve(import.meta.dirname, '..'));
  assert.equal(new Set(Object.values(versions)).size, 1, JSON.stringify(versions));
});

test('Manifest imzasız paketi reddeder ve indirme adresini etiketten kurar', () => {
  assert.throws(() => buildManifest({ version: '0.3.0', signature: ' ', installerName: 'a.exe' }), /imza/i);
  const manifest = buildManifest({ version: '0.3.0', signature: 'SIG\n', installerName: 'KASAM360_0.3.0_x64-setup.exe' });
  assert.equal(manifest.platforms['windows-x86_64'].signature, 'SIG');
  assert.match(manifest.platforms['windows-x86_64'].url, /\/releases\/download\/v0\.3\.0\/KASAM360_0\.3\.0_x64-setup\.exe$/);
});

test('Kurulum dosyası tek ve imzalı değilse bulunamaz', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nsis-'));
  assert.throws(() => findInstaller(dir, '0.3.0'));
  writeFileSync(path.join(dir, 'KASAM360_0.3.0_x64-setup.exe'), 'x');
  assert.throws(() => findInstaller(dir, '0.3.0'));
  writeFileSync(path.join(dir, 'KASAM360_0.3.0_x64-setup.exe.sig'), 'imza');
  assert.equal(findInstaller(dir, '0.3.0').signature, 'imza');
});
