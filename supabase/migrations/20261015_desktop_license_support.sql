-- Contract used by the JavaFX desktop activation flow.
-- Branches are created by the desktop activation endpoint, never by the web.

create index if not exists pharmacies_company_created_idx
    on public.pharmacies(company_id, created_at);
