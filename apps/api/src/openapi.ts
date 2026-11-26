/**
 * Documento OpenAPI 3.1 gerado em código (Onda 3, item 15).
 *
 * Não há dependência de runtime: o documento é montado em TypeScript e servido
 * em `/api/openapi.json`. O script `npm run openapi:client` consome esse
 * endpoint para regenerar o cliente do frontend.
 */

const errorSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: { type: 'string' },
    code: { type: 'string' },
    details: {},
  },
} as const;

const modelSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    org_id: { type: 'string', format: 'uuid' },
    folder_id: { type: 'string', format: 'uuid', nullable: true },
    parent_id: { type: 'string', format: 'uuid', nullable: true },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['draft', 'final'] },
    c4_type: { type: 'string' },
    c4_scope: { type: 'string', nullable: true },
    drawio_xml: { type: 'string', nullable: true },
    diagrams: { type: 'array', items: { type: 'object' } },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
} as const;

const elementSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    model_id: { type: 'string', format: 'uuid' },
    type: { type: 'string', enum: ['actor', 'system', 'container', 'component'] },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    metadata: { type: 'object', nullable: true },
    position_x: { type: 'number' },
    position_y: { type: 'number' },
    order: { type: 'number' },
  },
} as const;

const edgeSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    model_id: { type: 'string', format: 'uuid' },
    from_id: { type: 'string', format: 'uuid' },
    to_id: { type: 'string', format: 'uuid' },
    label: { type: 'string', nullable: true },
    type: { type: 'string', enum: ['call', 'http', 'message', 'depends'] },
  },
} as const;

const commentSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    modelId: { type: 'string', format: 'uuid' },
    elementId: { type: 'string', format: 'uuid', nullable: true },
    content: { type: 'string' },
    author: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string', nullable: true },
      },
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time', nullable: true },
    resolved: { type: 'boolean' },
    resolvedBy: { type: 'string', format: 'uuid', nullable: true },
  },
} as const;

const idParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
} as const;

const keyParameter = {
  name: 'key',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const idempotencyHeader = {
  name: 'Idempotency-Key',
  in: 'header',
  required: false,
  schema: { type: 'string', maxLength: 200 },
  description: 'Repete a mesma resposta para requisições mutantes com a mesma chave.',
} as const;

const modelIdParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
} as const;

const bindingIdParameter = {
  name: 'bindingId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
} as const;

function jsonResponse(description: string, schema: unknown) {
  return {
    description,
    content: { 'application/json': { schema } },
  };
}

function errorResponse(description: string) {
  return jsonResponse(description, { $ref: '#/components/schemas/Error' });
}

