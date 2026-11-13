#!/usr/bin/env node
/**
 * Gera o cliente tipado do frontend a partir do OpenAPI da API.
 *
 * Uso:
 *   npm run openapi:client
 *   OPENAPI_URL=http://localhost:4000/api/openapi.json npm run openapi:client
 *
 * Sem OPENAPI_URL, o documento é importado diretamente do código da API via
 * tsx, então o script funciona offline.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'apps', 'web', 'src', 'services', 'generated-api.ts');

async function loadDocument() {
  const url = process.env.OPENAPI_URL;
  if (url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Falha ao buscar OpenAPI: ${response.status}`);
    return response.json();
  }
  const text = execFileSync(
    process.execPath,
    ['--import', 'tsx', join(root, 'scripts', 'print-openapi.ts')],
    { cwd: root, encoding: 'utf8' }
  );
  return JSON.parse(text);
}

function operationName(method, path) {
  const cleaned = path
    .replace(/^\//, '')
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((part, index) =>
      index === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    )
    .join('');
  return `${method.toLowerCase()}${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
}

const document = await loadDocument();
const operations = {};

for (const [path, methods] of Object.entries(document.paths ?? {})) {
  for (const [method, operation] of Object.entries(methods)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    const name = operationName(method, path);
    operations[name] = {
      method: method.toUpperCase(),
      path,
      summary: operation.summary ?? '',
      hasBody: Boolean(operation.requestBody),
    };
  }
}

const lines = [];
lines.push('/* eslint-disable */');
lines.push('// Cliente gerado por scripts/generate-client.mjs a partir de /api/openapi.json.');
lines.push('// Não edite manualmente: rode `npm run openapi:client`.');
lines.push('');
lines.push("const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000') as string;");
lines.push('');
lines.push('export interface GeneratedOperation {');
lines.push('  method: string;');
lines.push('  path: string;');
lines.push('  summary: string;');
lines.push('  hasBody: boolean;');
lines.push('}');
lines.push('');
lines.push('export const operations = {');
for (const [name, operation] of Object.entries(operations)) {
  lines.push(
    `  ${name}: { method: '${operation.method}', path: '${operation.path}', summary: ${JSON.stringify(
      operation.summary
    )}, hasBody: ${operation.hasBody} },`
  );
}
lines.push('} as const;');
lines.push('');
lines.push('export type OperationName = keyof typeof operations;');
lines.push('');
lines.push('export async function callOperation<T>(');
lines.push('  name: OperationName,');
lines.push('  params: Record<string, string | number> = {},');
lines.push('  body?: unknown,');
lines.push('  init: RequestInit = {}');
lines.push('): Promise<T> {');
lines.push('  const operation = operations[name];');
lines.push('  let path: string = operation.path;');
lines.push('  for (const [key, value] of Object.entries(params)) {');
lines.push("    path = path.replace(`{${key}}`, encodeURIComponent(String(value)));");
lines.push('  }');
lines.push("  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('c4arch_token') : null;");
lines.push('  const headers: Record<string, string> = {');
lines.push("    'Content-Type': 'application/json',");
lines.push('    ...(init.headers as Record<string, string> | undefined),');
lines.push('  };');
lines.push("  if (token) headers.Authorization = 'Bearer ' + token;");
lines.push('  const response = await fetch(API_BASE + path, {');
lines.push('    ...init,');
lines.push('    method: operation.method,');
lines.push('    headers,');
lines.push("    body: body === undefined ? init.body : JSON.stringify(body),");
lines.push('  });');
lines.push('  if (!response.ok) {');
lines.push('    let message = `Requisição falhou: ${response.status}`;');
lines.push('    try {');
lines.push('      const payload = (await response.json()) as { error?: string };');
lines.push('      if (payload.error) message = payload.error;');
lines.push('    } catch {');
lines.push('      // sem corpo JSON');
lines.push('    }');
lines.push('    throw new Error(message);');
lines.push('  }');
lines.push('  if (response.status === 204) return undefined as T;');
lines.push('  return (await response.json()) as T;');
lines.push('}');
lines.push('');
lines.push('export const openapi = {');
lines.push(`  version: ${JSON.stringify(document.info?.version ?? '0.0.0')},`);
lines.push(`  title: ${JSON.stringify(document.info?.title ?? 'API')},`);
lines.push('} as const;');
lines.push('');

writeFileSync(output, lines.join('\n'), 'utf8');
console.log(`Cliente gerado em ${output} (${Object.keys(operations).length} operações).`);
