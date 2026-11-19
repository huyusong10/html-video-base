import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function writeFileAtomic(filePath, data) {
  const temporary = path.join(path.dirname(filePath), `.html-video-${process.pid}-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, data);
    fs.renameSync(temporary, filePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export { writeFileAtomic as writeUtf8FileAtomic };
