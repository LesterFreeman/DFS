import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The production build ships a Content-Security-Policy that forbids every network connection
// (connect-src 'none') and every third-party origin. The app cannot send data anywhere even if a
// dependency tried to. It is left out in dev because Vite's hot reload needs a websocket.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

function lockdown(): Plugin {
  return {
    name: 'trove-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="referrer" content="no-referrer" />`,
      );
    },
  };
}

// base './' so the build works from any sub-path (e.g. https://<user>.github.io/<repo>/finance/).
export default defineConfig({
  base: './',
  plugins: [react(), lockdown()],
});
