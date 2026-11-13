import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(mobileRoot, '..');
const backendRoot = path.join(repositoryRoot, 'backend');
const iconSource = path.join(repositoryRoot, 'desktop/src/assets/brand/kasam360-ikon-kucuk-koyu-zemin.svg');
const androidProject = path.join(backendRoot, 'gen/android/app/src/main/res');
const temporaryOutput = mkdtempSync(path.join(mobileRoot, '.android-brand-'));

try {
  // cargo-tauri kurulu olmayan ortamda (CI) da çalışsın diye npm CLI kullanılır.
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', '@tauri-apps/cli@2.11.4', 'icon', iconSource, '--output', temporaryOutput], {
    cwd: backendRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
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

  syncNativeShell();
} finally {
  const relativeOutput = path.relative(mobileRoot, temporaryOutput);
  if (relativeOutput && !relativeOutput.startsWith('..') && !path.isAbsolute(relativeOutput)) {
    rmSync(temporaryOutput, { recursive: true, force: true });
  }
}

/**
 * `backend/gen` üretilmiş ve izlenmeyen klasördür. Google girişini uygulama içinde açan Android kodu
 * burada izlenir ve her derlemede üretilmiş projeye uygulanır (tekrar çalıştırmak güvenlidir).
 */
function syncNativeShell() {
  const androidRoot = path.join(backendRoot, 'gen/android/app');
  const activityDir = path.join(androidRoot, 'src/main/java/com/kasam360/mobile');
  mkdirSync(activityDir, { recursive: true });
  copyFileSync(path.join(mobileRoot, 'android-assets/native/MainActivity.kt'), path.join(activityDir, 'MainActivity.kt'));

  const manifestPath = path.join(androidRoot, 'src/main/AndroidManifest.xml');
  const manifest = readFileSync(manifestPath, 'utf8');
  if (!manifest.includes('google-done')) {
    const filter = `            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="kasam360" android:host="google-done" />
            </intent-filter>
`;
    const marker = '        </activity>';
    if (!manifest.includes(marker)) throw new Error('AndroidManifest.xml etkinlik bitişi bulunamadı.');
    writeFileSync(manifestPath, manifest.replace(marker, `${filter}${marker}`));
  }

  const gradlePath = path.join(androidRoot, 'build.gradle.kts');
  const gradle = readFileSync(gradlePath, 'utf8');
  if (!gradle.includes('androidx.browser:browser')) {
    const anchor = 'implementation("androidx.webkit:webkit:1.14.0")';
    if (!gradle.includes(anchor)) throw new Error('build.gradle.kts bağımlılık satırı bulunamadı.');
    writeFileSync(gradlePath, gradle.replace(anchor, `${anchor}
    implementation("androidx.browser:browser:1.8.0")`));
  }
}
