import type { Hono } from 'hono';

export interface VersionInfo {
  commit: string;
  builtAt: string;
}

// Değerler image build argümanlarından gelir; kurulum betiği yayınlanan commit'i buradan doğrular.
export function readVersion(env: NodeJS.ProcessEnv = process.env): VersionInfo {
  return { commit: env.GIT_SHA || 'unknown', builtAt: env.BUILD_TIME || 'unknown' };
}

export function mountVersion(app: Hono, env: NodeJS.ProcessEnv = process.env) {
  app.get('/version', (context) => context.json(readVersion(env)));
}
