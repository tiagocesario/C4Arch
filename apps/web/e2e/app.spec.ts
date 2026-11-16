import { test, expect, type Page } from '@playwright/test';

const user = { id: 'user-1', email: 'ana@example.com', name: 'Ana' };
const org = { id: 'org-1', name: 'Arquitetura', slug: 'arquitetura', role: 'owner' };
const createdModel = {
  id: 'model-1',
  org_id: org.id,
  folder_id: null,
  parent_id: null,
  title: 'Loja',
  description: 'Modelo criado a partir de um padrão PlantUML',
  status: 'draft',
  c4_type: 'container',
  c4_scope: null,
  drawio_xml: null,
  elements: [],
  edges: [],
  created_at: '2026-01-02T03:04:05.000Z',
  updated_at: '2026-01-02T03:04:05.000Z',
};

const plantUmlTemplates = [
  {
    id: 'containers',
    name: 'Sistema e containers',
    description: 'Aplicação web, API e banco de dados.',
    c4Type: 'container',
    format: 'plantuml',
    content: '@startuml\ntitle Sistema e containers\n@enduml',
  },
];

/**
 * Mock da API usado pelos testes. Responde o suficiente para o bootstrap da
 * sessão (auth/me + catálogo vazio) e para o POST de login.
 */
async function mockApi(
  target: Page | import('@playwright/test').BrowserContext,
  options: { models?: unknown[]; modelDetail?: unknown } = {}
): Promise<void> {
  const modelList = options.models ?? [];
  const modelDetail = options.modelDetail ?? createdModel;
  await target.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (method === 'POST' && path === '/api/auth/login') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'e2e-token', user }),
      });
    }

    if (method === 'POST' && path === '/api/models/import/plantuml') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ...createdModel,
          import: {
            modelId: createdModel.id,
            mode: 'replace',
            elements: 0,
            relationships: 0,
            views: 1,
            skippedRelationships: 0,
          },
        }),
      });
    }

    if (method === 'GET' && path === '/api/models/model-1/export/plantuml') {
      return route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: '@startuml\ntitle Loja\n@enduml',
      });
    }

    if (method === 'POST' && path === '/api/models/model-1/import/plantuml') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          das_content: '',
          import: {
            modelId: 'model-1',
            mode: 'replace',
            elements: 1,
            relationships: 0,
            views: 1,
            skippedRelationships: 0,
          },
        }),
      });
    }

    const responses: Record<string, unknown> = {
      '/api/auth/me': { user, org },
      '/api/models': modelList,
      '/api/folders': [],
      '/api/apps': [],
      '/api/services': [],
      '/api/models/import/plantuml/templates': { templates: plantUmlTemplates },
      '/api/models/model-1': modelDetail,
    };

    if (method === 'GET' && path in responses) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(responses[path]),
      });
    }

    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: `rota não mockada: ${method} ${path}` }),
    });
  });
}

test('sem sessão, mostra a tela de login', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  await expect(page.getByPlaceholder('Email')).toBeVisible();
  await expect(page.getByPlaceholder('Senha')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar com Google' })).toBeVisible();
  await expect(
    page.getByText('Modele arquitetura C4 viva em equipe', { exact: false })
  ).toBeVisible();
});

test('login com API mockada entra no workspace e mostra a sessão', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await mockApi(page);
  await page.goto('/');

  await page.getByPlaceholder('Email').fill('ana@example.com');
  await page.getByPlaceholder('Senha').fill('segredo');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  await expect(page.getByText('ana@example.com · Owner')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arquivos', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Catálogo', exact: true })).toBeVisible();
});

