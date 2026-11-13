#!/usr/bin/env node
import { createInterface } from 'node:readline';

/**
 * Servidor MCP do C4Arch (Onda 3).
 *
 * Fala JSON-RPC 2.0 por stdio (uma mensagem JSON por linha) e delega todas as
 * operações à API HTTP existente. Não acessa o Postgres diretamente, então
 * respeita permissões, auditoria, DAS e exportadores exatamente como a UI.
 *
 * Configuração:
 *   C4ARCH_API_URL  (padrão: http://localhost:4000)
 *   C4ARCH_TOKEN    JWT do usuário/serviço usado nas chamadas
 *
 * Uso típico em um cliente MCP:
 *   { "command": "node", "args": ["apps/mcp/dist/index.js"],
 *     "env": { "C4ARCH_API_URL": "...", "C4ARCH_TOKEN": "..." } }
 */

const API_URL = (process.env.C4ARCH_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const TOKEN = process.env.C4ARCH_TOKEN ?? '';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const MODEL_ID = {
  type: 'string',
  description: 'UUID do modelo',
} as const;

const TOOLS: ToolDefinition[] = [
  {
    name: 'c4_list_models',
    description: 'Lista os modelos C4 visíveis para o usuário autenticado.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'c4_get_model',
    description: 'Obtém um modelo com elementos e relações.',
    inputSchema: {
      type: 'object',
      properties: { modelId: MODEL_ID },
      required: ['modelId'],
      additionalProperties: false,
    },
  },
  {
    name: 'c4_create_model',
    description: 'Cria um modelo C4 vazio em uma organização.',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'UUID da organização' },
        title: { type: 'string' },
        description: { type: 'string' },
        c4Type: {
          type: 'string',
          enum: ['system-context', 'container', 'component', 'code', 'system-landscape', 'dynamic', 'deployment'],
        },
        folderId: { type: 'string' },
        parentId: { type: 'string' },
      },
      required: ['orgId', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'c4_update_model',
    description: 'Atualiza metadados de um modelo (título, descrição, status, tipo C4).',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: MODEL_ID,
        title: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'final'] },
        c4Type: { type: 'string' },
      },
      required: ['modelId'],
      additionalProperties: false,
    },
  },
  {
    name: 'c4_get_das',
    description: 'Retorna o Documento de Arquitetura de Software (DAS) em Markdown.',
    inputSchema: {
      type: 'object',
      properties: { modelId: MODEL_ID },
      required: ['modelId'],
      additionalProperties: false,
    },
  },
  {
    name: 'c4_inspect_model',
    description: 'Executa inspections e devolve problemas de arquitetura encontrados.',
    inputSchema: {
      type: 'object',
      properties: { modelId: MODEL_ID },
      required: ['modelId'],
      additionalProperties: false,
    },
  },
  {
    name: 'c4_list_views',
    description: 'Lista as views canônicas (ou a view derivada) de um modelo.',
    inputSchema: {
      type: 'object',
      properties: { modelId: MODEL_ID },
      required: ['modelId'],
      additionalProperties: false,
    },
  },
  {
    name: 'c4_auto_layout',
    description: 'Recalcula o layout de uma view a partir da topologia e do tipo C4.',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: MODEL_ID,
        viewKey: { type: 'string', description: 'Chave da view (padrão: container)' },
        direction: { type: 'string', enum: ['LR', 'TB'] },
      },
      required: ['modelId'],
      additionalProperties: false,
    },
  },
  {
    name: 'c4_export_model',
    description:
      'Exporta o modelo em Structurizr JSON/DSL, PlantUML, Mermaid, SVG, HTML, draw.io ou PNG (PNG em base64).',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: MODEL_ID,
        format: {
          type: 'string',
          enum: ['structurizr-json', 'structurizr-dsl', 'plantuml', 'mermaid', 'svg', 'html', 'drawio', 'png'],
        },
        theme: { type: 'string', enum: ['light', 'dark'] },
      },
      required: ['modelId', 'format'],
      additionalProperties: false,
    },
  },
  {
    name: 'c4_import_structurizr',
    description: 'Importa um workspace Structurizr (JSON ou DSL) criando um novo modelo.',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: { type: 'string' },
        content: { type: 'string', description: 'Conteúdo do workspace JSON ou DSL' },
        title: { type: 'string' },
        c4Type: { type: 'string' },
        format: { type: 'string', enum: ['json', 'dsl'] },
        folderId: { type: 'string' },
        parentId: { type: 'string' },
      },
      required: ['orgId', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'c4_list_comments',
    description: 'Lista os comentários de um modelo.',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: MODEL_ID,
        resolved: { type: 'boolean' },
      },
      required: ['modelId'],
      additionalProperties: false,
    },
  },
  {
    name: 'c4_create_comment',
    description: 'Cria um comentário geral ou ancorado em um elemento.',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: MODEL_ID,
        content: { type: 'string', maxLength: 5000 },
        elementId: { type: 'string', description: 'UUID do elemento (opcional)' },
      },
      required: ['modelId', 'content'],
      additionalProperties: false,
    },
  },
];

