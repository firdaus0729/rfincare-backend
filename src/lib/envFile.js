import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

export function parseEnvContent(content) {
  const lines = String(content ?? '').split('\n');
  return lines.map((line, lineNumber) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return { type: 'comment', lineNumber, raw: line };
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      return { type: 'raw', lineNumber, raw: line };
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return { type: 'var', lineNumber, key, value, raw: line };
  });
}

export function serializeEnvEntries(entries) {
  return entries
    .map((entry) => {
      if (entry.type === 'comment' || entry.type === 'raw') return entry.raw ?? '';
      if (!entry.key) return entry.raw ?? '';
      const needsQuotes = /[\s#"'=]/.test(entry.value ?? '');
      const value = needsQuotes ? `"${String(entry.value ?? '').replace(/"/g, '\\"')}"` : (entry.value ?? '');
      return `${entry.key}=${value}`;
    })
    .join('\n');
}

export function entriesToObject(entries) {
  const obj = {};
  for (const entry of entries) {
    if (entry.type === 'var' && entry.key) obj[entry.key] = entry.value ?? '';
  }
  return obj;
}

export function objectToEntries(obj, previousEntries = []) {
  const keys = Object.keys(obj);
  const used = new Set();
  const result = [];

  for (const prev of previousEntries) {
    if (prev.type === 'comment' || prev.type === 'raw') {
      result.push(prev);
      continue;
    }
    if (prev.type === 'var' && prev.key && keys.includes(prev.key)) {
      result.push({ ...prev, value: obj[prev.key] });
      used.add(prev.key);
    } else if (prev.type === 'var' && prev.key) {
      result.push(prev);
    }
  }

  for (const key of keys) {
    if (!used.has(key)) {
      result.push({ type: 'var', key, value: obj[key] });
    }
  }

  return result;
}

export async function readEnvFile(path) {
  try {
    const content = await readFile(path, 'utf8');
    return { content, entries: parseEnvContent(content) };
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return { content: '', entries: [] };
    }
    throw err;
  }
}

export async function writeEnvFile(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  await writeFile(path, normalized, 'utf8');
}
