# contracts-vendored/ — cópia TEMPORÁRIA do contrato

> **Status: temporário.** O package `@whoo-internet-co/finance-platform-contracts`
> (GitHub Packages, ADR-008) está publicado com `access: restricted`, portanto
> `npm view @whoo-internet-co/finance-platform-contracts --registry=https://npm.pkg.github.com`
> retorna `401 Unauthorized` sem token de deploy.
>
> Para **não bloquear o desenvolvimento**, os artefatos oficiais foram copiados
> deste repositório (source of truth) para esta pasta e são usados como referência
> local de validação (producer contract test, ADR-008).

## Origem

Source of truth (antes do vendoring):

```text
finance-platform-contracts/
  events/transacao-autorizada/v1/
    schema.json        ← copiado
    example.json       ← copiado
    invalid-examples/  ← copiado (usados nos testes de contrato)
```

Commits de origem: branch `main` de `Whoo-Internet-co/finance-platform-contracts`
(revisão vigente na data da cópia).

## Como usar

- **Validação em runtime/relay:** `JsonSchemaEventValidator` lê
  `contracts-vendored/events/transacao-autorizada/v1/schema.json`
  (caminho configurável via `CONTRACTS_SCHEMA_PATH`).
- **Producer contract test:** `tests/contract/producer-contract.test.ts` valida
  eventos produzidos contra este schema e rejeita os exemplos inválidos.

## Migração para o package oficial

Quando o package for acessível (público ou via token de CI), substitua a pasta por:

```json
{
  "dependencies": {
    "@whoo-internet-co/finance-platform-contracts": "1.0.1"
  }
}
```

e aponte `CONTRACTS_SCHEMA_PATH` (ou o loader) para o artefato exportado
`@whoo-internet-co/finance-platform-contracts/events/transacao-autorizada/v1/schema`.

### Riscos conhecidos (ADR-008)

- **Contract drift:** cópia manual divergente da source of truth. Mitigação:
  CI deve falhar se o `sha256` do schema vendored divergir do publicado.
  *(O teste `tests/contract/producer-contract.test.ts` registra o fingerprint
  esperado; a verificação automática contra o package é adicionada quando o
  package estiver disponível sem autenticação.)*