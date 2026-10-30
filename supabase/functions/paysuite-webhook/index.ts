import { createClient } from "npm:@supabase/supabase-js@2";

type PaysuitePayload = {
  reference?: unknown;
  status?: unknown;
  transaction_id?: unknown;
  amount?: unknown;
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
const webhookSecret = Deno.env.get("PAYSUITE_WEBHOOK_SECRET");
if (!supabaseUrl || !serviceRoleKey) throw new Error("Configuracao do Supabase incompleta.");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function amount(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function authorized(request: Request) {
  if (!webhookSecret) return false;
  const received = request.headers.get("x-paysuite-webhook-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return received === webhookSecret;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Metodo nao permitido." }, 405);
  if (!authorized(request)) return json({ error: "Webhook nao autorizado." }, 401);

  let payload: PaysuitePayload;
  try { payload = await request.json(); } catch { return json({ error: "JSON invalido." }, 400); }
  const companyId = text(payload.reference);
  const status = text(payload.status).toUpperCase();
  const transactionId = text(payload.transaction_id);
  const paymentAmount = amount(payload.amount);
  if (!companyId || !status || !transactionId || paymentAmount === null) {
    return json({ error: "reference, status, transaction_id e amount sao obrigatorios." }, 400);
  }

  const { data: inserted, error: insertError } = await supabase.from("payments_log").insert({
    company_id: companyId,
    reference: companyId,
    transaction_id: transactionId,
    status,
    amount: paymentAmount,
    raw_payload: payload,
  }).select("id, processed_at").maybeSingle();

  let paymentId = inserted?.id;
  let alreadyProcessed = Boolean(inserted?.processed_at);
  if (insertError) {
    if (insertError.code !== "23505") return json({ error: "Nao foi possivel registar o pagamento." }, 500);
    const { data: existing, error: existingError } = await supabase.from("payments_log")
      .select("id, processed_at").eq("transaction_id", transactionId).maybeSingle();
    if (existingError || !existing) return json({ error: "Transacao nao encontrada." }, 500);
    paymentId = existing.id;
    alreadyProcessed = Boolean(existing.processed_at);
  }
  if (alreadyProcessed) return json({ ok: true, duplicate: true, transaction_id: transactionId });
  if (status !== "SUCCESS" && status !== "PAID") return json({ ok: true, active: false, transaction_id: transactionId });

  const { data: currentCompany, error: currentCompanyError } = await supabase.from("companies")
    .select("company_id, expires_at").eq("company_id", companyId).maybeSingle();
  if (currentCompanyError || !currentCompany) return json({ error: "Empresa nao encontrada." }, 404);
  const currentExpiry = currentCompany.expires_at ? new Date(currentCompany.expires_at).getTime() : 0;
  const baseTime = Math.max(Date.now(), Number.isNaN(currentExpiry) ? 0 : currentExpiry);
  const expiresAt = new Date(baseTime + 35 * 24 * 60 * 60 * 1000).toISOString();
  const { data: company, error: companyError } = await supabase.from("companies")
    .update({ expires_at: expiresAt, status: "ACTIVE" })
    .eq("company_id", companyId).select("company_id").maybeSingle();
  if (companyError || !company) return json({ error: "Empresa nao encontrada." }, 404);

  const { error: processedError } = await supabase.from("payments_log")
    .update({ processed_at: new Date().toISOString() }).eq("id", paymentId);
  if (processedError) return json({ error: "Pagamento pendente de reconciliacao." }, 500);
  return json({ ok: true, active: true, company_id: companyId, expires_at: expiresAt });
});
