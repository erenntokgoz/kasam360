import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { allowedOrigins, auth, siteUrl } from './config.js';

serve({ fetch: createApp(auth, allowedOrigins, siteUrl).fetch, port: Number(process.env.PORT ?? 4000) });
