import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  buildExternalPayload,
  buildTargetBody,
  deliverExternalUpdate,
  hashExternalContent,
} from '../src/c4/external-sync.js';
import { UnsafeUrlError, parseIntegrationHttpUrl } from '../src/security/url.js';
import type { ModelGraph } from '../src/c4/model-graph.js';

const MODEL_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';

const USABLE_DRAWIO = `<mxfile><diagram id="d1" name="Contexto"><mxGraphModel><root>
  <mxCell id="0" /><mxCell id="1" parent="0" />
</root></mxGraphModel></diagram></mxfile>`;

function sampleGraph(overrides: Record<string, unknown> = {}): ModelGraph {
  return {
    source: 'legacy',
    model: {
      id: MODEL_ID,
      org_id: ORG_ID,
      title: 'Loja Online',
      description: 'Arquitetura de referência',
      status: 'draft',
      c4_type: 'container',
      c4_scope: null,
      updated_at: '2026-01-02T03:04:05.000Z',
      drawio_xml: USABLE_DRAWIO,
      das_content: '# DAS\n\nDocumento do modelo.',
      ...overrides,
    },
    elements: [
      {
        id: 'p1',
        model_id: MODEL_ID,
        type: 'actor',
        title: 'Cliente',
        description: 'Compra produtos',
        metadata: null,
        position_x: 0,
        position_y: 0,
        order: 0,
      },
      {
        id: 's1',
        model_id: MODEL_ID,
        type: 'system',
        title: 'Loja',
        description: 'Sistema principal',
        metadata: null,
        position_x: 200,
        position_y: 0,
        order: 1,
      },
    ],
    edges: [],
  };
}

test('parseIntegrationHttpUrl aceita http(s) inclusive rede interna', () => {
  assert.equal(
    parseIntegrationHttpUrl('https://sistema.interno/api/modelos/1/drawio').hostname,
    'sistema.interno'
  );
  assert.equal(parseIntegrationHttpUrl('http://10.0.0.5:8080/das').port, '8080');
  assert.equal(parseIntegrationHttpUrl('http://localhost:4000/hook').hostname, 'localhost');
});

test('parseIntegrationHttpUrl rejeita esquemas e URLs inválidas', () => {
  const invalid = [
    '',
    '   ',
    'ftp://exemplo.com/arquivo',
    'file:///etc/passwd',
    'https://user:senha@exemplo.com/hook',
    'https://exemplo.com:0/hook',
    `https://exemplo.com/${'a'.repeat(3000)}`,
  ];
  for (const value of invalid) {
    assert.throws(() => parseIntegrationHttpUrl(value), UnsafeUrlError, value);
  }
});

test('hashExternalContent é estável e muda com o conteúdo', () => {
  const first = hashExternalContent('conteúdo');
  assert.equal(first, hashExternalContent('conteúdo'));
  assert.notEqual(first, hashExternalContent('outro conteúdo'));
  assert.match(first, /^[0-9a-f]{64}$/);
});

test('buildExternalPayload usa o DAS do modelo e gera o draw.io a partir do grafo', () => {
  const built = buildExternalPayload(sampleGraph(), 'model.updated');

  assert.equal(built.summary.id, MODEL_ID);
  assert.equal(built.summary.orgId, ORG_ID);
  assert.equal(built.summary.title, 'Loja Online');
  assert.equal(built.summary.c4Type, 'container');
  assert.match(built.drawioXml, /<mxfile|<mxGraphModel/);
  assert.match(built.drawioXml, /c4Name="Cliente"/);
  assert.notEqual(built.drawioXml, USABLE_DRAWIO);
  assert.equal(built.dasContent, '# DAS\n\nDocumento do modelo.');
  assert.match(built.plantuml, /Cliente/);
  assert.match(built.plantuml, /Loja/);
  assert.notEqual(built.hashByTarget.drawio, built.hashByTarget.das);
});

test('buildExternalPayload gera o draw.io a partir do grafo quando não há XML salvo', () => {
  const built = buildExternalPayload(sampleGraph({ drawio_xml: null }), 'model.created');

  assert.match(built.drawioXml, /<mxfile|<mxGraphModel/);
  assert.notEqual(built.drawioXml, USABLE_DRAWIO);
  assert.equal(
    built.hashByTarget.drawio,
    hashExternalContent(JSON.stringify({ model: built.summary, content: built.drawioXml }))
  );
});

test('buildExternalPayload prefere o XML informado ao persistido', () => {
  const explicit = '<mxGraphModel><root><mxCell id="0" /></root></mxGraphModel>';
  const built = buildExternalPayload(sampleGraph(), 'model.updated', { drawioXml: explicit });
  assert.equal(built.drawioXml, explicit);
});

