/**
 * Erro transitório de infraestrutura (throttling/timeout) — mapeado para
 * 503 (indisponível) na borda HTTP. Não é um erro de negócio.
 */
export class ServicoIndisponivelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServicoIndisponivelError';
  }
}