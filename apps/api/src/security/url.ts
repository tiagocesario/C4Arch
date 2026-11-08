import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

/**
 * Validação de URLs usadas na importação de modelos.
 *
 * A importação aceita uma URL informada pelo usuário e baixa o conteúdo no
 * servidor. Sem validação isso vira um SSRF (acesso a localhost, rede interna,
 * metadata de cloud etc.). Além de validar o texto da URL, resolvemos o DNS e
 * rejeitamos endereços privados/reservados. Redirecionamentos são seguidos
 * manualmente, revalidando cada salto, e o corpo é lido com limite de bytes.
 *
 * Para eliminar o DNS rebinding (TOCTOU entre a resolução e o fetch), o socket
 * é aberto para o IP previamente validado via `lookup` customizado, em vez de
 * resolver o host novamente no momento da conexão.
 */

const MAX_URL_LENGTH = 2048;
const MAX_REDIRECTS = 3;

const BLOCKED_ADDRESSES = new BlockList();

// IPv4: não roteáveis, loopback, link-local, redes privadas e reservadas.
BLOCKED_ADDRESSES.addSubnet('0.0.0.0', 8, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('10.0.0.0', 8, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('100.64.0.0', 10, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('127.0.0.0', 8, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('169.254.0.0', 16, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('172.16.0.0', 12, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('192.0.0.0', 24, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('192.0.2.0', 24, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('192.168.0.0', 16, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('198.18.0.0', 15, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('198.51.100.0', 24, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('203.0.113.0', 24, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('224.0.0.0', 4, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('240.0.0.0', 4, 'ipv4');

// IPv6: unspecified, loopback, ULA, link-local, multicast, documentação,
// IPv4 mapeado e NAT64 (podem esconder um IPv4 privado).
BLOCKED_ADDRESSES.addAddress('::', 'ipv6');
BLOCKED_ADDRESSES.addAddress('::1', 'ipv6');
BLOCKED_ADDRESSES.addSubnet('fc00::', 7, 'ipv6');
BLOCKED_ADDRESSES.addSubnet('fe80::', 10, 'ipv6');
BLOCKED_ADDRESSES.addSubnet('ff00::', 8, 'ipv6');
BLOCKED_ADDRESSES.addSubnet('2001:db8::', 32, 'ipv6');
BLOCKED_ADDRESSES.addSubnet('64:ff9b::', 96, 'ipv6');

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.localdomain', '.internal', '.home.arpa'];

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function ipv4FromMapped(address: string): string | null {
  const dotted = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dotted) return dotted[1];

  // Forma hexadecimal (ex.: ::ffff:7f00:1) usada por alguns resolvedores.
  const hex = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return null;
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function isPrivateIpAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  const family = isIP(normalized);
  if (family === 0) return true;

  // IPv4 mapeado em IPv6 (::ffff:x.x.x.x). O BlockList do Node trataria o
  // bloco ::ffff:0:0/96 como se fosse todo o IPv4 e bloquearia até 8.8.8.8,
  // então extraímos o IPv4 embutido e validamos separadamente.
  const mapped = ipv4FromMapped(normalized);
  if (mapped) return BLOCKED_ADDRESSES.check(mapped, 'ipv4');

  return BLOCKED_ADDRESSES.check(normalized, family === 4 ? 'ipv4' : 'ipv6');
}

function isBlockedHostname(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

/**
 * Validação sintática: http(s), sem credenciais embutidas, sem hosts locais e
 * sem IP privado literal. Não faz resolução DNS (função pura e testável).
 */
export function parsePublicHttpUrl(rawUrl: string): URL {
  if (typeof rawUrl !== 'string' || !rawUrl.trim() || rawUrl.length > MAX_URL_LENGTH) {
    throw new UnsafeUrlError('URL inválida');
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError('URL inválida');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Apenas URLs http(s) são suportadas');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URL com credenciais embutidas não é permitida');
  }
  if (url.port === '0') {
    throw new UnsafeUrlError('Porta inválida');
  }

  const host = normalizeHostname(url.hostname);
  if (!host || host.includes('\0')) {
    throw new UnsafeUrlError('URL inválida');
  }
  if (isIP(host)) {
    if (isPrivateIpAddress(host)) {
      throw new UnsafeUrlError('URL de rede interna não é permitida');
    }
  } else if (isBlockedHostname(host)) {
    throw new UnsafeUrlError('URL de rede interna não é permitida');
  }

  return url;
}

/** Normaliza links do Google Drive para download direto. */
export function normalizeGoogleDriveUrl(url: URL): URL {
  const host = normalizeHostname(url.hostname).replace(/^www\./, '');
  if (host !== 'drive.google.com' && host !== 'docs.google.com') {
    return url;
  }

  if (/\/drive\/folders\//.test(url.pathname)) {
    throw new UnsafeUrlError(
      'Links de pasta do Google Drive não permitem listar arquivos sem OAuth; informe os links dos arquivos individualmente.'
    );
  }

  const fromPath = url.pathname.match(/\/file\/d\/([^/]+)/)?.[1];
  const fileId = fromPath ?? url.searchParams.get('id');
  if (fileId) {
    return new URL(
      `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`
    );
  }

  return url;
}

export function normalizeImportUrl(rawUrl: string): URL {
  return normalizeGoogleDriveUrl(parsePublicHttpUrl(rawUrl));
}

/** Resolve o host e garante que nenhum endereço retornado é privado. */
export async function resolvePublicAddresses(hostname: string): Promise<string[]> {
  const host = normalizeHostname(hostname);

  if (isIP(host)) {
    if (isPrivateIpAddress(host)) {
      throw new UnsafeUrlError('URL de rede interna não é permitida');
    }
    return [host];
  }

  if (isBlockedHostname(host)) {
    throw new UnsafeUrlError('URL de rede interna não é permitida');
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError('Não foi possível resolver o host da URL');
  }

  if (records.length === 0) {
    throw new UnsafeUrlError('Não foi possível resolver o host da URL');
  }

  for (const record of records) {
    if (isPrivateIpAddress(record.address)) {
      throw new UnsafeUrlError('URL de rede interna não é permitida');
    }
  }

  return records.map((record) => record.address);
}

/** Valida a URL e a resolução DNS antes de qualquer download. */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  const url = normalizeImportUrl(rawUrl);
  await resolvePublicAddresses(url.hostname);
  return url;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function limitLabel(maxBytes: number): string {
  return `${Math.ceil(maxBytes / 1024)} KB`;
}

/**
 * Lê o corpo com limite rígido de bytes. `response.text()` consumiria todo o
 * conteúdo mesmo quando o servidor não informa Content-Length.
 */
export async function readLimitedBody(
  response: Response,
  maxBytes: number
): Promise<string> {
  const declaredSize = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new UnsafeUrlError(`Arquivo remoto maior que o limite de ${limitLabel(maxBytes)}`);
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new UnsafeUrlError(
          `Arquivo remoto maior que o limite de ${limitLabel(maxBytes)}`
        );
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // O reader já pode ter sido cancelado/liberado.
    }
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

export interface FetchPublicTextOptions {
  maxBytes?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/**
 * Baixa a URL usando o IP já validado, evitando DNS rebinding: a resolução DNS
 * ocorre em `resolvePublicAddresses` e o socket é aberto para esse mesmo IP
 * (via `lookup` customizado), em vez de resolver de novo no momento do fetch.
 */
async function pinnedFetch(url: URL, headers: Record<string, string>, timeoutMs: number): Promise<Response> {
  const addresses = await resolvePublicAddresses(url.hostname);
  const ip = addresses[0];
  const family = isIP(ip);
  const isHttps = url.protocol === 'https:';
  const requestFn = isHttps ? httpsRequest : httpRequest;

  const normalizedHeaders: Record<string, string> = { ...headers };
  if (!Object.keys(normalizedHeaders).some((key) => key.toLowerCase() === 'host')) {
    normalizedHeaders.Host = url.host;
  }

  return new Promise<Response>((resolve, reject) => {
    const req = requestFn(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: normalizedHeaders,
        servername: isHttps ? url.hostname : undefined,
        lookup: (_hostname, options, callback) => {
          if (options?.all) {
            callback(null, [{ address: ip, family }]);
          } else {
            callback(null, ip, family);
          }
        },
      },
      (res) => {
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(res.headers)) {
          responseHeaders[key] = Array.isArray(value) ? value.join(', ') : String(value ?? '');
        }
        const body = Readable.toWeb(res) as ReadableStream<Uint8Array>;
        resolve(new Response(body, { status: res.statusCode ?? 0, statusText: res.statusMessage, headers: responseHeaders }));
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Baixa texto de uma URL pública seguindo redirecionamentos manualmente. Cada
 * salto é revalidado (protocolo, host e DNS) e o corpo tem limite de bytes.
 */
export async function fetchPublicText(
  rawUrl: string,
  options: FetchPublicTextOptions = {}
): Promise<string> {
  const maxBytes = options.maxBytes ?? 100_000;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const headers = options.headers ?? {};
  let current = await assertPublicHttpUrl(rawUrl);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let response: Response;
    try {
      response = await pinnedFetch(current, headers, timeoutMs);
    } catch {
      throw new UnsafeUrlError('Não foi possível baixar a URL informada');
    }

    if (isRedirect(response.status)) {
      if (redirects === MAX_REDIRECTS) {
        throw new UnsafeUrlError('Muitos redirecionamentos ao baixar a URL');
      }
      const location = response.headers.get('location');
      if (!location) {
        throw new UnsafeUrlError('Redirecionamento sem destino');
      }
      const next = new URL(location, current).toString();
      current = await assertPublicHttpUrl(next);
      continue;
    }

    if (!response.ok) {
      throw new UnsafeUrlError(`A fonte retornou HTTP ${response.status}`);
    }

    const text = await readLimitedBody(response, maxBytes);
    if (!text.trimStart().startsWith('<')) {
      throw new UnsafeUrlError(
        'A fonte não retornou um XML draw.io. No Google Drive, compartilhe o arquivo como "Qualquer pessoa com o link".'
      );
    }
    return text;
  }

  throw new UnsafeUrlError('Muitos redirecionamentos ao baixar a URL');
}
