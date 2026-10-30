import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL");
function serverKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>;
    return keys.service_role ?? keys.secret ?? Object.values(keys)[0];
  } catch {
    return undefined;
  }
}
const serviceRoleKey = serverKey();
const paysuiteUrl = Deno.env.get("PAYSUITE_CREATE_URL");
const paysuiteKey = Deno.env.get("PAYSUITE_API_KEY");
if (!supabaseUrl || !serviceRoleKey) throw new Error("Configuracao do Supabase incompleta.");
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function normalizePhone(phone: unknown) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (/^8\d{8}$/.test(digits)) return `258${digits}`;
  if (/^2588\d{8}$/.test(digits)) return digits;
  return null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Metodo nao permitido." }, 405);
  if (!paysuiteUrl || !paysuiteKey) return response({ error: "PaySuite nao configurado." }, 503);
  let body: { company_id?: unknown; phone?: unknown; provider?: unknown };
  try { body = await request.json(); } catch { return response({ error: "JSON invalido." }, 400); }

  const companyId = String(body.company_id ?? "").trim();
  const provider = String(body.provider ?? "").trim().toUpperCase();
  const phone = normalizePhone(body.phone);
  if (!companyId || !phone || !["M-PESA", "E-MOLA"].includes(provider)) {
    return response({ error: "Empresa, telefone e carteira movel sao obrigatorios." }, 400);
  }
  const { data: company, error: companyError } = await supabase.from("companies")
    .select("company_id, name, plan_type").eq("company_id", companyId).maybeSingle();
  if (companyError || !company) return response({ error: "Empresa nao encontrada." }, 404);

  const amountVariable = company.plan_type === "PREMIUM" ? "PAYSUITE_PREMIUM_AMOUNT" : "PAYSUITE_BASIC_AMOUNT";
  const paymentAmount = Number(Deno.env.get(amountVariable));
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    return response({ error: `Configure ${amountVariable} no ambiente da funcao.` }, 503);
  }
  const upstream = await fetch(paysuiteUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${paysuiteKey}` },
    body: JSON.stringify({
      reference: companyId, amount: paymentAmount, currency: "MZN", phone, provider,
      callback_url: `${supabaseUrl}/functions/v1/paysuite-webhook`,
      metadata: { company_id: companyId, plan_type: company.plan_type },
    }),
  });
  if (!upstream.ok) return response({ error: "Nao foi possivel iniciar a cobranca no PaySuite." }, 502);
  return response({
    ok: true, status: "PENDING", reference: companyId, amount: paymentAmount, provider,
    message: "Pedido enviado. Confirme o PIN no seu telemovel para concluir o pagamento.",
  });
});