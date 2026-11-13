import { test, expect, type Page } from '@playwright/test';

const user = { id: 'user-1', email: 'ana@example.com', name: 'Ana' };
const org = { id: 'org-1', name: 'Arquitetura', slug: 'arquitetura', role: 'owner' };
const createdModel = {
  id: 'model-1',
  org_id: org.id,
  folder_id: null,
  parent_id: null,
  title: 'Loja',
  description: 'Modelo criado a partir de um padrão Structurizr',
  status: 'draft',
  c4_type: 'container',
  c4_scope: null,
  drawio_xml: null,
  elements: [],
  edges: [],
  created_at: '2026-01-02T03:04:05.000Z',
  updated_at: '2026-01-02T03:04:05.000Z',
};

const structurizrTemplates = [
  {
    id: 'containers',
    name: 'Sistema e containers',
    description: 'Aplicação web, API e banco de dados.',
    c4Type: 'container',
    format: 'dsl',
    content: 'workspace "Sistema e containers" {\n  model {\n  }\n}',
  },
];

/**
 * Mock da API usado pelos testes. Responde o suficiente para o bootstrap da
 * sessão (auth/me + catálogo vazio) e para o POST de login.
 */
async function mockApi(target: Page | import('@playwright/test').BrowserContext): Promise<void> {
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

    if (method === 'POST' && path === '/api/models/import/structurizr') {
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

    const responses: Record<string, unknown> = {
      '/api/auth/me': { user, org },
      '/api/models': [],
      '/api/folders': [],
      '/api/apps': [],
      '/api/services': [],
      '/api/models/import/structurizr/templates': { templates: structurizrTemplates },
      '/api/models/model-1': createdModel,
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

test('cria modelo novo a partir de um padrão Structurizr', async ({ page, context }) => {
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
  await page.getByLabel('Padrão Structurizr do novo modelo').selectOption('containers');

  const popupPromise = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Criar', exact: true }).click();
  const editor = await popupPromise;
  await editor.waitForLoadState('domcontentloaded');

  await expect(editor).toHaveURL(/#\/models\/model-1$/);
  await expect(editor.getByRole('button', { name: 'Voltar' })).toBeVisible();
});
