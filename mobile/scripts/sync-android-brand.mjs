import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(mobileRoot, '..');
const backendRoot = path.join(repositoryRoot, 'backend');
const iconSource = path.join(repositoryRoot, 'desktop/src/assets/brand/kasam360-ikon-kucuk-koyu-zemin.svg');
const androidProject = path.join(backendRoot, 'gen/android/app/src/main/res');
const temporaryOutput = mkdtempSync(path.join(mobileRoot, '.android-brand-'));

try {
  execFileSync('cargo', ['tauri', 'icon', iconSource, '--output', temporaryOutput], {
    cwd: backendRoot,
    stdio: 'inherit',
  });

  const generatedAndroid = path.join(temporaryOutput, 'android');
  if (!existsSync(generatedAndroid)) throw new Error('Tauri Android ikon çıktısı oluşmadı.');
  mkdirSync(androidProject, { recursive: true });
  for (const entry of readdirSync(generatedAndroid)) {
    cpSync(path.join(generatedAndroid, entry), path.join(androidProject, entry), { recursive: true, force: true });
  }

  for (const resource of ['values/ic_launcher_background.xml', 'values-v31/themes.xml']) {
    const source = path.join(mobileRoot, 'android-assets', resource);
    const destination = path.join(androidProject, resource);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
} finally {
  const relativeOutput = path.relative(mobileRoot, temporaryOutput);
  if (relativeOutput && !relativeOutput.startsWith('..') && !path.isAbsolute(relativeOutput)) {
    rmSync(temporaryOutput, { recursive: true, force: true });
  }
}
