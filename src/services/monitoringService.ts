import { supabase } from "../lib/supabase";

export type Pharmacy = {
  id: string;
  company_id: string;
  pharmacy_id?: string | null;
  nome_farmacia?: string | null;
  nome_filial?: string | null;
  pharmacy_name?: string | null;
  licenca_ativa?: number | boolean | null;
  created_at?: string | null;
};

export type CloudRecord = Record<string, unknown>;

export type PharmacyCloudData = {
  produtos: CloudRecord[];
  vendas: CloudRecord[];
  produtosError: string | null;
  vendasError: string | null;
};

export async function listCompanyPharmacies(companyId: string) {
  const result = await supabase
    .from("pharmacies")
    .select("*")
    .eq("company_id", companyId);

  return {
    data: (result.data ?? []) as Pharmacy[],
    error: result.error?.message ?? null,
  };
}

export async function getPharmacyCloudData(companyId: string, pharmacyId: string): Promise<PharmacyCloudData> {
  const [produtosResult, vendasResult] = await Promise.all([
    supabase
      .from("cloud_produtos")
      .select("*")
      .eq("company_id", companyId)
      .eq("pharmacy_id", pharmacyId),
    supabase
      .from("cloud_vendas")
      .select("*")
      .eq("company_id", companyId)
      .eq("pharmacy_id", pharmacyId),
  ]);

  return {
    produtos: (produtosResult.data ?? []) as CloudRecord[],
    vendas: (vendasResult.data ?? []) as CloudRecord[],
    produtosError: produtosResult.error?.message ?? null,
    vendasError: vendasResult.error?.message ?? null,
  };
}
