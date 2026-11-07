import { inflateRawSync } from "node:zlib";
import { ImportError } from "./import-character";

export interface ZipEntry {
  path: string;
  bytes: Buffer;
}

/**
 * Reads a zip of stored or deflated files. No extra dependency, so Windows
 * `npm run seed` can unpack the character package without an unzip binary.
 * Encrypted zips and Zip64 are rejected.
 */
export function readZip(bytes: Buffer): ZipEntry[] {
  const out: ZipEntry[] = [];
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const signature = bytes.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) break;
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = bytes.toString("utf8", nameStart, nameStart + nameLength).replace(/\\/g, "/");
    const dataStart = nameStart + nameLength + extraLength;
    if (flags & 0x1) throw new ImportError("O zip está criptografado");
    if (flags & 0x8) throw new ImportError("O zip usa data descriptor. Recompacte o pacote.");
    if (compressedSize === 0xffffffff) throw new ImportError("Zip64 não é aceito");
    if (dataStart + compressedSize > bytes.length) throw new ImportError("Zip truncado");
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    offset = dataStart + compressedSize;
    if (!name || name.endsWith("/")) continue;
    if (method === 0) out.push({ path: name, bytes: Buffer.from(compressed) });
    else if (method === 8) out.push({ path: name, bytes: Buffer.from(inflateRawSync(compressed)) });
    else throw new ImportError(`Compressão ${method} não é aceita`);
  }
  if (!out.length) throw new ImportError("O zip não tem arquivos");
  return out;
}
