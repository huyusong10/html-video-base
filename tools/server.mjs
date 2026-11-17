import path from 'node:path';
import { ROOT } from './lib/paths.mjs';
import { createVideoHttpServer } from './lib/http-static.mjs';

export async function startVideoServer({ projectRoot = ROOT, host = '127.0.0.1', port = 0, watch = false } = {}) {
  const server = createVideoHttpServer({ videosDir: path.join(path.resolve(projectRoot), 'videos'), watch });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
  } catch (error) {
    server.close();
    throw error;
  }
  let closing;
  return {
    origin: `http://${host.includes(':') ? '[' + host + ']' : host}:${server.address().port}`,
    close() {
      if (!closing) closing = new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections?.();
      });
      return closing;
    },
  };
}
