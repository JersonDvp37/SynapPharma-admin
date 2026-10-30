-- From this migration onward, a branch is registered by the desktop activation
-- endpoint. The authenticated web client is read-only for pharmacies.

alter table public.pharmacies
    add column if not exists nome_farmacia text not null default '',
    add column if not exists nome_filial text not null default '',
    add column if not exists licenca_ativa integer not null default 0
        check (licenca_ativa in (0, 1));

update public.pharmacies p
set nome_farmacia = coalesce(nullif(p.nome_farmacia, ''), c.name),
    nome_filial = coalesce(nullif(p.nome_filial, ''), p.pharmacy_name),
    licenca_ativa = case
        when c.status = 'ACTIVE' and c.expires_at is not null and c.expires_at > now() then 1
        else 0
    end
from public.companies c
where c.company_id = p.company_id;

drop trigger if exists companies_create_default_pharmacy on public.companies;
drop function if exists public.create_default_pharmacy_for_company();

drop policy if exists pharmacies_owner_insert on public.pharmacies;
drop policy if exists pharmacies_admin_email_insert on public.pharmacies;
drop policy if exists companies_owner_insert on public.companies;
drop policy if exists companies_admin_email_insert on public.companies;
