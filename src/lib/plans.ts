type Row = Record<string, unknown>;
export type PlanCode = "BASIC" | "INTERMEDIATE" | "PREMIUM";
export type PlanLimit = number | null | undefined;

export const PLAN_DEFAULT_LIMITS: Record<PlanCode, { pharmacies: number | null; users: number | null }> = {
  BASIC: { pharmacies: 1, users: 3 },
  INTERMEDIATE: { pharmacies: 5, users: 8 },
  PREMIUM: { pharmacies: null, users: null },
};

export function normalizeToken(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizePlanCode(value: unknown) {
  const code = normalizeToken(value).replace(/^PLANO/, "");
  if (["BASIC", "BASICO"].includes(code)) return "BASIC";
  if (["INTERMEDIATE", "INTERMEDIO", "INTERMEDIARIO", "STANDARD"].includes(code)) return "INTERMEDIATE";
  if (["PREMIUM", "PRO"].includes(code)) return "PREMIUM";
  return code;
}

export function planName(code: string) {
  return ({ BASIC: "Básico", INTERMEDIATE: "Intermédio", PREMIUM: "Premium" } as Record<string, string>)[code] ?? (code || "Não configurado");
}

function codeOf(row: Row | undefined) {
  for (const key of ["plan_type", "code", "plano", "slug", "name"]) {
    if (row?.[key] !== undefined && row[key] !== null && String(row[key]).trim()) return normalizePlanCode(row[key]);
  }
  return "";
}

function cloudLimit(plan: Row | undefined, keys: string[]): PlanLimit {
  for (const key of keys) {
    const raw = plan?.[key];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    if (["ILIMITADO", "ILIMITADOS", "UNLIMITED", "INFINITY"].includes(normalizeToken(raw))) return null;
    const value = Number(raw);
    // The desktop uses non-positive/missing values as defaults and MAX_INT as unlimited.
    if (!Number.isFinite(value) || value <= 0) continue;
    return value >= 2147483647 ? null : Math.floor(value);
  }
  return undefined;
}

export function resolvePlan(company: Row | null | undefined, plans: Row[]) {
  const requested = normalizePlanCode([company?.plan_type, company?.plano, company?.plan_code].find((value) => value !== undefined && value !== null && String(value).trim()));
  const byCode = requested ? plans.find((row) => [row.plan_type, row.code, row.plano, row.slug, row.name].some((value) => normalizePlanCode(value) === requested)) : undefined;
  const byId = company?.plan_id ? plans.find((row) => String(row.id) === String(company.plan_id)) : undefined;
  const plan = byCode ?? (!requested ? byId : undefined);
  const code = requested || codeOf(plan);
  const defaults = PLAN_DEFAULT_LIMITS[code as PlanCode];
  const pharmacies = cloudLimit(plan, ["max_pharmacies", "max_branches", "pharmacies_limit"]);
  const users = cloudLimit(plan, ["max_users", "users_limit"]);
  return {
    code,
    name: planName(code),
    pharmacies: pharmacies === undefined ? defaults?.pharmacies : pharmacies,
    users: users === undefined ? defaults?.users : users,
  };
}

export function limitText(limit: PlanLimit) {
  return limit === null ? "Ilimitado" : limit === undefined ? "Não configurado" : limit.toLocaleString("pt-MZ");
}

export function limitValue(limit: PlanLimit) {
  return limit === null ? "∞" : limit === undefined ? "—" : limit.toLocaleString("pt-MZ");
}