export function buildOpenApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'C4Arch API',
      version: '0.1.0',
      description:
        'API do C4Arch: modelo C4 canônico, DAS, colaboração em tempo real, exportação e importação PlantUML.',
      license: { name: 'MIT' },
    },
    servers: [
      { url: 'http://localhost:4000', description: 'Desenvolvimento' },
      { url: 'https://c4arch.example.com', description: 'Self-host' },
    ],
    tags: [
      { name: 'auth' },
      { name: 'models' },
      { name: 'views' },
      { name: 'comments' },
      { name: 'exports' },
      { name: 'imports' },
      { name: 'collaboration' },
      { name: 'integrations' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Error: errorSchema,
        Model: modelSchema,
        Element: elementSchema,
        Edge: edgeSchema,
        Comment: commentSchema,
        InspectionIssue: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            severity: { type: 'string', enum: ['error', 'warning', 'info'] },
            message: { type: 'string' },
            entityId: { type: 'string' },
            viewKey: { type: 'string' },
          },
        },
        InspectionReport: {
          type: 'object',
          properties: {
            modelId: { type: 'string', format: 'uuid' },
            totalIssues: { type: 'integer' },
            bySeverity: {
              type: 'object',
              properties: {
                error: { type: 'integer' },
                warning: { type: 'integer' },
                info: { type: 'integer' },
              },
            },
            issues: {
              type: 'array',
              items: { $ref: '#/components/schemas/InspectionIssue' },
            },
          },
        },
        View: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', nullable: true },
            key: { type: 'string' },
            type: { type: 'string' },
            title: { type: 'string', nullable: true },
            description: { type: 'string', nullable: true },
            scopeElementId: { type: 'string', format: 'uuid', nullable: true },
            autoLayout: { type: 'boolean' },
            elementCount: { type: 'integer' },
          },
        },
        LayoutItem: {
          type: 'object',
          required: ['x', 'y'],
          properties: {
            elementId: { type: 'string', format: 'uuid', nullable: true },
            objectKey: { type: 'string', nullable: true },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number', nullable: true },
            height: { type: 'number', nullable: true },
            style: { type: 'object', nullable: true },
          },
        },
        ImportResult: {
          type: 'object',
          properties: {
            modelId: { type: 'string', format: 'uuid' },
            mode: { type: 'string', enum: ['replace', 'merge'] },
            elements: { type: 'integer' },
            relationships: { type: 'integer' },
            views: { type: 'integer' },
            skippedRelationships: { type: 'integer' },
          },
        },
        ImportModelSnapshot: {
          type: 'object',
          required: ['elements', 'edges'],
          properties: {
            elements: { type: 'array', items: { $ref: '#/components/schemas/Element' } },
            edges: { type: 'array', items: { $ref: '#/components/schemas/Edge' } },
          },
        },
        ExternalSystem: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            orgId: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            baseUrl: { type: 'string', nullable: true },
            authType: { type: 'string', enum: ['none', 'bearer', 'basic'] },
            authUser: { type: 'string', nullable: true },
            hasAuthToken: { type: 'boolean' },
            headers: { type: 'object', additionalProperties: { type: 'string' } },
            enabled: { type: 'boolean' },
            bindingCount: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        ModelExternalBinding: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            modelId: { type: 'string', format: 'uuid' },
            externalSystemId: { type: 'string', format: 'uuid' },
            externalSystemName: { type: 'string' },
            drawioUrl: { type: 'string', nullable: true },
            dasUrl: { type: 'string', nullable: true },
            method: { type: 'string', enum: ['POST', 'PUT', 'PATCH'] },
            format: { type: 'string', enum: ['json', 'raw'] },
            enabled: { type: 'boolean' },
            lastSyncAt: { type: 'string', format: 'date-time', nullable: true },
            lastSyncStatus: { type: 'string', nullable: true },
            lastSyncError: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/healthz': {
        get: {
          tags: ['collaboration'],
          summary: 'Healthcheck',
          security: [],
          responses: { '200': jsonResponse('OK', { type: 'object' }) },
        },
      },
      '/api/openapi.json': {
        get: {
          tags: ['collaboration'],
          summary: 'Documento OpenAPI',
          security: [],
          responses: { '200': jsonResponse('OpenAPI', { type: 'object' }) },
        },
      },
      '/api/auth/login': {
        post: {
          tags: ['auth'],
          summary: 'Autentica e devolve um JWT',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: { email: { type: 'string' }, password: { type: 'string' } },
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Sessão', {
              type: 'object',
              properties: { token: { type: 'string' }, user: { type: 'object' } },
            }),
            '401': errorResponse('Credenciais inválidas'),
          },
        },
      },
      '/api/auth/me': {
        get: {
          tags: ['auth'],
          summary: 'Usuário autenticado',
          responses: { '200': jsonResponse('Usuário', { type: 'object' }), '401': errorResponse('Não autenticado') },
        },
      },
      '/api/models': {
        get: {
          tags: ['models'],
          summary: 'Lista modelos das organizações do usuário',
          responses: {
            '200': jsonResponse('Modelos', { type: 'array', items: { $ref: '#/components/schemas/Model' } }),
          },
        },
        post: {
          tags: ['models'],
          summary: 'Cria um modelo',
          parameters: [idempotencyHeader],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['orgId', 'title'],
                  properties: {
                    orgId: { type: 'string', format: 'uuid' },
                    folderId: { type: 'string', format: 'uuid', nullable: true },
                    parentId: { type: 'string', format: 'uuid', nullable: true },
                    title: { type: 'string' },
                    description: { type: 'string', nullable: true },
                    status: { type: 'string', enum: ['draft', 'final'] },
                    c4Type: { type: 'string' },
                    c4Scope: { type: 'string', nullable: true },
                    drawioXml: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            '201': jsonResponse('Modelo criado', { $ref: '#/components/schemas/Model' }),
            '400': errorResponse('Dados inválidos'),
          },
        },
      },
      '/api/integrations': {
        get: {
          tags: ['integrations'],
          summary: 'Lista os sistemas externos configurados na organização',
          parameters: [
            {
              name: 'orgId',
              in: 'query',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': jsonResponse('Sistemas externos', {
              type: 'array',
              items: { $ref: '#/components/schemas/ExternalSystem' },
            }),
            '400': errorResponse('orgId inválido'),
          },
        },
        post: {
          tags: ['integrations'],
          summary: 'Cria um sistema externo (API de outro sistema)',
          parameters: [idempotencyHeader],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['orgId', 'name'],
                  properties: {
                    orgId: { type: 'string', format: 'uuid' },
                    name: { type: 'string' },
                    baseUrl: { type: 'string', nullable: true },
                    authType: { type: 'string', enum: ['none', 'bearer', 'basic'] },
                    authToken: { type: 'string', nullable: true },
                    authUser: { type: 'string', nullable: true },
                    headers: { type: 'object', additionalProperties: { type: 'string' } },
                    enabled: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: {
            '201': jsonResponse('Sistema externo criado', {
              $ref: '#/components/schemas/ExternalSystem',
            }),
            '400': errorResponse('Dados inválidos'),
          },
        },
      },
      '/api/integrations/{systemId}': {
        put: {
          tags: ['integrations'],
          summary: 'Atualiza um sistema externo',
          parameters: [
            {
              name: 'systemId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': jsonResponse('Sistema externo atualizado', {
              $ref: '#/components/schemas/ExternalSystem',
            }),
            '404': errorResponse('Sistema externo não encontrado'),
          },
        },
        delete: {
          tags: ['integrations'],
          summary: 'Remove um sistema externo e seus vínculos',
          parameters: [
            {
              name: 'systemId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': jsonResponse('Sistema externo removido', { type: 'object' }),
            '404': errorResponse('Sistema externo não encontrado'),
          },
        },
      },
      '/api/models/{id}/integrations': {
        get: {
          tags: ['integrations'],
          summary: 'Lista os vínculos de draw.io e DAS do modelo',
          parameters: [modelIdParameter],
          responses: {
            '200': jsonResponse('Vínculos do modelo', {
              type: 'array',
              items: { $ref: '#/components/schemas/ModelExternalBinding' },
            }),
          },
        },
        post: {
          tags: ['integrations'],
          summary: 'Vincula o modelo a um sistema externo',
          parameters: [modelIdParameter, idempotencyHeader],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['externalSystemId'],
                  properties: {
                    externalSystemId: { type: 'string', format: 'uuid' },
                    drawioUrl: { type: 'string', nullable: true },
                    dasUrl: { type: 'string', nullable: true },
                    method: { type: 'string', enum: ['POST', 'PUT', 'PATCH'] },
                    format: { type: 'string', enum: ['json', 'raw'] },
                    enabled: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: {
            '201': jsonResponse('Vínculo criado', {
              $ref: '#/components/schemas/ModelExternalBinding',
            }),
            '400': errorResponse('Dados inválidos'),
          },
        },
      },
      '/api/models/{id}/integrations/{bindingId}': {
        put: {
          tags: ['integrations'],
          summary: 'Atualiza as URLs de draw.io/DAS do vínculo',
          parameters: [modelIdParameter, bindingIdParameter],
          responses: {
            '200': jsonResponse('Vínculo atualizado', {
              $ref: '#/components/schemas/ModelExternalBinding',
            }),
            '404': errorResponse('Vínculo não encontrado'),
          },
        },
        delete: {
          tags: ['integrations'],
          summary: 'Remove o vínculo do modelo',
          parameters: [modelIdParameter, bindingIdParameter],
          responses: {
            '200': jsonResponse('Vínculo removido', { type: 'object' }),
            '404': errorResponse('Vínculo não encontrado'),
          },
        },
      },
      '/api/models/{id}/integrations/{bindingId}/sync': {
        post: {
          tags: ['integrations'],
          summary: 'Envia o draw.io e o DAS atuais para o sistema externo',
          parameters: [modelIdParameter, bindingIdParameter, idempotencyHeader],
          responses: {
            '200': jsonResponse('Resultado do envio', {
              type: 'object',
              properties: {
                ok: { type: 'boolean' },
                results: { type: 'array', items: { type: 'object' } },
              },
            }),
            '404': errorResponse('Vínculo não encontrado'),
          },
        },
      },
      '/api/models/import': {
        post: {
          tags: ['imports'],
          summary: 'Importa draw.io XML de arquivo ou URL',
          parameters: [idempotencyHeader],
          responses: {
            '201': jsonResponse('Modelo importado', { $ref: '#/components/schemas/Model' }),
            '400': errorResponse('XML inválido'),
          },
        },
      },
      '/api/models/import/plantuml': {
        post: {
          tags: ['imports'],
          summary: 'Importa um diagrama C4-PlantUML',
          parameters: [idempotencyHeader],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['orgId', 'content'],
                  properties: {
                    orgId: { type: 'string', format: 'uuid' },
                    folderId: { type: 'string', format: 'uuid', nullable: true },
                    parentId: { type: 'string', format: 'uuid', nullable: true },
                    title: { type: 'string' },
                    c4Type: { type: 'string' },
                    content: { type: 'string' },
                    format: { type: 'string', enum: ['plantuml'] },
                  },
                },
              },
            },
          },
          responses: {
            '201': jsonResponse('Diagrama importado', {
              allOf: [{ $ref: '#/components/schemas/Model' }, { type: 'object', properties: { import: { $ref: '#/components/schemas/ImportResult' } } }],
            }),
            '400': errorResponse('Workspace inválido'),
          },
        },
      },
      '/api/models/import/plantuml/templates': {
        get: {
          tags: ['imports'],
          summary: 'Lista padrões C4-PlantUML para criar modelos',
          responses: {
            '200': jsonResponse('Padrões disponíveis', {
              type: 'object',
              properties: {
                templates: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      description: { type: 'string' },
                      c4Type: { type: 'string' },
                      format: { type: 'string', enum: ['plantuml'] },
                      content: { type: 'string' },
                    },
                  },
                },
              },
            }),
          },
        },
      },
      '/api/plantuml/render': {
        post: {
          tags: ['exports'],
          summary: 'Renderiza um diagrama PlantUML em SVG para pré-visualização',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['content'],
                  properties: {
                    content: { type: 'string', description: 'Fonte PlantUML completa' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'SVG renderizado',
              content: { 'image/svg+xml': { schema: { type: 'string' } } },
            },
            '400': errorResponse('Conteúdo ausente'),
            '413': errorResponse('Conteúdo muito grande'),
            '502': errorResponse('Falha no servidor PlantUML'),
          },
        },
      },
      '/api/models/{id}': {
        get: {
          tags: ['models'],
          summary: 'Obtém um modelo com elementos e relações',
          parameters: [idParameter],
          responses: {
            '200': jsonResponse('Modelo', {
              allOf: [
                { $ref: '#/components/schemas/Model' },
                {
                  type: 'object',
                  properties: {
                    elements: { type: 'array', items: { $ref: '#/components/schemas/Element' } },
                    edges: { type: 'array', items: { $ref: '#/components/schemas/Edge' } },
                  },
                },
              ],
            }),
            '404': errorResponse('Modelo não encontrado'),
          },
        },
        put: {
          tags: ['models'],
          summary: 'Atualiza um modelo',
          parameters: [idParameter, idempotencyHeader],
          responses: { '200': jsonResponse('Modelo atualizado', { $ref: '#/components/schemas/Model' }) },
        },
        delete: {
          tags: ['models'],
          summary: 'Exclui um modelo',
          parameters: [idParameter],
          responses: { '200': jsonResponse('Excluído', { type: 'object' }) },
        },
      },
      '/api/models/{id}/das': {
        get: {
          tags: ['models'],
          summary: 'Obtém o DAS',
          parameters: [idParameter],
          responses: { '200': jsonResponse('DAS', { type: 'object', properties: { content: { type: 'string' } } }) },
        },
        put: {
          tags: ['models'],
          summary: 'Salva o DAS (gera overrides por seção)',
          parameters: [idParameter, idempotencyHeader],
          responses: { '200': jsonResponse('DAS salvo', { type: 'object' }) },
        },
      },
      '/api/models/{id}/inspections': {
        get: {
          tags: ['models'],
          summary: 'Saúde da arquitetura (inspections)',
          parameters: [idParameter],
          responses: { '200': jsonResponse('Relatório', { $ref: '#/components/schemas/InspectionReport' }) },
        },
      },
      '/api/models/{id}/versions': {
        get: {
          tags: ['models'],
          summary: 'Histórico de versões',
          parameters: [idParameter],
          responses: { '200': jsonResponse('Versões', { type: 'object' }) },
        },
      },
      '/api/models/{id}/versions/{versionId}/restore': {
        post: {
          tags: ['models'],
          summary: 'Restaura uma versão',
          parameters: [idParameter, { name: 'versionId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, idempotencyHeader],
          responses: { '200': jsonResponse('Restaurado', { type: 'object' }), '404': errorResponse('Versão não encontrada') },
        },
      },
      '/api/models/{id}/exports': {
        get: {
          tags: ['exports'],
          summary: 'Lista formatos de exportação',
          parameters: [idParameter],
          responses: { '200': jsonResponse('Formatos', { type: 'object' }) },
        },
      },
      '/api/models/{id}/export/{format}': {
        get: {
          tags: ['exports'],
          summary: 'Exporta o modelo',
          parameters: [
            idParameter,
            {
              name: 'format',
              in: 'path',
              required: true,
              schema: {
                type: 'string',
                enum: ['plantuml', 'mermaid', 'svg', 'html', 'drawio', 'png'],
              },
            },
            { name: 'theme', in: 'query', schema: { type: 'string', enum: ['light', 'dark'] } },
            { name: 'legend', in: 'query', schema: { type: 'boolean' } },
            { name: 'download', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: {
            '200': { description: 'Arquivo exportado' },
            '400': errorResponse('Formato inválido'),
          },
        },
      },
      '/api/models/{id}/preview': {
        get: {
          tags: ['exports'],
          summary: 'Preview server-side (SVG/PNG)',
          parameters: [idParameter, { name: 'format', in: 'query', schema: { type: 'string', enum: ['svg', 'png'] } }],
          responses: { '200': { description: 'Preview' } },
        },
      },
      '/api/models/{id}/import/plantuml': {
        post: {
          tags: ['imports'],
          summary: 'Importa/substitui o conteúdo do modelo com um diagrama C4-PlantUML',
          parameters: [idParameter, idempotencyHeader],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['content'],
                  properties: {
                    content: { type: 'string' },
                    format: { type: 'string', enum: ['plantuml'] },
                    mode: { type: 'string', enum: ['replace', 'merge'] },
                    title: { type: 'string' },
                    c4Type: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Importado', {
              type: 'object',
              required: ['ok', 'import'],
              properties: {
                ok: { type: 'boolean' },
                das_content: { type: 'string' },
                import: { $ref: '#/components/schemas/ImportResult' },
                model: {
                  oneOf: [
                    { $ref: '#/components/schemas/ImportModelSnapshot' },
                    { type: 'null' },
                  ],
                },
              },
            }),
            '400': errorResponse('Workspace inválido'),
          },
        },
      },
      '/api/models/{id}/views': {
        get: {
          tags: ['views'],
          summary: 'Lista views do modelo',
          parameters: [idParameter],
          responses: {
            '200': jsonResponse('Views', {
              type: 'object',
              properties: { views: { type: 'array', items: { $ref: '#/components/schemas/View' } } },
            }),
          },
        },
      },
      '/api/models/{id}/views/{key}/layout': {
        get: {
          tags: ['views'],
          summary: 'Obtém o layout de uma view',
          parameters: [idParameter, keyParameter],
          responses: {
            '200': jsonResponse('Layout', {
              type: 'object',
              properties: { items: { type: 'array', items: { $ref: '#/components/schemas/LayoutItem' } } },
            }),
          },
        },
        put: {
          tags: ['views'],
          summary: 'Salva o layout manual de uma view',
          parameters: [idParameter, keyParameter],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { items: { type: 'array', items: { $ref: '#/components/schemas/LayoutItem' } } },
                },
              },
            },
          },
          responses: { '200': jsonResponse('Layout salvo', { type: 'object' }) },
        },
      },
      '/api/models/{id}/views/{key}/autolayout': {
        post: {
          tags: ['views'],
          summary: 'Recalcula o layout automaticamente',
          parameters: [idParameter, keyParameter],
          responses: { '200': jsonResponse('Posições', { type: 'object' }) },
        },
      },
      '/api/models/{id}/comments': {
        get: {
          tags: ['comments'],
          summary: 'Lista comentários',
          parameters: [idParameter],
          responses: {
            '200': jsonResponse('Comentários', {
              type: 'object',
              properties: { comments: { type: 'array', items: { $ref: '#/components/schemas/Comment' } } },
            }),
          },
        },
        post: {
          tags: ['comments'],
          summary: 'Cria um comentário (por modelo ou elemento)',
          parameters: [idParameter, idempotencyHeader],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['content'],
                  properties: {
                    content: { type: 'string', maxLength: 5000 },
                    elementId: { type: 'string', format: 'uuid', nullable: true },
                  },
                },
              },
            },
          },
          responses: { '201': jsonResponse('Comentário', { $ref: '#/components/schemas/Comment' }) },
        },
      },
      '/api/models/{id}/comments/{commentId}': {
        patch: {
          tags: ['comments'],
          summary: 'Edita/resolve um comentário',
          parameters: [idParameter, { name: 'commentId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, idempotencyHeader],
          responses: { '200': jsonResponse('Comentário', { $ref: '#/components/schemas/Comment' }) },
        },
        delete: {
          tags: ['comments'],
          summary: 'Exclui um comentário',
          parameters: [idParameter, { name: 'commentId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': jsonResponse('Excluído', { type: 'object' }) },
        },
      },
    },
  } as const;
}

export function renderDocsHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>C4Arch API — OpenAPI</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
<style>body { margin: 0; } .topbar { display: none; }</style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
  window.ui = SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger-ui', deepLinking: true });
</script>
</body>
</html>`;
}
