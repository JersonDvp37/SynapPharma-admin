-- Reconciliacao para projetos onde a migration do contrato ainda nao foi
-- refletida no schema cache do PostgREST.

create extension if not exists pgcrypto;

create table if not exists public.cloud_estoque (
  id uuid primary key default gen_random_uuid(),
  local_user_id integer not null,
  company_id text not null,
  pharmacy_id text not null,
  nome text,
  username text,
  role text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.cloud_estoque add column if not exists local_user_id integer;
alter table public.cloud_estoque add column if not exists company_id text;
alter table public.cloud_estoque add column if not exists pharmacy_id text;
alter table public.cloud_estoque add column if not exists nome text;
alter table public.cloud_estoque add column if not exists username text;
alter table public.cloud_estoque add column if not exists role text;
alter table public.cloud_estoque add column if not exists ativo boolean default true;
alter table public.cloud_estoque add column if not exists created_at timestamptz default now();

create unique index if not exists cloud_estoque_tenant_user_uq
  on public.cloud_estoque (company_id, pharmacy_id, local_user_id);

create table if not exists public.cloud_usuarios (
  id uuid primary key default gen_random_uuid(),
  local_user_id integer not null,
  company_id text not null,
  pharmacy_id text not null,
  nome text,
  username text,
  role text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.cloud_usuarios add column if not exists local_user_id integer;
alter table public.cloud_usuarios add column if not exists company_id text;
alter table public.cloud_usuarios add column if not exists pharmacy_id text;
alter table public.cloud_usuarios add column if not exists nome text;
alter table public.cloud_usuarios add column if not exists username text;
alter table public.cloud_usuarios add column if not exists role text;
alter table public.cloud_usuarios add column if not exists ativo boolean default true;
alter table public.cloud_usuarios add column if not exists created_at timestamptz default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'cloud_usuarios'
      and column_name = 'local_usuario_id'
  ) then
    update public.cloud_usuarios
       set local_user_id = local_usuario_id
     where local_user_id is null;
  end if;
end $$;

create unique index if not exists cloud_usuarios_tenant_user_uq
  on public.cloud_usuarios (company_id, pharmacy_id, local_user_id);

-- payments_log ja existe no projeto e o contrato oficial e:
-- id, company_id, transaction_id, amount, status, gateway, created_at.
-- Nao sao adicionadas colunas legadas como reference ou raw_payload.

notify pgrst, 'reload schema';
