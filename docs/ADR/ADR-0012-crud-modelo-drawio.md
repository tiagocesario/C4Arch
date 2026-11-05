# ADR-0012 — CRUD de modelo e acesso ao draw.io

- **Status:** Adotada
- **Contexto:** A criação de modelo aceitava `folderId`, mas ignorava
  `description`. A edição atualizava somente `title` e `status`, não permitia
  alterar descrição nem mover o modelo de pasta, e não validava se a pasta
  pertencia à organização. O frontend até possuía `openDrawioEditor`, mas ele
  não era usado; não havia acesso ao draw.io após criar um modelo nem no
  rodapé do editor. A lista de modelos também não era carregada no boot/login.
- **Decisão:**
  1. `POST /api/models` aceita e grava `description`, valida `status` como
     `draft`/`final`, valida `folderId` contra a organização e exige
     membership do usuário.
  2. `PUT /api/models/:id` faz atualização parcial dinâmica de `title`,
     `description`, `status` e `folderId`, permitindo limpar descrição/pasta,
     e valida a pasta contra a organização do modelo.
  3. `GET` e `DELETE` de modelo verificam membership da organização.
  4. O frontend carrega modelos em `/api/auth/me` + `listModels` no boot e
     após o login.
  5. O modal de criação ganha descrição e a opção **Abrir draw.io após
     criar**; a aba é aberta antes do `await` para evitar bloqueio de popup.
  6. A lista e o editor ganham **Editar modelo** (título, descrição, status e
     pasta) e **Abrir draw.io**.
  7. O HTML do editor draw.io escapa título e atributos, removendo XSS.
- **Consequências:**
  - `+` Modelos podem ser criados e editados por completo pela UI.
  - `+` O draw.io fica acessível no momento da criação e durante a edição.
  - `+` Pastas inválidas ou de outra organização são rejeitadas.
  - `-` O token do draw.io ainda trafega na query string; a migração para
    cookie `httpOnly` ou URL assinada de curta duração permanece pendente.
- **Data:** 04/11/2026 — time C4Arch
