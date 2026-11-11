import path from 'path';
import { defineConfig, loadEnv, type Plugin, type Connect } from 'vite';
import react from '@vitejs/plugin-react';
import { handleTokenRequest, readApiKey } from './api/token';

// Serves /api/token from the Vite dev and preview servers, so local
// development works the same way as the Vercel deployment.
function tokenEndpoint(apiKey: string | undefined, expectedPasscode: string | undefined): Plugin {
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    if (req.method !== 'GET') return next();
    const passcode = req.headers['x-app-passcode'];
    const response = await handleTokenRequest({
      apiKey,
      url: req.originalUrl || req.url || '/',
      passcode: typeof passcode === 'string' ? passcode : null,
      expectedPasscode,
      requirePasscode: false, // locally the passcode is optional
    });
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(await response.text());
  };
  return {
    name: 'gemini-token-endpoint',
    configureServer: (server) => { server.middlewares.use('/api/token', middleware); },
    configurePreviewServer: (server) => { server.middlewares.use('/api/token', middleware); },
  };
}

export default defineConfig(({ mode }) => {
    // The key is only read here, on the server. It is never put in the browser bundle.
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), tokenEndpoint(readApiKey(env), env.APP_PASSCODE)],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