test('buildExternalPayload ignora XML informado inválido e regenera do grafo', () => {
  const built = buildExternalPayload(sampleGraph(), 'model.updated', {
    drawioXml: 'não é um draw.io',
  });
  assert.notEqual(built.drawioXml, 'não é um draw.io');
  assert.match(built.drawioXml, /<mxfile|<mxGraphModel/);
});

test('buildTargetBody em JSON inclui evento, alvo e conteúdos', () => {
  const built = buildExternalPayload(sampleGraph(), 'model.das.updated');
  const body = buildTargetBody(
    built,
    'das',
    'model.das.updated',
    'json',
    new Date('2026-05-06T07:08:09.000Z')
  );

  assert.equal(body.contentType, 'application/json; charset=utf-8');
  const parsed = JSON.parse(body.body);
  assert.equal(parsed.event, 'model.das.updated');
  assert.equal(parsed.target, 'das');
  assert.equal(parsed.content, built.dasContent);
  assert.equal(parsed.model.id, MODEL_ID);
  assert.equal(parsed.drawio.xml, built.drawioXml);
  assert.equal(parsed.das.content, built.dasContent);
  assert.equal(parsed.plantuml.source, built.plantuml);
  assert.equal(parsed.sentAt, '2026-05-06T07:08:09.000Z');
});

test('buildTargetBody em raw envia XML ou Markdown puro', () => {
  const built = buildExternalPayload(sampleGraph(), 'model.updated');

  const drawio = buildTargetBody(built, 'drawio', 'model.updated', 'raw');
  assert.equal(drawio.body, built.drawioXml);
  assert.equal(drawio.contentType, 'application/xml; charset=utf-8');

  const das = buildTargetBody(built, 'das', 'model.updated', 'raw');
  assert.equal(das.body, built.dasContent);
  assert.equal(das.contentType, 'text/markdown; charset=utf-8');
});

interface CapturedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage['headers'];
  body: string;
}

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse, captured: CapturedRequest) => void,
  run: (url: string, captured: CapturedRequest[]) => Promise<void>
): Promise<void> {
  const captured: CapturedRequest[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const entry: CapturedRequest = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      };
      captured.push(entry);
      handler(req, res, entry);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Servidor de teste sem porta');
  }

  try {
    await run(`http://127.0.0.1:${address.port}/hook`, captured);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('deliverExternalUpdate envia método, headers e corpo', async () => {
  await withServer(
    (_req, res) => {
      res.statusCode = 204;
      res.end();
    },
    async (url, captured) => {
      const result = await deliverExternalUpdate({
        url,
        method: 'PATCH',
        body: '{"ok":true}',
        contentType: 'application/json; charset=utf-8',
        headers: { Authorization: 'Bearer token', 'X-C4Arch-Target': 'das' },
      });

      assert.deepEqual(result, { ok: true, status: 204, error: null });
      assert.equal(captured.length, 1);
      assert.equal(captured[0].method, 'PATCH');
      assert.equal(captured[0].url, '/hook');
      assert.equal(captured[0].body, '{"ok":true}');
      assert.equal(captured[0].headers.authorization, 'Bearer token');
      assert.equal(captured[0].headers['x-c4arch-target'], 'das');
      assert.match(captured[0].headers['user-agent'] ?? '', /C4Arch-Integrations/);
    }
  );
});

test('deliverExternalUpdate reporta erro HTTP com detalhe do corpo', async () => {
  await withServer(
    (_req, res) => {
      res.statusCode = 422;
      res.setHeader('Content-Type', 'text/plain');
      res.end('campo inválido');
    },
    async (url) => {
      const result = await deliverExternalUpdate({
        url,
        method: 'PUT',
        body: 'x',
        contentType: 'text/plain',
      });

      assert.equal(result.ok, false);
      assert.equal(result.status, 422);
      assert.match(result.error ?? '', /HTTP 422/);
      assert.match(result.error ?? '', /campo inválido/);
    }
  );
});

test('deliverExternalUpdate não segue redirecionamentos', async () => {
  await withServer(
    (_req, res) => {
      res.statusCode = 302;
      res.setHeader('Location', 'http://127.0.0.1:1/outro');
      res.end();
    },
    async (url) => {
      const result = await deliverExternalUpdate({
        url,
        method: 'POST',
        body: 'x',
        contentType: 'text/plain',
      });

      assert.equal(result.ok, false);
      assert.equal(result.status, 302);
      assert.match(result.error ?? '', /Redirecionamento/i);
    }
  );
});

test('deliverExternalUpdate devolve erro quando a conexão falha', async () => {
  const result = await deliverExternalUpdate({
    url: 'http://127.0.0.1:1/hook',
    method: 'PUT',
    body: 'x',
    contentType: 'text/plain',
    timeoutMs: 2_000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.ok(result.error && result.error.length > 0);
});
