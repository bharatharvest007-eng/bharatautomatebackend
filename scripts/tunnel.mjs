#!/usr/bin/env node
import { spawn } from 'node:child_process';

const PORT = process.env.API_PORT || 3001;

console.log(`🌐 [Tunnel] Exposing local API server (port ${PORT}) for Meta Instagram Webhooks...`);
console.log('📌 Meta requires HTTPS for Webhook Callback URLs (e.g., https://your-domain.loca.lt/webhooks/instagram).\n');

// Try localtunnel or provide cloudflared / ngrok alternatives
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const tunnel = spawn(npx, ['localtunnel', '--port', String(PORT)], { stdio: 'inherit' });

tunnel.on('error', (err) => {
  console.error('⚠️  Failed to start localtunnel automatically:', err.message);
  console.log('\n💡 Alternative Tunnel Options:');
  console.log('  1. Cloudflare Tunnel (Recommended): `cloudflared tunnel --url http://localhost:3001`');
  console.log('  2. Ngrok: `ngrok http 3001`');
  console.log('  3. Localtunnel: `npx localtunnel --port 3001`\n');
});
