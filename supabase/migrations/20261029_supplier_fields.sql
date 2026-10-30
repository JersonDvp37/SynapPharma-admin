alter table public.cloud_produtos add column if not exists importadora_fornecedor text not null default '';
alter table public.cloud_produtos add column if not exists contacto_fornecedor text not null default '';
