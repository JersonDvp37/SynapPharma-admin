# Desktop sync invariants

The JavaFX module is not present in this workspace. Its SQLite repository
should enforce the tenant context at the repository boundary.

For both `produtos` and `vendas`, never trust tenant identifiers received from
the screen. Read them from the singleton local configuration row in the same
transaction used for the insert:

```sql
INSERT INTO produtos (..., company_id, pharmacy_id)
SELECT ..., company_id, pharmacy_id
FROM configuracao_local
WHERE id = 1 AND licenca_ativa = 1;
```

The object serialized into `sync_queue` must contain the same two values. The
sync worker should reject or hold rows with empty tenant context rather than
send them to `cloud_produtos` or `cloud_vendas`.

At startup, compare `data_expiracao` as an ISO-8601 instant with the current
UTC instant. If cloud validation succeeds, replace the singleton row with the
returned license. If cloud validation fails because the network is unavailable,
continue only while the local row is active and not expired. A cloud response
of `LICENSE_EXPIRED` or `LICENSE_INACTIVE` must block writes regardless of the
local cached date.
