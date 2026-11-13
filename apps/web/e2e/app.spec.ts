import { test, expect, type Page } from '@playwright/test';

const user = { id: 'user-1', email: 'ana@example.com', name: 'Ana' };
const org = { id: 'org-1', name: 'Arquitetura', slug: 'arquitetura', role: 'owner' };

/**
 * Mock da API usado pelos testes. Responde o suficiente para o bootstrap da
 * sessão (auth/me + catálogo vazio) e para o POST de login.
 */
async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
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

    const responses: Record<string, unknown> = {
      '/api/auth/me': { user, org },
      '/api/models': [],
      '/api/folders': [],
      '/api/apps': [],
      '/api/services': [],
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
