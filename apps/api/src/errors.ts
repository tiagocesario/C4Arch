/**
 * Erros padronizados da API (Onda 3, item 15).
 *
 * O contrato mantém `error` (mensagem legível, compatível com o frontend) e
 * acrescenta `code`/`details` para clientes gerados e automações.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorBody(code: string, message: string, details?: unknown) {
  return details === undefined ? { error: message, code } : { error: message, code, details };
}
