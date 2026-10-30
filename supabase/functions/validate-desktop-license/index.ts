import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");

function serviceRoleKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>;
    return keys.service_role ?? keys.secret ?? Object.values(keys)[0];
  } catch {
    return undefined;
  }
}

const secret = serviceRoleKey();
if (!supabaseUrl || !secret) throw new Error("Configuracao do Supabase incompleta.");

const supabase = createClient(supabaseUrl, secret, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type ActivationPayload = {
  activation_key?: unknown;
  pharmacy_id?: unknown;
  nome_farmacia?: unknown;
  nome_filial?: unknown;
};

type Company = {
  company_id: string;
  name: string;
  plan_type: string;
  status: string;
  expires_at: string | null;
};

type Pharmacy = {
  id: string;
  company_id: string;
  nome_farmacia: string;
  nome_filial: string;
  licenca_ativa: boolean;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sha256Hex(value: string) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
}

function isActivationKey(value: string) {
  return value.length <= 256 && /^SYNAP-[A-Za-z0-9]+-[A-Za-z0-9]+$/.test(value);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function invalid(reason: string, status?: string, expiresAt?: string | null) {
  return json({
    valid: false,
    reason,
    ...(status ? { status } : {}),
    ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ valid: false, reason: "METHOD_NOT_ALLOWED" }, 405);

  let payload: ActivationPayload;
  try {
    payload = await request.json() as ActivationPayload;
  } catch {
    return json({ valid: false, reason: "INVALID_JSON" }, 400);
  }

  const activationKey = String(payload.activation_key ?? "").trim();
  const requestedPharmacyId = String(payload.pharmacy_id ?? "").trim();
  const pharmacyName = String(payload.nome_farmacia ?? "").trim();
  const branchName = String(payload.nome_filial ?? "").trim();
  if (!isActivationKey(activationKey)) return invalid("INVALID_KEY");
  if (requestedPharmacyId && !isUuid(requestedPharmacyId)) return invalid("INVALID_PHARMACY_ID");
  if (!pharmacyName || !branchName) return invalid("PHARMACY_DATA_REQUIRED");

  const hash = await sha256Hex(activationKey);
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("company_id, name, plan_type, status, expires_at")
    .eq("activation_code_hash", hash)
    .maybeSingle<Company>();

  // Do not distinguish a missing key from other key lookup failures to the
  // caller. The service-role key never leaves this function.
  if (companyError || !company) return invalid("INVALID_KEY");

  if (company.status.toUpperCase() !== "ACTIVE") {
    return invalid("LICENSE_INACTIVE", company.status, company.expires_at);
  }

  const expiresAt = company.expires_at ? new Date(company.expires_at).getTime() : Number.NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return invalid("LICENSE_EXPIRED", company.status, company.expires_at);
  }

  const pharmacyId = requestedPharmacyId || crypto.randomUUID();
  const { data: existingPharmacy, error: existingPharmacyError } = await supabase
    .from("pharmacies")
    .select("id, company_id")
    .eq("id", pharmacyId)
    .maybeSingle<{ id: string; company_id: string }>();

  if (existingPharmacyError) return invalid("PHARMACY_REGISTRATION_FAILED");
  if (existingPharmacy && existingPharmacy.company_id !== company.company_id) {
    return invalid("PHARMACY_ID_CONFLICT");
  }

  const { data: pharmacy, error: pharmacyError } = await supabase
    .from("pharmacies")
    .upsert({
      id: pharmacyId,
      pharmacy_id: pharmacyId,
      company_id: company.company_id,
      nome_farmacia: pharmacyName,
      nome_filial: branchName,
      plano: company.plan_type,
      data_expiracao: company.expires_at,
      licenca_ativa: true,
    }, { onConflict: "id" })
    .select("id, pharmacy_id, company_id, nome_farmacia, nome_filial, plano, data_expiracao, licenca_ativa, created_at, localizacao")
    .single<Pharmacy>();

  if (pharmacyError || !pharmacy) return invalid("PHARMACY_REGISTRATION_FAILED");

  return json({
    valid: true,
    license: {
      company_id: company.company_id,
      pharmacy_id: pharmacy.id,
      nome_farmacia: pharmacy.nome_farmacia,
      nome_filial: pharmacy.nome_filial,
      company_name: company.name,
      plan: company.plan_type,
      expires_at: company.expires_at,
      licenca_ativa: pharmacy.licenca_ativa,
    },
  });
});
