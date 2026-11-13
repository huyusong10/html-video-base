// 静态预览与开发热更新服务：内置虚拟 /base/* 路由、206 Range 寻道与零依赖 SSE 帧级保位热更新
// 用法：html-video serve [port] [host] [--no-watch]
import os from 'node:os';
import { VIDEOS_DIR, normalizeCliArgs } from './lib/paths.mjs';
import { createVideoHttpServer } from './lib/http-static.mjs';

const rawArgs = normalizeCliArgs(process.argv.slice(2));
const posArgs = rawArgs.filter(a => !a.startsWith('--'));
const watch = !rawArgs.includes('--no-watch');
const PORT = Number(posArgs[0] || process.env.PORT || 8765);
const HOST = posArgs[1] || process.env.HOST || '0.0.0.0';

function printNetworkUrls(port) {
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  Network: http://${net.address}:${port}/`);
      }
    }
  }
}

const srv = createVideoHttpServer({ videosDir: VIDEOS_DIR, watch });
srv.listen(PORT, HOST, () => {
  console.log(`Serving ${VIDEOS_DIR} on ${HOST}:${PORT}${watch ? ' (SSE Live Reload ON)' : ''}`);
  console.log(`  Local:   http://localhost:${PORT}/`);
  printNetworkUrls(PORT);
});
