# Contrato de ativacao do desktop

O desktop e o unico componente autorizado a registar filiais. A web apenas
consulta `companies` e `pharmacies`.

## Endpoint

`POST {SUPABASE_URL}/functions/v1/validate-desktop-license`

Header: `Content-Type: application/json`.

Request inicial:

```json
{
  "activation_key": "SYNAP-XXXX-YYYY",
  "pharmacy_id": "UUID gerado pelo desktop",
  "nome_farmacia": "Farmacia Central",
  "nome_filial": "Filial Matola"
}
```

O endpoint valida o hash da chave, confirma empresa ativa e expirada, e faz
um upsert idempotente em `pharmacies`. Em revalidacoes, envie o mesmo
`pharmacy_id` para atualizar a filial existente sem duplicar registos.

Sucesso:

```json
{
  "valid": true,
  "license": {
    "company_id": "...",
    "pharmacy_id": "...",
    "nome_farmacia": "Farmacia Central",
    "nome_filial": "Filial Matola",
    "plan": "BASIC",
    "expires_at": "2026-11-18T00:00:00+00:00",
    "licenca_ativa": 1
  }
}
```

O desktop deve gravar o resultado valido na linha `id = 1` da base SQLite:

```sql
CREATE TABLE IF NOT EXISTS configuracao_local (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    company_id TEXT NOT NULL DEFAULT '',
    pharmacy_id TEXT NOT NULL DEFAULT '',
    nome_farmacia TEXT NOT NULL DEFAULT '',
    nome_filial TEXT NOT NULL DEFAULT '',
    data_expiracao TEXT,
    plano TEXT NOT NULL DEFAULT 'BASIC',
    licenca_ativa INTEGER NOT NULL DEFAULT 0 CHECK (licenca_ativa IN (0, 1)),
    ultimo_relatorio_em TEXT
);
```

Codigos de falha: `INVALID_KEY`, `LICENSE_INACTIVE`, `LICENSE_EXPIRED`,
`INVALID_PHARMACY_ID`, `PHARMACY_DATA_REQUIRED`, `PHARMACY_ID_CONFLICT` e
`PHARMACY_REGISTRATION_FAILED`.

O hash e a chave `service_role` nunca devem ser enviados pelo desktop. Em
falha de rede, o desktop pode continuar apenas se a licenca local estiver
ativa e `data_expiracao` ainda nao tiver passado.
