alter table public.companies add column if not exists activation_code_plain text;
alter table public.companies alter column expires_at set default (now() + interval '35 days');

drop policy if exists companies_owner_insert on public.companies;
create policy companies_owner_insert on public.companies for insert to authenticated
    with check (owner_id = auth.uid() and status = 'ACTIVE' and expires_at is not null and expires_at >= now() and expires_at <= now() + interval '35 days' and activation_code_hash is not null and plan_type in ('BASIC', 'PREMIUM'));

create table if not exists public.pharmacies (
    id uuid primary key default gen_random_uuid(),
    company_id text references public.companies(company_id) on delete cascade,
    pharmacy_name text not null,
    location text,
    created_at timestamptz default now()
);

alter table public.pharmacies enable row level security;
drop policy if exists pharmacies_owner_select on public.pharmacies;
drop policy if exists pharmacies_owner_insert on public.pharmacies;
create policy pharmacies_owner_select on public.pharmacies for select to authenticated using (exists (select 1 from public.companies c where c.company_id = pharmacies.company_id and c.owner_id = auth.uid()));
create policy pharmacies_owner_insert on public.pharmacies for insert to authenticated with check (exists (select 1 from public.companies c where c.company_id = pharmacies.company_id and c.owner_id = auth.uid()));

alter table public.payments_log add column if not exists gateway text not null default 'PAYSUITE';
