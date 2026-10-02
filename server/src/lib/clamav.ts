import { createReadStream } from 'node:fs';
import net from 'node:net';
import { env } from '../config/env';

export type ScanResult = { clean: true } | { clean: false; signature: string };

/**
 * Scans a file with a ClamAV daemon (clamd) using its INSTREAM command:
 * the file is sent in length-prefixed chunks and clamd answers
 * "stream: OK" or "stream: <signature> FOUND". Throws if clamd cannot be
 * reached or answers anything else, so callers can refuse unscanned files.
 */
export function scanFile(filePath: string, host = env.CLAMAV_HOST!, port = env.CLAMAV_PORT, timeoutMs = 30_000): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let reply = '';
    let settled = false;
    const done = (fn: () => void) => { if (!settled) { settled = true; socket.destroy(); fn(); } };
    socket.setTimeout(timeoutMs, () => done(() => reject(new Error('ClamAV scan timed out'))));
    socket.on('error', (err) => done(() => reject(err)));
    socket.on('data', (d) => { reply += d.toString('utf8'); });
    socket.on('end', () => {
      const text = reply.replace(/\0/g, '').trim();
      done(() => {
        if (/^stream: OK$/.test(text)) resolve({ clean: true });
        else if (/ FOUND$/.test(text)) resolve({ clean: false, signature: text.replace(/^stream: /, '').replace(/ FOUND$/, '') });
        else reject(new Error(`Unexpected ClamAV reply: ${text.slice(0, 120)}`));
      });
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const file = createReadStream(filePath, { highWaterMark: 64 * 1024 });
      file.on('data', (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(buf.length, 0);
        socket.write(size);
        socket.write(buf);
      });
      file.on('end', () => socket.write(Buffer.alloc(4))); // zero-length chunk ends the stream
      file.on('error', (err) => done(() => reject(err)));
    });
  });
}
