import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function writeUtf8FileAtomic(filePath, text) {
  const temporary = path.join(path.dirname(filePath), `.html-video-${process.pid}-${crypto.randomUUID()}.tmp.txt`);
  try {
    fs.writeFileSync(temporary, text, 'utf8');
    fs.renameSync(temporary, filePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
