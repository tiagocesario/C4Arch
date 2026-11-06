import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';
import { signDrawioToken } from '../auth/tokens.js';
import { getModelAccess, isWriterRole } from '../auth/access.js';
import { pool } from '../db.js';
import {
  ASSET_MARKER_ID,
  ASSET_MARKER_KIND,
  ASSET_MARKER_NAME,
  assetShapeLabel,
  type AssetKind,
  type AssetLike,
} from '../c4/assets.js';

const MAX_XML_LENGTH = 100_000;
const PAGE_TOKEN_TTL = '8h';

const APP_STYLE =
  'rounded=0;whiteSpace=wrap;html=1;fillColor=#438DD5;strokeColor=#3C7FC0;fontColor=#ffffff;align=center;verticalAlign=middle;spacing=6;';
const SERVICE_STYLE =
  'rounded=0;whiteSpace=wrap;html=1;fillColor=#85BBF0;strokeColor=#3C7FC0;fontColor=#1f2937;align=center;verticalAlign=middle;spacing=6;';

interface LibraryEntry {
  xml: string;
  w: number;
  h: number;
  title: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXmlAttribute(value: unknown): string {
  return escapeHtml(value);
}

/** Serializa um valor para uso seguro dentro de um bloco <script>. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function emptyDiagramXml(id: string, title: string): string {
  return (
    `<mxfile host="c4arch" modified="${new Date().toISOString()}" agent="C4Arch" version="1.0">` +
    `<diagram id="${escapeXmlAttribute(id)}" name="${escapeXmlAttribute(title)}">` +
    '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>' +
    '</diagram></mxfile>'
  );
}

/** Um shape de biblioteca do draw.io é um mxGraphModel independente. */
function libraryShapeXml(
  kind: AssetKind,
  asset: AssetLike,
  style: string
): string {
  const label = assetShapeLabel(kind, asset);
  return (
    '<mxGraphModel><root>' +
    '<mxCell id="0"/>' +
    '<mxCell id="1" parent="0"/>' +
    `<object id="c4arch-${escapeXmlAttribute(asset.id)}" label="${escapeXmlAttribute(label)}"` +
    ` ${ASSET_MARKER_ID}="${escapeXmlAttribute(asset.id)}"` +
    ` ${ASSET_MARKER_KIND}="${kind}"` +
    ` ${ASSET_MARKER_NAME}="${escapeXmlAttribute(asset.name)}">` +
    `<mxCell id="shape" style="${style}" vertex="1" parent="1">` +
    '<mxGeometry x="0" y="0" width="180" height="80" as="geometry"/>' +
    '</mxCell></object></root></mxGraphModel>'
  );
}

/**
 * Monta a lista de entradas da biblioteca (shapes) a partir dos apps e
 * serviços da organização. Reutilizada tanto pelo XML <mxlibrary> quanto pela
 * configuração do editor (More Shapes).
 */
async function buildLibraryEntries(orgId: string): Promise<LibraryEntry[]> {
  const [apps, services] = await Promise.all([
    pool.query<AssetLike>(
      'SELECT id, org_id, name, description, metadata FROM apps WHERE org_id = $1 ORDER BY name ASC',
      [orgId]
    ),
    pool.query<AssetLike>(
      'SELECT id, org_id, name, description, protocol, port, metadata FROM services WHERE org_id = $1 ORDER BY name ASC',
      [orgId]
    ),
  ]);

  const entries: LibraryEntry[] = [];

  for (const app of apps.rows) {
    entries.push({
      xml: libraryShapeXml('app', app, APP_STYLE),
      w: 180,
      h: 80,
      title: `App: ${app.name}`,
    });
  }

  for (const service of services.rows) {
    entries.push({
      xml: libraryShapeXml('service', service, SERVICE_STYLE),
      w: 180,
      h: 80,
      title: `Serviço: ${service.name}`,
    });
  }

  return entries;
}

/**
 * Monta a biblioteca de shapes com as aplicações e serviços da organização.
 * O draw.io consome esse XML no formato <mxlibrary>[...]</mxlibrary>.
 */
async function buildLibraryXml(orgId: string): Promise<string> {
  const entries = await buildLibraryEntries(orgId);
  // O JSON é conteúdo textual do XML: precisa ser escapado para o documento
  // <mxlibrary> continuar válido. O draw.io decodifica as entidades e faz
  // JSON.parse do texto resultante. O atributo `title` evita que o painel use
  // a data URL inteira como nome da biblioteca.
  return `<mxlibrary title="${escapeXmlAttribute('c4arch')}">${escapeHtml(JSON.stringify(entries))}</mxlibrary>`;
}

/**
 * O draw.io é carregado por HTTPS. Para não depender de CORS nem de conteúdo
 * misto (API local em HTTP), a biblioteca é entregue como data URL e o embed é
 * autorizado com o parâmetro `cors` a buscá-la diretamente.
 */
function libraryDataUrl(libraryXml: string): string {
  return `data:application/xml;base64,${Buffer.from(libraryXml, 'utf8').toString('base64')}`;
}

export class DrawioController {
  /** Emite um token escopado de 5 minutos para abrir o editor no navegador. */
  static async token(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Somente owner ou editor pode abrir o editor draw.io' });
      }

