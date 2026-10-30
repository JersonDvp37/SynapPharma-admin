alter table public.companies alter column expires_at set default (now() + interval '35 days');

drop policy if exists companies_owner_insert on public.companies;
drop policy if exists companies_owner_select on public.companies;
drop policy if exists companies_admin_email_insert on public.companies;
drop policy if exists companies_admin_email_select on public.companies;

create policy companies_admin_email_insert on public.companies for insert to authenticated
    with check (lower(admin_email) = lower(auth.jwt() ->> 'email') and status = 'ACTIVE' and expires_at >= now() and expires_at <= now() + interval '35 days' and activation_code_hash is not null and plan_type in ('BASIC', 'PREMIUM'));

create policy companies_admin_email_select on public.companies for select to authenticated
    using (lower(admin_email) = lower(auth.jwt() ->> 'email'));

drop policy if exists pharmacies_owner_select on public.pharmacies;
drop policy if exists pharmacies_owner_insert on public.pharmacies;
create policy pharmacies_admin_email_select on public.pharmacies for select to authenticated
    using (exists (select 1 from public.companies c where c.company_id = pharmacies.company_id and lower(c.admin_email) = lower(auth.jwt() ->> 'email')));
create policy pharmacies_admin_email_insert on public.pharmacies for insert to authenticated
    with check (exists (select 1 from public.companies c where c.company_id = pharmacies.company_id and lower(c.admin_email) = lower(auth.jwt() ->> 'email')));
