import fs from 'node:fs';
import path from 'node:path';

export function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

export function readTextFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

export function readCsv(filePath: string): Array<Record<string, string>> {
  const content = fs.readFileSync(filePath, 'utf8').trim();
  const [headerLine, ...rows] = content.split(/\r?\n/);
  const headers = headerLine.split(',').map((value) => value.trim());

  return rows
    .filter(Boolean)
    .map((row) => {
      const values = row.split(',').map((value) => value.trim());
      return headers.reduce<Record<string, string>>((record, header, index) => {
        record[header] = values[index] ?? '';
        return record;
      }, {});
    });
}

export function resolveRepoPath(...segments: string[]): string {
  return path.join(process.cwd(), ...segments);
}
