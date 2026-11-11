import type { NextFunction, Request, Response } from 'express';

/**
 * Telemetria mínima da Onda 1, sem dependência externa.
 *
 * Expõe métricas no formato Prometheus em `GET /metrics` (quando habilitado).
 * O objetivo é dar visibilidade a tempo de request, erros, contagem de modelos
 * e falhas de projeção antes de ligar o modelo canônico.
 */

const httpRequests = new Map<string, number>();
const duration = { count: 0, sumMs: 0, maxMs: 0 };
let httpErrorsTotal = 0;
let modelsTotal = 0;
let projectionErrorsTotal = 0;
let shadowComparisonsTotal = 0;
let shadowDivergentModelsTotal = 0;
const shadowDivergences = new Map<string, number>();
const startedAt = Date.now();

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function routeLabel(req: Request): string {
  const routePath = req.route?.path;
  const path = typeof routePath === 'string' ? routePath : req.path;
  const full = `${req.baseUrl ?? ''}${path}` || '/';
  return full.replace(UUID_RE, ':id');
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const labels = `method="${escapeLabel(req.method)}",route="${escapeLabel(
      routeLabel(req)
    )}",status="${res.statusCode}"`;

    httpRequests.set(labels, (httpRequests.get(labels) ?? 0) + 1);
    duration.count += 1;
    duration.sumMs += elapsedMs;
    duration.maxMs = Math.max(duration.maxMs, elapsedMs);
    if (res.statusCode >= 500) httpErrorsTotal += 1;

    if (elapsedMs >= 1000) {
      console.warn(
        `[metrics] requisição lenta: ${req.method} ${req.originalUrl} ` +
          `status=${res.statusCode} duração=${elapsedMs.toFixed(0)}ms`
      );
    }
  });

  next();
}

export function setModelsTotal(value: number): void {
  modelsTotal = Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

export function recordProjectionError(): void {
  projectionErrorsTotal += 1;
}

export function recordShadowComparison(divergent: boolean, kinds: string[] = []): void {
  shadowComparisonsTotal += 1;
  if (divergent) shadowDivergentModelsTotal += 1;
  for (const kind of kinds) {
    shadowDivergences.set(kind, (shadowDivergences.get(kind) ?? 0) + 1);
  }
}

export function renderMetrics(): string {
  const lines: string[] = [
    '# HELP c4arch_http_requests_total Total de requisições HTTP por método, rota e status.',
    '# TYPE c4arch_http_requests_total counter',
  ];

  for (const [labels, value] of [...httpRequests.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`c4arch_http_requests_total{${labels}} ${value}`);
  }

  lines.push(
    '# HELP c4arch_http_request_duration_ms Duração das requisições HTTP em milissegundos.',
    '# TYPE c4arch_http_request_duration_ms summary',
    `c4arch_http_request_duration_ms_count ${duration.count}`,
    `c4arch_http_request_duration_ms_sum ${duration.sumMs.toFixed(3)}`,
    `c4arch_http_request_duration_ms_max ${duration.maxMs.toFixed(3)}`,
    '# HELP c4arch_http_errors_total Total de respostas HTTP 5xx.',
    '# TYPE c4arch_http_errors_total counter',
    `c4arch_http_errors_total ${httpErrorsTotal}`,
    '# HELP c4arch_models_total Quantidade de modelos no banco no startup da API.',
    '# TYPE c4arch_models_total gauge',
    `c4arch_models_total ${modelsTotal}`,
    '# HELP c4arch_projection_errors_total Falhas ao projetar o estado colaborativo no modelo canônico.',
    '# TYPE c4arch_projection_errors_total counter',
    `c4arch_projection_errors_total ${projectionErrorsTotal}`,
    '# HELP c4arch_shadow_comparisons_total Comparações legado × canônico executadas em modo sombra.',
    '# TYPE c4arch_shadow_comparisons_total counter',
    `c4arch_shadow_comparisons_total ${shadowComparisonsTotal}`,
    '# HELP c4arch_shadow_divergent_models_total Comparações em sombra com pelo menos uma divergência.',
    '# TYPE c4arch_shadow_divergent_models_total counter',
    `c4arch_shadow_divergent_models_total ${shadowDivergentModelsTotal}`,
    '# HELP c4arch_shadow_divergences_total Divergências de sombra por tipo.',
    '# TYPE c4arch_shadow_divergences_total counter',
    ...([...shadowDivergences.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, value]) => `c4arch_shadow_divergences_total{kind="${escapeLabel(kind)}"} ${value}`)),
    '# HELP c4arch_uptime_seconds Tempo desde o startup da API.',
    '# TYPE c4arch_uptime_seconds gauge',
    `c4arch_uptime_seconds ${((Date.now() - startedAt) / 1000).toFixed(0)}`
  );

  return `${lines.join('\n')}\n`;
}
