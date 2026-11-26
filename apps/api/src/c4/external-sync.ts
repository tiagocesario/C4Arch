import { createHash } from 'node:crypto';
import { pool } from '../db.js';
import { loadModelGraph, type ModelGraph } from './model-graph.js';
import { exportModel, isUsableDrawioXml } from './exporters.js';
import { regenerateModelDAS } from './das-service.js';

/**
 * Integrações de saída (Onda 4).
 *
 * Cada modelo pode ser vinculado a um ou mais sistemas externos. Para cada
 * vínculo o usuário informa a URL que recebe o draw.io e a URL que recebe o
 * DAS. Sempre que o modelo muda, o C4Arch envia o conteúdo atualizado por HTTP
 * (PUT por padrão) para essas URLs.
 *
 * O envio é best-effort e assíncrono: falhas de um sistema externo nunca
 * derrubam a operação que originou a atualização. O hash do último conteúdo
 * entregue evita reenviar o mesmo payload em autosaves repetidos.
 */

export type ExternalEvent =
  | 'model.created'
  | 'model.updated'
  | 'model.das.updated'
  | 'model.deleted';

export type ExternalTarget = 'drawio' | 'das';
export type ExternalMethod = 'POST' | 'PUT' | 'PATCH';
export type ExternalFormat = 'json' | 'raw';

export interface ExternalModelSummary {
  id: string;
  orgId: string;
  title: string;
  description: string | null;
  status: string;
  c4Type: string;
  c4Scope: string | null;
  updatedAt: string | null;
}

export interface BuiltExternalPayload {
  summary: ExternalModelSummary;
  drawioXml: string;
  dasContent: string;
  plantuml: string;
  hashByTarget: Record<ExternalTarget, string>;
}

export interface ExternalPayloadOptions {
  /** XML salvo no editor draw.io. Quando ausente, o desenho é gerado do grafo. */
  drawioXml?: string | null;
}

export interface DeliveryResult {
  target: ExternalTarget;
  url: string;
  status: number | null;
  ok: boolean;
  skipped: boolean;
  error: string | null;
}

export interface BindingSyncResult {
  bindingId: string;
  externalSystemId: string;
  externalSystemName: string;
  deliveries: DeliveryResult[];
}

export interface SyncModelExternalOptions {
  /** Ignora o hash e reenvia mesmo sem mudanças. */
  force?: boolean;
  /** Limita o envio a um vínculo específico (usado pelo botão "Enviar agora"). */
  bindingId?: string;
  /** Regera o DAS antes de montar o payload (padrão: true). */
  regenerateDas?: boolean;
  /** Prefere o XML draw.io persistido em vez de gerar um novo a partir do grafo. */
  preferStoredDrawio?: boolean;
  timeoutMs?: number;
}

