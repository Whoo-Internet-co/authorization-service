import { TransacaoAutorizada } from '../../../src/domain/events/TransacaoAutorizada';

describe('TransacaoAutorizada', () => {
  it('serializa payload flat compatível com o schema oficial', () => {
    const event = new TransacaoAutorizada({
      eventId: '550e8400-e29b-41d4-a716-446655440000',
      occurredAt: new Date('2026-09-23T20:00:00.000Z'),
      idAutorizacao: 'AUT-001',
      idContrato: 'CTR-001',
      valor: 100,
      saldoReservado: 900,
      correlationId: 'CORR-001',
      traceId: null,
    });
    expect(event.toJson()).toMatchObject({
      event_type: 'TransacaoAutorizada',
      event_version: '1.0',
      event_id: '550e8400-e29b-41d4-a716-446655440000',
      valor: 100,
      saldo_reservado: 900,
      trace_id: null,
    });
  });

  it('reconstrói a partir de item da outbox e expõe getters', () => {
    const json = {
      event_id: 'e1',
      occurred_at: '2026-09-23T20:00:00.000Z',
      id_autorizacao: 'a1',
      id_contrato: 'c1',
      valor: 50,
      saldo_reservado: 950,
      correlation_id: 'corr',
      trace_id: 'trace-1',
    };
    const event = TransacaoAutorizada.fromOutboxItem(json);
    expect(event.eventId).toBe('e1');
    expect(event.occurredAt.toISOString()).toBe('2026-09-23T20:00:00.000Z');
    expect(event.idAutorizacao).toBe('a1');
    expect(event.idContrato).toBe('c1');
    expect(event.saldoReservado).toBe(950);
    expect(event.props.traceId).toBe('trace-1');
    expect(TransacaoAutorizada.fromOutboxItem({ ...json, trace_id: null }).props.traceId).toBeNull();
  });
});
