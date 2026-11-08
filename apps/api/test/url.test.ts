import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UnsafeUrlError,
  isPrivateIpAddress,
  normalizeGoogleDriveUrl,
  normalizeImportUrl,
  parsePublicHttpUrl,
  readLimitedBody,
} from '../src/security/url.js';

test('isPrivateIpAddress bloqueia faixas privadas e reservadas', () => {
  const blocked = [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '64:ff9b::a00:1',
  ];
  for (const address of blocked) {
    assert.equal(isPrivateIpAddress(address), true, `${address} deveria ser bloqueado`);
  }
});

test('isPrivateIpAddress aceita endereços públicos e rejeita entradas inválidas', () => {
  assert.equal(isPrivateIpAddress('8.8.8.8'), false);
  assert.equal(isPrivateIpAddress('1.1.1.1'), false);
  assert.equal(isPrivateIpAddress('2606:4700:4700::1111'), false);
  assert.equal(isPrivateIpAddress('::ffff:8.8.8.8'), false);
  assert.equal(isPrivateIpAddress('exemplo.com'), true);
});

test('parsePublicHttpUrl aceita http(s) públicos', () => {
  const url = parsePublicHttpUrl('https://example.com/diagram.drawio?x=1');
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'example.com');
});

test('parsePublicHttpUrl rejeita protocolos, credenciais e hosts internos', () => {
  const invalid = [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'ftp://example.com/file',
    'https://user:pass@example.com/',
    'http://localhost/',
    'http://localhost.localdomain/',
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/',
    'http://printer.local/',
    'http://exemplo.internal/',
    'http://0.0.0.0:4000/',
    'http://example.com:0/',
    '',
    '   ',
  ];
  for (const raw of invalid) {
    assert.throws(() => parsePublicHttpUrl(raw), UnsafeUrlError, `deveria rejeitar ${raw}`);
  }
});

test('normalizeGoogleDriveUrl converte links de arquivo em download direto', () => {
  const fromPath = normalizeGoogleDriveUrl(
    new URL('https://drive.google.com/file/d/abc123XYZ/view?usp=sharing')
  );
  assert.equal(fromPath.hostname, 'drive.google.com');
  assert.equal(fromPath.pathname, '/uc');
  assert.equal(fromPath.searchParams.get('export'), 'download');
  assert.equal(fromPath.searchParams.get('id'), 'abc123XYZ');

  const fromQuery = normalizeImportUrl(
    'https://docs.google.com/uc?export=view&id=outro-id'
  );
  assert.equal(fromQuery.searchParams.get('id'), 'outro-id');
  assert.equal(fromQuery.searchParams.get('export'), 'download');
});

test('normalizeGoogleDriveUrl rejeita links de pasta', () => {
  assert.throws(
    () => normalizeImportUrl('https://drive.google.com/drive/folders/abc123?usp=sharing'),
    (err: unknown) =>
      err instanceof UnsafeUrlError && /pasta do Google Drive/.test(err.message)
  );
});

test('readLimitedBody respeita o limite sem depender de Content-Length', async () => {
  const ok = await readLimitedBody(new Response('conteudo'), 100);
  assert.equal(ok, 'conteudo');

  await assert.rejects(
    readLimitedBody(new Response('x'.repeat(4096)), 100),
    (err: unknown) =>
      err instanceof UnsafeUrlError && /limite de 1 KB/.test(err.message)
  );
});

test('readLimitedBody rejeita Content-Length acima do limite', async () => {
  const response = new Response('curto', { headers: { 'content-length': '5000' } });
  await assert.rejects(readLimitedBody(response, 100), UnsafeUrlError);
});
