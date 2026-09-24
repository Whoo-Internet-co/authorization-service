# authorization-service

Serviço de autorização de transações da plataforma financeira POD99 (desafio técnico AWS/Itaú). Reserva atômica de limite com idempotência (ADR-004), Outbox + DynamoDB Streams → relay (ADR-006) e validação producer contra o contrato oficial (ADR-008).

## Arquitetura

```mermaid
flowchart LR
  Client -->|POST /v1/contratos/{id}/autorizacoes| HTTP[NestJS HTTP]
  HTTP --> UC[AutorizarTransacaoUseCase]
  UC --> Domain[Domain: Contrato / Autorizacao / Evento]
  UC --> Ports[Ports]
  Ports --> DDB[(DynamoDB single-table)]
  DDB -->|Streams INSERT OUTBOX| Relay[Outbox Relay]
  Relay -->|EventBridge ou fan-out SQS local| Consumers[fraud / accounting / notification]
```

Camadas Clean/Hexagonal:

| Camada | Conteúdo | Dependências |
| --- | --- | --- |
| `domain/` | Contrato, Autorizacao, ValorMonetario, TipoOperacao, TransacaoAutorizada, DomainError | nenhuma (sem AWS/Nest) |
| `application/` | Use case, ports, RequestHash | domain |
| `adapters/` | HTTP NestJS, DynamoDB, EventBridge/SQS, Ajv, circuit breaker | application + AWS SDK |
| `relay/` | OutboxRelay + CheckpointStore | adapters outbound |

## Single-table DynamoDB

Tabela: `authorization-service` (env `DYNAMODB_TABLE`).

| Access pattern | PK / SK |
| --- | --- |
| Contrato | `CONTRACT#{id}` / `PROFILE#{id}` |
| Autorização | `CONTRACT#{id}` / `AUTH#{id_autorizacao}` (+ GSI `gsi-auth` em `gsi1_pk`) |
| Idempotência | `IDEMPOTENCY#{chave}` / igual · TTL em `ttl` |
| Outbox | `OUTBOX#{event_id}` / igual · Stream `NEW_IMAGE` |

Checkpoint do relay: tabela `authorization-service-checkpoint` (`PK=SHARD#…`, `SK=CHECKPOINT`).

## Mapping ADR → código

| ADR | Onde |
| --- | --- |
| ADR-001 Clean/Hexagonal | `domain/`, `application/ports/`, `adapters/` |
| ADR-003 Reserva atômica | `DynamoDbLimitRepository.applyAuthorization` (TransactWriteItems) |
| ADR-004 Idempotência | `RequestHash` + `DynamoDbIdempotencyRepository.acquire` |
| ADR-006 Outbox + relay | `buildOutboxItem` + `OutboxRelay` |
| ADR-008 Contratos | `@whoo-internet-co/finance-platform-contracts` + `JsonSchemaEventValidator` |

## API

- `POST /v1/contratos/{id_contrato}/autorizacoes` — header obrigatório `Idempotency-Key`
  - **201** aprovada · **200** replay · **402** limite · **409** conflito idempotência/concorrência · **422** validação · **503** circuit breaker
- `GET /health`
- Erros: RFC 7807 `application/problem+json`

## Desenvolvimento local

```bash
# Dependências (auth GitHub Packages em ~/.npmrc)
npm ci

# DynamoDB Local para testes de integração
docker compose -f docker-compose.test.yml up -d

# Qualidade
npm run lint && npm test && npm run build

# Stack completa (API + relay + LocalStack/SQS) — ver docker-compose.yml
docker compose up --build
```

## Variáveis de ambiente

Ver `.env.example`. Principais:

| Env | Default | Uso |
| --- | --- | --- |
| `PORT` | `3000` | HTTP |
| `ADAPTER_MODE` | `dynamodb` | `dynamodb` \| `in-memory` |
| `DYNAMODB_ENDPOINT` | vazio (prod) | Local: `http://localhost:8000` |
| `DYNAMODB_TABLE` | `authorization-service` | Single-table |
| `DYNAMODB_CHECKPOINT_TABLE` | `authorization-service-checkpoint` | Relay |
| `IDEMPOTENCY_TTL_SECONDS` | `86400` | TTL da chave |
| `CIRCUIT_BREAKER_FORCE_OPEN` | `false` | Kill-switch → 503 |
| `RELAY_PUBLISHER` | `local-sqs` | `eventbridge` \| `local-sqs` |
| `LOCAL_FANOUT_QUEUE_URLS` | — | Filas do fan-out local |

## Imagem

`ghcr.io/whoo-internet-co/authorization-service` (targets `api` e `relay`).
