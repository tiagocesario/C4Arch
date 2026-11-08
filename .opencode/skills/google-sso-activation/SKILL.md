---
name: Google SSO Activation
description: Use para ativar e configurar o login com Google (OAuth 2.0/OIDC) no C4Arch, incluindo credenciais, variáveis de ambiente, domínios autorizados e perfil de acesso.
---

# Google SSO Activation

Skill para ativar o login com Google no C4Arch usando OAuth 2.0/OIDC, com filtro por domínio de e-mail e vínculo automático a uma organização.

## Quando usar

- Configurar login com Google em ambiente local ou produção.
- Registrar credenciais OAuth no Google Cloud Console.
- Habilitar domínios de e-mail autorizados e perfis de acesso.
- Diagnosticar falhas no fluxo SSO.

## Pré-requisitos

- Projeto C4Arch em execução (API, web e banco).
- Acesso de `owner` à organização que receberá os usuários SSO.
- Conta no Google Cloud Console com permissão para criar credenciais OAuth.

## Passos

1. **Criar credenciais OAuth no Google Cloud Console.**
   - Crie um projeto (ou use um existente).
   - Configure a tela de consentimento OAuth.
   - Crie uma credencial do tipo **OAuth client ID** (aplicação Web).
   - Adicione a URI de redirecionamento autorizada:
     - Desenvolvimento: `http://localhost:4000/api/auth/google/callback`
     - Produção: `https://<dominio>/api/auth/google/callback`

2. **Configurar variáveis de ambiente.**
   - No `.env` (raiz, usado pelo Docker) ou `apps/api/.env` (execução local):
     ```env
     GOOGLE_CLIENT_ID=<client-id>
     GOOGLE_CLIENT_SECRET=<client-secret>
     GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/google/callback
     FRONTEND_URL=http://localhost:3000
     ```
   - Em produção, use HTTPS e domínios públicos.

3. **Reiniciar a API.**
   - Local: reinicie `npm run dev --workspace=apps/api`.
   - Docker: `docker compose up -d --build api`.

4. **Cadastrar domínios autorizados.**
   - Faça login como `owner`.
   - Acesse **Domínios SSO** no menu.
   - Adicione o domínio (ex.: `empresa.com`) e o perfil desejado:
     - `viewer` (padrão, somente leitura)
     - `editor`
     - `owner`
   - Apenas domínios cadastrados e habilitados podem autenticar.

5. **Testar o login.**
   - Na tela de login, clique em **Entrar com Google**.
   - Selecione uma conta do domínio autorizado.
   - O usuário será criado/reutilizado e vinculado à organização com o perfil configurado.

## Boas práticas

- Nunca exponha `GOOGLE_CLIENT_SECRET` no frontend ou em repositório.
- Use HTTPS em produção para `GOOGLE_CALLBACK_URL` e `FRONTEND_URL`.
- Restrinja o login apenas aos domínios necessários.
- Prefira `viewer` como perfil padrão; eleve para `editor`/`owner` apenas quando necessário.
- Revogue domínios desativados em vez de excluí-los, quando o histórico for relevante.
- Monitore logs da API para falhas de OAuth (`[auth] google callback error`).

## Diagnóstico rápido

- `503 Login com Google não configurado`: faltam `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.
- `403 Domínio de email não autorizado`: domínio não cadastrado ou desabilitado.
- `400 Estado OAuth inválido ou expirado`: state expirado (10 min) ou callback reutilizado.
- `401 Falha ao autenticar com Google`: código inválido ou credenciais incorretas.

## Referências

- `apps/api/src/routes/auth.routes.ts`
- `apps/api/src/config.ts`
- `apps/web/src/App.tsx`
- `docs/SECURITY.md`