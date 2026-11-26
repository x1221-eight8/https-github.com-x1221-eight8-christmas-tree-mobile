import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('.', import.meta.url)));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || '4173');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.task': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function insideRoot(file) {
  const pathFromRoot = relative(root, file);
  return !isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith('..' + sep);
}

function end(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(message);
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    end(response, 405, 'Method not allowed');
    return;
  }

  let path;
  try {
    path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    end(response, 400, 'Invalid path');
    return;
  }
  if (path.includes('\\') || path.includes(':') || path.includes('\0')) {
    end(response, 400, 'Invalid path');
    return;
  }

  try {
    const requestedFile = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!insideRoot(requestedFile)) {
      end(response, 404, 'File not found');
      return;
    }
    const file = await realpath(requestedFile);
    if (!insideRoot(file)) {
      end(response, 404, 'File not found');
      return;
    }
    const metadata = await stat(file);
    if (!metadata.isFile()) {
      end(response, 404, 'File not found');
      return;
    }

    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Length': metadata.size,
      'Content-Type': contentTypes[extname(file).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = createReadStream(file);
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      end(response, 404, 'File not found');
      return;
    }
    console.error(error);
    end(response, 500, 'Unable to read file');
  }
});

server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  const browserHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const urlHost = browserHost.includes(':') ? `[${browserHost}]` : browserHost;
  const url = `http://${urlHost}:${server.address().port}/`;
  console.log(`Open ${url}`);
  if (process.platform === 'win32' && process.argv.includes('--open')) {
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    browser.on('error', () => console.error(`Open the address manually: ${url}`));
    browser.unref();
  }
});
