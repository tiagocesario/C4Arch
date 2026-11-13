# C4Arch MCP

Servidor [Model Context Protocol](https://modelcontextprotocol.io) que expõe o
C4Arch para agentes de IA. Fala JSON-RPC 2.0 por **stdio** (uma mensagem JSON
por linha) e delega tudo para a API HTTP, preservando autenticação, permissões,
auditoria, DAS e exportadores.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `C4ARCH_API_URL` | `http://localhost:4000` | URL base da API |
| `C4ARCH_TOKEN` | — | JWT usado nas chamadas (`Authorization: Bearer`) |

```json
{
  "mcpServers": {
    "c4arch": {
      "command": "node",
      "args": ["C:/caminho/c4arch/apps/mcp/dist/index.js"],
      "env": {
        "C4ARCH_API_URL": "http://localhost:4000",
        "C4ARCH_TOKEN": "<jwt>"
      }
    }
  }
}
```

Build: `npm run build --workspace=apps/mcp`.

## Ferramentas

| Ferramenta | Ação |
|---|---|
| `c4_list_models` | Lista modelos visíveis |
| `c4_get_model` | Modelo com elementos e relações |
| `c4_create_model` | Cria modelo em uma organização |
| `c4_update_model` | Atualiza título, descrição, status ou tipo C4 |
| `c4_get_das` | DAS em Markdown |
| `c4_inspect_model` | Inspections de arquitetura |
| `c4_list_views` | Views canônicas/derivadas |
| `c4_auto_layout` | Recalcula layout de uma view (`LR`/`TB`) |
| `c4_export_model` | Exporta em Structurizr, PlantUML, Mermaid, SVG, PNG, HTML ou draw.io |
| `c4_import_structurizr` | Importa workspace JSON/DSL criando um modelo |
| `c4_list_comments` | Lista comentários |
| `c4_create_comment` | Cria comentário geral ou por elemento |

Respostas binárias (PNG) são devolvidas em base64 no campo `text`.
