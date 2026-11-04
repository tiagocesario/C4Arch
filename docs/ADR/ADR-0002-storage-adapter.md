# ADR-0002 — Storage local JSON vs Google Drive/GitLab

- **Status:** Rejeitada (espera da fase MVP)
- **Contexto:** O modelo precisa ser exportado e sincronizado com sistemas externos (Drive/GitLab). A documentação original propunha `ModelStorage` com adaptadores separados.
- **Decisão:** No MVP os arquivos do modelo são persistidos localmente como JSON no volume `/app/storage` (nomeado no Docker Compose). O driver de nuvem não está implementado.
- **Consequências:** + execução imediata e simples; - não há backup off-site nem compartilhamento de modelo como fonte. O backend não possui `STORAGE_DRIVER`. A adição de Drive/GitLab será uma nova ADR futura, interessante depois que o fluxo de edição estiver estável.
