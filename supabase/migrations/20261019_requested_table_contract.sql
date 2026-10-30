-- Contrato oficial consumido pelo Synap Pharma Desktop e pelo Dashboard Admin.
-- Esta migration e idempotente e pode ser aplicada sobre um projeto existente.

create extension if not exists pgcrypto;

create table if not exists public.pharmacies (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  pharmacy_id text not null,
  nome_farmacia text,
  nome_filial text,
  plano text,
  data_expiracao text,
  licenca_ativa boolean not null default true,
  created_at timestamptz not null default now(),
  localizacao text
);

alter table public.pharmacies add column if not exists company_id text;
alter table public.pharmacies add column if not exists pharmacy_id text;
alter table public.pharmacies add column if not exists nome_farmacia text;
alter table public.pharmacies add column if not exists nome_filial text;
alter table public.pharmacies add column if not exists plano text;
alter table public.pharmacies add column if not exists data_expiracao text;
alter table public.pharmacies add column if not exists licenca_ativa boolean;
alter table public.pharmacies add column if not exists created_at timestamptz default now();
alter table public.pharmacies add column if not exists localizacao text;

create table if not exists public.cloud_vendas (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  pharmacy_id text not null,
  total_mzn numeric not null default 0,
  forma_pagamento text,
  data_venda timestamptz,
  payload_itens jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  local_venda_id integer not null
);

alter table public.cloud_vendas add column if not exists company_id text;
alter table public.cloud_vendas add column if not exists pharmacy_id text;
alter table public.cloud_vendas add column if not exists total_mzn numeric;
alter table public.cloud_vendas add column if not exists forma_pagamento text;
alter table public.cloud_vendas add column if not exists data_venda timestamptz;
alter table public.cloud_vendas add column if not exists payload_itens jsonb;
alter table public.cloud_vendas add column if not exists created_at timestamptz default now();
alter table public.cloud_vendas add column if not exists local_venda_id integer;

create table if not exists public.cloud_estoque_movimentos (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  pharmacy_id text not null,
  local_movimento_id integer not null,
  local_produto_id integer,
  codigo_barras text,
  tipo_movimento text not null,
  quantidade integer not null,
  lote text,
  data_validade text,
  motivo text,
  usuario_id integer,
  data_hora timestamptz,
  created_at timestamptz not null default now()
);

alter table public.cloud_estoque_movimentos add column if not exists company_id text;
alter table public.cloud_estoque_movimentos add column if not exists pharmacy_id text;
alter table public.cloud_estoque_movimentos add column if not exists local_movimento_id integer;
alter table public.cloud_estoque_movimentos add column if not exists local_produto_id integer;
alter table public.cloud_estoque_movimentos add column if not exists codigo_barras text;
alter table public.cloud_estoque_movimentos add column if not exists tipo_movimento text;
alter table public.cloud_estoque_movimentos add column if not exists quantidade integer;
alter table public.cloud_estoque_movimentos add column if not exists lote text;
alter table public.cloud_estoque_movimentos add column if not exists data_validade text;
alter table public.cloud_estoque_movimentos add column if not exists motivo text;
alter table public.cloud_estoque_movimentos add column if not exists usuario_id integer;
alter table public.cloud_estoque_movimentos add column if not exists data_hora timestamptz;
alter table public.cloud_estoque_movimentos add column if not exists created_at timestamptz default now();

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
alter table public.cloud_estoque add column if not exists ativo boolean;
alter table public.cloud_estoque add column if not exists created_at timestamptz default now();

create table if not exists public.system_messages (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  sender_type varchar,
  sender_pharmacy_id text,
  recipient_pharmacy_id text,
  subject varchar,
  body text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.system_messages add column if not exists company_id text;
alter table public.system_messages add column if not exists sender_type varchar;
alter table public.system_messages add column if not exists sender_pharmacy_id text;
alter table public.system_messages add column if not exists recipient_pharmacy_id text;
alter table public.system_messages add column if not exists subject varchar;
alter table public.system_messages add column if not exists body text;
alter table public.system_messages add column if not exists is_read boolean default false;
alter table public.system_messages add column if not exists created_at timestamptz default now();

create unique index if not exists cloud_vendas_tenant_local_uq
  on public.cloud_vendas (company_id, pharmacy_id, local_venda_id);

create unique index if not exists cloud_movimentos_tenant_local_uq
  on public.cloud_estoque_movimentos (company_id, pharmacy_id, local_movimento_id);

create unique index if not exists cloud_estoque_tenant_user_uq
  on public.cloud_estoque (company_id, pharmacy_id, local_user_id);

create index if not exists system_messages_recipient_idx
  on public.system_messages (company_id, recipient_pharmacy_id, created_at desc);