      const token = signDrawioToken(req.user!.id, req.user!.email, id);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ token, expiresIn: 300 });
    } catch (err) {
      console.error('[drawio] token error', err);
      return res.status(500).json({ error: 'Erro ao autorizar draw.io' });
    }
  }

  static async export(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });

      const result = await pool.query('SELECT drawio_xml FROM models WHERE id = $1', [id]);
      const xml = result.rows[0]?.drawio_xml;
      if (!xml) {
        return res.status(404).json({ error: 'Modelo ainda não possui diagrama draw.io' });
      }

      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="model.xml"');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(xml);
    } catch (err) {
      console.error('[drawio] export error', err);
      return res.status(500).json({ error: 'Erro ao exportar draw.io' });
    }
  }

  static async library(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });

      const xml = await buildLibraryXml(String(model.org_id));
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      // O draw.io busca a biblioteca de outra origem, sem cookies.
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      return res.send(xml || '<mxlibrary>[]</mxlibrary>');
    } catch (err) {
      console.error('[drawio] library error', err);
      return res.status(500).json({ error: 'Erro ao montar biblioteca draw.io' });
    }
  }

  static async import(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;
    const xml = req.body?.xml as unknown;

    if (typeof xml !== 'string' || !xml.trim()) {
      return res.status(400).json({ error: 'xml é obrigatório' });
    }
    if (xml.length > MAX_XML_LENGTH) {
      return res.status(413).json({ error: 'XML muito grande' });
    }
    if (!xml.trimStart().startsWith('<')) {
      return res.status(400).json({ error: 'XML inválido' });
    }

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Somente owner ou editor pode salvar o diagrama' });
      }

      await pool.query('UPDATE models SET drawio_xml = $1, updated_at = NOW() WHERE id = $2', [
        xml,
        id,
      ]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[drawio] import error', err);
      return res.status(500).json({ error: 'Erro ao importar draw.io' });
    }
  }

  static async editor(req: AuthenticatedRequest, res: Response) {
    const { id } = req.params;

    try {
      const model = await getModelAccess(req.user!.id, id);
      if (!model) return res.status(404).json({ error: 'Modelo não encontrado' });
      if (!isWriterRole(model.member_role)) {
        return res.status(403).json({ error: 'Somente owner ou editor pode abrir o editor draw.io' });
      }

      const title = String(model.title ?? 'Modelo');
      const storedXml = typeof model.drawio_xml === 'string' ? model.drawio_xml : '';
      const xml = storedXml.trim() ? storedXml : emptyDiagramXml(id, title);

      // O token da URL vale 5 min. A página recebe um token próprio, com escopo
      // no mesmo modelo, para que o autosave continue funcionando durante a
      // edição sem expor o JWT de sessão.
      const pageToken = signDrawioToken(req.user!.id, req.user!.email, id, PAGE_TOKEN_TTL);
      const [libraryXml, libraryEntries] = await Promise.all([
        buildLibraryXml(String(model.org_id)),
        buildLibraryEntries(String(model.org_id)),
      ]);

      const embedUrl = new URL('https://embed.diagrams.net/');
      embedUrl.searchParams.set('embed', '1');
      embedUrl.searchParams.set('proto', 'json');
      embedUrl.searchParams.set('spin', '1');
      embedUrl.searchParams.set('libraries', '1');
      embedUrl.searchParams.set('nav', '1');
      embedUrl.searchParams.set('saveAndExit', '1');
      embedUrl.searchParams.set('noSaveBtn', '0');
      embedUrl.searchParams.set('noExitBtn', '0');
      embedUrl.searchParams.set('lang', 'pt-br');
      embedUrl.searchParams.set('title', title);

      if (libraryXml) {
        // URLSearchParams faz a codificação uma única vez. O draw.io decodifica
        // o parâmetro e depois o próprio valor `U...`; a data URL não contém
        // `%`, então a segunda decodificação é inofensiva.
        embedUrl.searchParams.set('clibs', 'U' + libraryDataUrl(libraryXml));
        // Permite que o embed carregue a biblioteca data: sem passar pelo proxy.
        embedUrl.searchParams.set('cors', '^data:');
      }

      const officialUrl = new URL('https://app.diagrams.net/');
      if (libraryXml) {
        officialUrl.searchParams.set('clibs', 'U' + libraryDataUrl(libraryXml));
        officialUrl.searchParams.set('cors', '^data:');
      }
      // Abre o mesmo diagrama no editor oficial. O hash não é enviado ao
      // servidor do draw.io e serve como cópia/alternativa de edição.
      officialUrl.hash = 'R' + encodeURIComponent(xml);

      const exportUrl = `/api/models/${encodeURIComponent(id)}/drawio/xml?token=${encodeURIComponent(pageToken)}`;
      const importUrl = `/api/models/${encodeURIComponent(id)}/drawio/import?token=${encodeURIComponent(pageToken)}`;
      const safeTitle = escapeHtml(title);

      const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="referrer" content="no-referrer"/>
  <title>${safeTitle} — C4Arch draw.io</title>
  <style>
    :root { color-scheme: dark; }
    body { display:flex; flex-direction:column; height:100vh; margin:0; background:#0f1115; color:#e8eaed; font-family: system-ui, sans-serif; }
    header { padding:8px 12px; border-bottom:1px solid #2a2f3a; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
    header h1 { margin:0; font-size:16px; }
    .status { font-size:12px; color:#9ca3af; margin-left:auto; }
    .status[data-tone="ok"] { color:#4ade80; }
    .status[data-tone="warn"] { color:#fbbf24; }
    .status[data-tone="err"] { color:#f87171; }
    .controls { display:flex; gap:8px; flex-wrap:wrap; }
    .controls a, .controls button { padding:6px 10px; background:#2a2f3a; color:#e8eaed; border:1px solid #374151; border-radius:6px; cursor:pointer; text-decoration:none; font-size:13px; }
    .controls a.primary, .controls button.primary { background:#4f46e5; border-color:#4f46e5; color:#fff; }
    .drawio-frame { flex:1; background:#fff; border:none; width:100%; }
  </style>
</head>
<body>
  <header>
    <h1>${safeTitle}</h1>
    <div class="controls">
      <button id="save" class="primary" type="button">Salvar agora</button>
      <a id="export" href="${escapeHtml(exportUrl)}" download="model.xml">Exportar XML</a>
      <a href="${escapeHtml(officialUrl.toString())}" target="_blank" rel="noopener noreferrer">draw.io oficial</a>
    </div>
    <span id="status" class="status" data-tone="warn">Carregando draw.io…</span>
  </header>
  <iframe id="drawio" class="drawio-frame" src="${escapeHtml(embedUrl.toString())}"
          title="Editor draw.io" referrerpolicy="no-referrer" allowfullscreen></iframe>
  <script>
    (function () {
      'use strict';

      var XML = ${scriptJson(xml)};
      var TITLE = ${scriptJson(title)};
      var LIBRARY_ENTRIES = ${scriptJson(libraryEntries)};
      var IMPORT_URL = ${scriptJson(importUrl)};
      var statusEl = document.getElementById('status');
      var frame = document.getElementById('drawio');
      var saveBtn = document.getElementById('save');

      var ready = false;
      var pendingXml = null;
      var timer = null;
      var exitPending = false;
      var chain = Promise.resolve();

      function setStatus(message, tone) {
        statusEl.textContent = message;
        statusEl.setAttribute('data-tone', tone || 'warn');
      }

      function post(message) {
        if (frame.contentWindow) {
          frame.contentWindow.postMessage(JSON.stringify(message), 'https://embed.diagrams.net');
        }
      }

      function loadDiagram() {
        if (ready) return;
        ready = true;
        post({
          action: 'load',
          xml: XML,
          autosave: 1,
          title: TITLE,
          saveAndExit: 1,
          noSaveBtn: 0,
          noExitBtn: 0
        });
        setStatus('Editor pronto', 'ok');
      }

      function persist(xml) {
        setStatus('Salvando…', 'warn');
        chain = chain.then(function () {
          return fetch(IMPORT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ xml: xml })
          }).then(function (response) {
            if (!response.ok) {
              return response.json().catch(function () { return {}; }).then(function (body) {
                throw new Error(body.error || ('HTTP ' + response.status));
              });
            }
            setStatus('Salvo às ' + new Date().toLocaleTimeString('pt-BR'), 'ok');
            return true;
          }).catch(function (err) {
            setStatus('Falha ao salvar: ' + (err && err.message ? err.message : String(err)), 'err');
            return false;
          });
        });
        return chain;
      }

      function scheduleSave(xml) {
        pendingXml = xml;
        setStatus('Alterações pendentes…', 'warn');
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          timer = null;
          var next = pendingXml;
          pendingXml = null;
          if (next) persist(next);
        }, 1200);
      }

      window.addEventListener('message', function (event) {
        if (event.source !== frame.contentWindow) return;
        if (event.origin !== 'https://embed.diagrams.net') return;

        var message = event.data;
        if (typeof message === 'string') {
          try { message = JSON.parse(message); } catch (e) { return; }
        }
        if (!message || typeof message !== 'object') return;

        if (message.event === 'configure') {
          post({
            action: 'configure',
            config: {
              libraries: [
                {
                  title: { main: 'c4arch' },
                  entries: [
                    {
                      id: 'c4arch',
                      title: { main: 'c4arch' },
                      desc: { main: 'Apps e servicos C4 (biblioteca c4arch)' },
                      libs: [
                        {
                          title: { main: 'c4arch' },
                          data: LIBRARY_ENTRIES,
                        },
                      ],
                    },
                  ],
                },
              ],
              defaultCustomLibraries: ['c4arch'],
            },
          });
        } else if (message.event === 'init' || message.event === 'ready') {
          loadDiagram();
        } else if (message.event === 'autosave' && typeof message.xml === 'string') {
          scheduleSave(message.xml);
        } else if (message.event === 'save' && typeof message.xml === 'string') {
          pendingXml = null;
          if (timer) { clearTimeout(timer); timer = null; }
          persist(message.xml).then(function (ok) {
            if (ok && message.exit) {
              setStatus('Diagrama salvo. Fechando…', 'ok');
              window.setTimeout(function () { window.close(); }, 300);
            }
          });
        } else if (message.event === 'export' && typeof message.xml === 'string') {
          pendingXml = null;
          if (timer) { clearTimeout(timer); timer = null; }
          persist(message.xml).then(function (ok) {
            if (ok && exitPending) {
              exitPending = false;
              setStatus('Diagrama salvo. Fechando…', 'ok');
              window.setTimeout(function () { window.close(); }, 300);
            } else if (!ok) {
              exitPending = false;
            }
          });
        } else if (message.event === 'exit') {
          if (message.modified) {
            // Exporta o estado atual, salva e só então fecha a aba.
            exitPending = true;
            setStatus('Salvando antes de sair…', 'warn');
            post({ action: 'export', format: 'xml' });
          } else {
            window.close();
          }
        }
      });

      saveBtn.addEventListener('click', function () {
        if (!ready) return;
        setStatus('Lendo diagrama…', 'warn');
        post({ action: 'export', format: 'xml' });
      });

      window.addEventListener('beforeunload', function () {
        if (!pendingXml) return;
        try {
          var blob = new Blob([JSON.stringify({ xml: pendingXml })], { type: 'application/json' });
          navigator.sendBeacon(IMPORT_URL, blob);
        } catch (e) {
          // Sem beacon disponível: o autosave periódico já tentou persistir.
        }
      });
    })();
  </script>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'self'; frame-src https://embed.diagrams.net; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      );
      return res.send(html);
    } catch (err) {
      console.error('[drawio] editor error', err);
      return res.status(500).json({ error: 'Erro ao abrir editor draw.io' });
    }
  }
}