interface ApiResult {
  status: number;
  ok: boolean;
  contentType: string;
  text: string;
  base64?: string;
}

async function callApi(
  method: string,
  path: string,
  body?: unknown,
  accept?: string
): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accept) headers.Accept = accept;

  const response = await fetch(API_URL + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.startsWith('image/') || contentType.startsWith('application/octet-stream')) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      ok: response.ok,
      contentType,
      text: '',
      base64: buffer.toString('base64'),
    };
  }
  return {
    status: response.status,
    ok: response.ok,
    contentType,
    text: await response.text(),
  };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} é obrigatório`);
  }
  return value;
}

async function runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'c4_list_models':
      return callApi('GET', '/api/models');
    case 'c4_get_model':
      return callApi('GET', `/api/models/${requireString(args, 'modelId')}`);
    case 'c4_create_model': {
      const orgId = requireString(args, 'orgId');
      const title = requireString(args, 'title');
      return callApi('POST', '/api/models', {
        orgId,
        title,
        description: typeof args.description === 'string' ? args.description : undefined,
        c4Type: typeof args.c4Type === 'string' ? args.c4Type : undefined,
        folderId: typeof args.folderId === 'string' ? args.folderId : undefined,
        parentId: typeof args.parentId === 'string' ? args.parentId : undefined,
      });
    }
    case 'c4_update_model': {
      const modelId = requireString(args, 'modelId');
      return callApi('PUT', `/api/models/${modelId}`, {
        title: typeof args.title === 'string' ? args.title : undefined,
        description: typeof args.description === 'string' ? args.description : undefined,
        status: typeof args.status === 'string' ? args.status : undefined,
        c4Type: typeof args.c4Type === 'string' ? args.c4Type : undefined,
      });
    }
    case 'c4_get_das':
      return callApi('GET', `/api/models/${requireString(args, 'modelId')}/das`);
    case 'c4_inspect_model':
      return callApi('GET', `/api/models/${requireString(args, 'modelId')}/inspections`);
    case 'c4_list_views':
      return callApi('GET', `/api/models/${requireString(args, 'modelId')}/views`);
    case 'c4_auto_layout': {
      const modelId = requireString(args, 'modelId');
      const viewKey = typeof args.viewKey === 'string' && args.viewKey.trim()
        ? args.viewKey.trim()
        : 'container';
      return callApi('POST', `/api/models/${modelId}/views/${encodeURIComponent(viewKey)}/autolayout`, {
        direction: args.direction === 'TB' ? 'TB' : 'LR',
      });
    }
    case 'c4_export_model': {
      const modelId = requireString(args, 'modelId');
      const format = requireString(args, 'format');
      const theme = args.theme === 'dark' ? 'dark' : 'light';
      return callApi(
        'GET',
        `/api/models/${modelId}/export/${encodeURIComponent(format)}?theme=${theme}`,
        undefined,
        '*/*'
      );
    }
    case 'c4_import_structurizr': {
      const orgId = requireString(args, 'orgId');
      const content = requireString(args, 'content');
      return callApi('POST', '/api/models/import/structurizr', {
        orgId,
        content,
        title: typeof args.title === 'string' ? args.title : undefined,
        c4Type: typeof args.c4Type === 'string' ? args.c4Type : undefined,
        format: args.format === 'json' || args.format === 'dsl' ? args.format : undefined,
        folderId: typeof args.folderId === 'string' ? args.folderId : undefined,
        parentId: typeof args.parentId === 'string' ? args.parentId : undefined,
      });
    }
    case 'c4_list_comments': {
      const modelId = requireString(args, 'modelId');
      const query = typeof args.resolved === 'boolean' ? `?resolved=${args.resolved}` : '';
      return callApi('GET', `/api/models/${modelId}/comments${query}`);
    }
    case 'c4_create_comment': {
      const modelId = requireString(args, 'modelId');
      const content = requireString(args, 'content');
      return callApi('POST', `/api/models/${modelId}/comments`, {
        content,
        elementId: typeof args.elementId === 'string' ? args.elementId : undefined,
      });
    }
    default:
      throw new Error(`Ferramenta desconhecida: ${name}`);
  }
}

function toolResponse(result: ApiResult) {
  const isImage = Boolean(result.base64);
  const text = isImage
    ? `Arquivo ${result.contentType} (${result.base64!.length} bytes em base64):\n${result.base64}`
    : result.text;
  return {
    content: [{ type: 'text', text: text || '(resposta vazia)' }],
    isError: !result.ok,
  };
}

function send(message: unknown): void {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function reply(id: JsonRpcRequest['id'], result: unknown): void {
  send({ jsonrpc: '2.0', id: id ?? null, result });
}

function replyError(id: JsonRpcRequest['id'], code: number, message: string): void {
  send({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

async function handle(message: JsonRpcRequest): Promise<void> {
  const { id, method, params } = message;
  if (!method) {
    if (id !== undefined) replyError(id, -32600, 'Requisição inválida');
    return;
  }

  // Notificações não têm id e não recebem resposta.
  const isNotification = id === undefined || id === null;

  try {
    switch (method) {
      case 'initialize':
        reply(id, {
          protocolVersion:
            typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'c4arch-mcp', version: '0.1.0' },
          instructions:
            'Servidor MCP do C4Arch. Use as ferramentas c4_* para consultar e evoluir modelos C4, exportar diagramas e gerenciar comentários.',
        });
        return;
      case 'notifications/initialized':
      case 'initialized':
        return;
      case 'ping':
        reply(id, {});
        return;
      case 'tools/list':
        reply(id, { tools: TOOLS });
        return;
      case 'tools/call': {
        const name = typeof params?.name === 'string' ? params.name : '';
        if (!name) {
          replyError(id, -32602, 'name é obrigatório');
          return;
        }
        const rawArgs = params?.arguments;
        const args =
          rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
            ? (rawArgs as Record<string, unknown>)
            : {};
        try {
          const result = await runTool(name, args);
          if (result && typeof result === 'object' && 'status' in result) {
            reply(id, toolResponse(result as ApiResult));
          } else {
            reply(id, result);
          }
        } catch (err) {
          replyError(id, -32603, err instanceof Error ? err.message : String(err));
        }
        return;
      }
      default:
        if (!isNotification) replyError(id, -32601, `Método não encontrado: ${method}`);
    }
  } catch (err) {
    if (!isNotification) {
      replyError(id, -32603, err instanceof Error ? err.message : String(err));
    }
  }
}

function main(): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: JsonRpcRequest;
    try {
      parsed = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      replyError(null, -32700, 'JSON inválido');
      return;
    }
    void handle(parsed);
  });
  rl.on('close', () => process.exit(0));
  console.error(
    `[c4arch-mcp] pronto (API: ${API_URL}${TOKEN ? ', autenticado' : ', sem token'})`
  );
}

main();