test('deep link abre o catálogo e a navegação atualiza o hash', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('c4arch_token', 'e2e-token');
  });
  await mockApi(page);

  await page.goto('/#/catalog');
  await expect(page.getByRole('heading', { name: 'Catálogo', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/catalog$/);

  await page.getByRole('button', { name: 'Arquivos', exact: true }).click();
  await expect(page).toHaveURL(/#\/files$/);
});

test('cria modelo novo a partir de um padrão PlantUML', async ({ page, context }) => {
  await context.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('c4arch_token', 'e2e-token');
  });
  await mockApi(context);

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Arquivos', exact: true })).toBeVisible();

  await page.getByTitle('Tipo de item a criar').selectOption('model');
  await page.getByRole('button', { name: '+ Novo modelo' }).click();

  await page.getByPlaceholder('Título do modelo').fill('Loja');
  await page.getByLabel('Padrão PlantUML do novo modelo').selectOption('containers');

  const popupPromise = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Criar', exact: true }).click();
  const editor = await popupPromise;
  await editor.waitForLoadState('domcontentloaded');

  await expect(editor).toHaveURL(/#\/models\/model-1$/);
  await expect(editor.getByRole('button', { name: 'Voltar' })).toBeVisible();
  // O painel PlantUML abre já na primeira visualização do modelo criado.
  await expect(editor.getByRole('heading', { name: 'PlantUML · Loja' })).toBeVisible();
  await expect(editor.getByLabel('Código PlantUML do modelo')).toHaveValue(/@startuml/);
});

test('lista abre o editor de código PlantUML do modelo', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('c4arch_token', 'e2e-token');
  });
  await mockApi(page, { models: [createdModel] });

  await page.goto('/#/files');
  await page.getByRole('button', { name: 'Editar código (PlantUML)' }).click();

  await expect(page.getByRole('heading', { name: 'PlantUML · Loja' })).toBeVisible();
  await expect(page.getByLabel('Código PlantUML do modelo')).toHaveValue(/@startuml/);
});

test('editor mantém apenas os botões essenciais no rodapé', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('c4arch_token', 'e2e-token');
  });
  await mockApi(page);

  await page.goto('/#/models/model-1');
  await expect(page.getByRole('button', { name: 'Voltar' })).toBeVisible();

  for (const name of ['PlantUML', 'Exportar', 'Auto layout', 'Editar modelo', 'Abrir draw.io', 'Versões', 'Inspeções', 'Excluir']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  for (const name of ['Abrir em nova aba', 'Desfazer', 'Refazer', 'Adicionar objetos (PlantUML)', 'Importar draw.io']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: /^Comentários/ })).toHaveCount(0);
});

test('aplicar PlantUML pela lista atualiza o estado colaborativo', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('c4arch_token', 'e2e-token');
  });

  const appliedElement = {
    id: 'el-1',
    model_id: 'model-1',
    type: 'system',
    title: 'Loja API',
    description: null,
    metadata: null,
    position_x: 12,
    position_y: 34,
    order: 0,
  };
  const modelDetail = { ...createdModel, elements: [appliedElement] };
  await mockApi(page, { models: [modelDetail], modelDetail });

  // Sem o push do snapshot, o editor reabriria com o desenho antigo e o
  // projetor poderia sobrescrever no Postgres o conteúdo recém-aplicado.
  const patches: Array<Record<string, unknown>> = [];
  await page.routeWebSocket(/ws:\/\/localhost:4001/, (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as {
        type?: string;
        modelId?: string;
        patch?: { op?: string; data?: unknown };
      };
      if (message.type === 'join') {
        ws.send(
          JSON.stringify({ type: 'state', modelId: message.modelId, model: { elements: [], edges: [] } })
        );
        return;
      }
      if (message.type === 'patch') {
        patches.push(message as Record<string, unknown>);
        ws.send(
          JSON.stringify({
            type: 'update',
            modelId: message.modelId,
            model: message.patch?.data ?? { elements: [], edges: [] },
          })
        );
      }
    });
  });

  await page.goto('/#/files');
  await page.getByRole('button', { name: 'Editar código (PlantUML)' }).click();
  const source = page.getByLabel('Código PlantUML do modelo');
  await expect(source).toHaveValue(/@startuml/);
  await source.fill('@startuml\ntitle Loja\nSystem(api, "Loja API")\n@enduml');
  await page.getByRole('button', { name: 'Aplicar no modelo' }).click();

  await expect(page.getByText(/Modelo atualizado/)).toBeVisible();
  await expect
    .poll(() => patches.some((patch) => (patch.patch as { op?: string } | undefined)?.op === 'replaceModel'))
    .toBe(true);
  const replace = patches.find(
    (patch) => (patch.patch as { op?: string } | undefined)?.op === 'replaceModel'
  );
  expect(JSON.stringify(replace)).toContain('Loja API');
});
