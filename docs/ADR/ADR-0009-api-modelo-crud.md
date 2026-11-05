# ADR-0009 — API do modelo: update de título/status e associação a pasta

- **Status:** Adotada
- **Contexto:** Ao criar o modelo, o frontend não conseguia associar o modelo a uma pasta (`folderId` era ignorado no `POST /api/models`). Ao editar o nome do modelo, a rota `PUT /api/models/:id` não existia, retornando 404. O modelo não era excluído nem vinculado consistentemente.
- **Decisão:** Adicionar `router.put('/:id', verifyToken, ModelController.update)` no `routes/models.routes.ts` para atualizar `title` e `status`. No `create`, aceitar `folderId` no body, validar que a pasta pertence à organização e gravar o `folder_id` no modelo no Postgres.
- **Consequências:**
  - `+` O modelo agora tem update/rename funcional e é associável a pastas.
  - `+` `DELETE /api/models/:id` retorna carga útil previsível (`{ok:true}` ou 404).
  - `-` Validação adicional de pertencimento à pasta.
- **Data:** 03/11/2026 — time C4Arch