interface BindingRow {
  id: string;
  model_id: string;
  external_system_id: string;
  drawio_url: string | null;
  das_url: string | null;
  method: ExternalMethod;
  format: ExternalFormat;
  enabled: boolean;
  last_drawio_hash: string | null;
  last_das_hash: string | null;
  system_name: string;
  system_enabled: boolean;
  auth_type: 'none' | 'bearer' | 'basic';
  auth_token: string | null;
  auth_user: string | null;
  headers: Record<string, unknown> | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function hashExternalContent(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function summaryFromGraph(graph: ModelGraph): ExternalModelSummary {
  const model = graph.model;
  return {
    id: text(model.id),
    orgId: text(model.org_id),
    title: text(model.title),
    description: optionalText(model.description),
    status: text(model.status) || 'draft',
    c4Type: text(model.c4_type) || 'container',
    c4Scope: optionalText(model.c4_scope),
    updatedAt: optionalText(model.updated_at),
  };
}

function hashForTarget(summary: ExternalModelSummary, content: string): string {
  return hashExternalContent(JSON.stringify({ model: summary, content }));
}

/**
 * Monta o conteúdo entregue aos sistemas externos. Exportado para testes e
 * para que o contrato do payload fique explícito.
 */
export function buildExternalPayload(
  graph: ModelGraph,
  event: ExternalEvent,
  options: ExternalPayloadOptions = {}
): BuiltExternalPayload {
  const summary = summaryFromGraph(graph);
  const storedXml = options.drawioXml === undefined ? null : options.drawioXml;
  const drawioXml =
    isUsableDrawioXml(storedXml) ? (storedXml as string) : String(exportModel(graph, 'drawio').body);
  const plantuml = String(exportModel(graph, 'plantuml').body);
  const dasContent = text(graph.model.das_content);

  return {
    summary,
    drawioXml,
    dasContent,
    plantuml,
    hashByTarget: {
      drawio: hashForTarget(summary, drawioXml),
      das: hashForTarget(summary, dasContent),
    },
  };
}

export function buildTargetBody(
  built: BuiltExternalPayload,
  target: ExternalTarget,
  event: ExternalEvent,
  format: ExternalFormat,
  now: Date = new Date()
): { body: string; contentType: string } {
  const content = target === 'drawio' ? built.drawioXml : built.dasContent;
  if (format === 'raw') {
    return {
      body: content,
      contentType: target === 'drawio' ? 'application/xml; charset=utf-8' : 'text/markdown; charset=utf-8',
    };
  }

  const payload = {
    event,
    target,
    content,
    model: built.summary,
    drawio: { xml: built.drawioXml },
    das: { content: built.dasContent },
    plantuml: { source: built.plantuml },
    sentAt: now.toISOString(),
  };
  return { body: JSON.stringify(payload), contentType: 'application/json; charset=utf-8' };
}

function authHeaders(row: BindingRow): Record<string, string> {
  const headers: Record<string, string> = {};
  if (row.auth_type === 'bearer' && row.auth_token) {
    headers.Authorization = `Bearer ${row.auth_token}`;
  } else if (row.auth_type === 'basic' && row.auth_token) {
    const user = row.auth_user ?? '';
    headers.Authorization = `Basic ${Buffer.from(`${user}:${row.auth_token}`).toString('base64')}`;
  }

  if (row.headers && typeof row.headers === 'object') {
    for (const [key, value] of Object.entries(row.headers)) {
      if (typeof value === 'string' && key.trim()) headers[key.trim()] = value;
    }
  }
  return headers;
}

async function readResponseText(response: Response): Promise<string> {
  try {
    const value = await response.text();
    return value.slice(0, 500);
  } catch {
    return '';
  }
}

/**
 * Entrega um conteúdo a uma URL externa. Redirecionamentos não são seguidos:
 * a URL configurada é o destino final, o que evita que um endpoint comprometido
 * redirecione a requisição para outro host.
 */
export async function deliverExternalUpdate(options: {
  url: string;
  method: ExternalMethod;
  body: string;
  contentType: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

  try {
    const response = await fetch(options.url, {
      method: options.method,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': options.contentType,
        'User-Agent': 'C4Arch-Integrations/1.0',
        ...(options.headers ?? {}),
      },
      body: options.body,
      redirect: 'manual',
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      return { ok: false, status: response.status, error: 'Redirecionamento não permitido' };
    }
    if (!response.ok) {
      const detail = await readResponseText(response);
      return {
        ok: false,
        status: response.status,
        error: detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`,
      };
    }
    return { ok: true, status: response.status, error: null };
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Tempo esgotado ao chamar o sistema externo'
        : err instanceof Error
          ? err.message
          : 'Falha ao chamar o sistema externo';
    return { ok: false, status: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

async function loadBindings(modelId: string, bindingId?: string): Promise<BindingRow[]> {
  const params: string[] = [modelId];
  let filter = '';
  if (bindingId) {
    params.push(bindingId);
    filter = ' AND b.id = $2';
  }

  const result = await pool.query<BindingRow>(
    `SELECT b.id, b.model_id, b.external_system_id, b.drawio_url, b.das_url,
            b.method, b.format, b.enabled, b.last_drawio_hash, b.last_das_hash,
            s.name AS system_name, s.enabled AS system_enabled,
            s.auth_type, s.auth_token, s.auth_user, s.headers
       FROM model_external_bindings b
       JOIN external_systems s ON s.id = b.external_system_id
      WHERE b.model_id = $1${filter}
      ORDER BY s.name`,
    params
  );
  return result.rows;
}

async function saveDeliveryState(
  binding: BindingRow,
  deliveries: DeliveryResult[],
  hashByTarget: Record<ExternalTarget, string>
): Promise<void> {
  const attempted = deliveries.filter((delivery) => !delivery.skipped);
  const failed = attempted.filter((delivery) => !delivery.ok);
  const status =
    failed.length === 0 ? 'ok' : failed.length === attempted.length ? 'error' : 'partial';
  const error = failed
    .map((delivery) => `${delivery.target}: ${delivery.error ?? 'erro'}`)
    .join('; ')
    .slice(0, 1000);

  const drawioDelivered = deliveries.some(
    (delivery) => delivery.target === 'drawio' && !delivery.skipped && delivery.ok
  );
  const dasDelivered = deliveries.some(
    (delivery) => delivery.target === 'das' && !delivery.skipped && delivery.ok
  );

  await pool.query(
    `UPDATE model_external_bindings
        SET last_sync_at = NOW(),
            last_sync_status = $2,
            last_sync_error = $3,
            last_drawio_hash = CASE WHEN $4 THEN $5 ELSE last_drawio_hash END,
            last_das_hash = CASE WHEN $6 THEN $7 ELSE last_das_hash END,
            updated_at = NOW()
      WHERE id = $1`,
    [
      binding.id,
      status,
      error || null,
      drawioDelivered,
      hashByTarget.drawio,
      dasDelivered,
      hashByTarget.das,
    ]
  );
}

/**
 * Sincroniza um modelo com todos os seus vínculos externos habilitados.
 * Exportada para o controller (botão "Enviar agora") e para os hooks de
 * atualização de modelo, elementos, relações e DAS.
 */
export async function syncModelExternal(
  modelId: string,
  event: ExternalEvent = 'model.updated',
  options: SyncModelExternalOptions = {}
): Promise<BindingSyncResult[]> {
  const bindings = await loadBindings(modelId, options.bindingId);
  if (bindings.length === 0) return [];

  if (options.regenerateDas !== false) {
    try {
      await regenerateModelDAS(modelId);
    } catch (err) {
      console.error('[integrations] falha ao regenerar DAS antes do envio', err);
    }
  }

  const graph = await loadModelGraph(modelId);
  if (!graph) return [];

  const built = buildExternalPayload(graph, event, {
    drawioXml: options.preferStoredDrawio ? optionalText(graph.model.drawio_xml) : null,
  });

  const results: BindingSyncResult[] = [];

  for (const binding of bindings) {
    if (!binding.enabled || !binding.system_enabled) continue;

    const deliveries: DeliveryResult[] = [];
    const targets: Array<{ target: ExternalTarget; url: string | null; hash: string | null }> = [
      { target: 'drawio', url: binding.drawio_url, hash: binding.last_drawio_hash },
      { target: 'das', url: binding.das_url, hash: binding.last_das_hash },
    ];

    for (const item of targets) {
      if (!item.url) continue;

      if (!options.force && item.hash === built.hashByTarget[item.target]) {
        deliveries.push({
          target: item.target,
          url: item.url,
          status: null,
          ok: true,
          skipped: true,
          error: null,
        });
        continue;
      }

      const body = buildTargetBody(built, item.target, event, binding.format);
      const delivered = await deliverExternalUpdate({
        url: item.url,
        method: binding.method,
        body: body.body,
        contentType: body.contentType,
        headers: {
          ...authHeaders(binding),
          'X-C4Arch-Event': event,
          'X-C4Arch-Model-Id': modelId,
          'X-C4Arch-Target': item.target,
        },
        timeoutMs: options.timeoutMs,
      });

      deliveries.push({
        target: item.target,
        url: item.url,
        status: delivered.status,
        ok: delivered.ok,
        skipped: false,
        error: delivered.error,
      });
    }

    if (deliveries.length === 0) continue;

    try {
      await saveDeliveryState(binding, deliveries, built.hashByTarget);
    } catch (err) {
      console.error('[integrations] falha ao salvar estado do vínculo', err);
    }

    results.push({
      bindingId: binding.id,
      externalSystemId: binding.external_system_id,
      externalSystemName: binding.system_name,
      deliveries,
    });
  }

  return results;
}

/** Dispara a sincronização sem bloquear a resposta HTTP e sem propagar falhas. */
export function queueModelExternalSync(
  modelId: string,
  event: ExternalEvent = 'model.updated',
  options: SyncModelExternalOptions = {}
): void {
  void syncModelExternal(modelId, event, options).catch((err) => {
    console.error(`[integrations] falha ao sincronizar modelo ${modelId}`, err);
  });
}
