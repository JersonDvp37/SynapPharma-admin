import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Activity, ArrowRight, ArrowUpRight, BarChart3, Bell, Boxes, Building2, Check, Clock3, Copy, CreditCard, LayoutDashboard, LockKeyhole, LogOut, Mail, Menu, MessageSquare, PackageSearch, RefreshCw, ShieldCheck, Users, Wallet, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "../lib/support";
import { auditAuthorName } from "../lib/audit";
import { limitText, limitValue, normalizeToken, resolvePlan, type PlanLimit } from "../lib/plans";
import { EXPIRY_WARNING_DAYS, validityOf, type Validity } from "../lib/inventory";
import styles from "./Dashboard.module.css";

type Row = Record<string, unknown>;
type Tab = "overview" | "network" | "inventory" | "audit" | "notifications" | "messages";
type Provider = "M-Pesa" | "e-Mola";
type Company = Row & { company_id: string; name?: string | null; admin_email?: string | null; plan_type?: string | null; status?: string | null; expires_at?: string | null };
type Pharmacy = Row & { id: string; company_id: string; pharmacy_id?: string | null };
type DashboardData = {
  company: Company;
  userId: string;
  pharmacies: Pharmacy[];
  plans: Row[];
  products: Row[];
  sales: Row[];
  movements: Row[];
  users: Row[];
  audits: Row[];
  payments: Row[];
  messages: Row[];
  notifications: Row[];
  messageTable: "system_messages" | null;
  errors: Record<string, string>;
};

const tabs: Array<{ key: Tab; label: string; description: string }> = [
  { key: "overview", label: "Visão geral", description: "Empresa, vendas e pagamentos" },
  { key: "network", label: "Filiais & utilizadores", description: "Rede e limites do plano" },
  { key: "inventory", label: "Inventário & Kardex", description: "Stock e movimentos cloud" },
  { key: "audit", label: "Auditoria & logs", description: "Atividade operacional" },
  { key: "notifications", label: "Notificações", description: "Alertas sincronizados das filiais" },
  { key: "messages", label: "Mensagens", description: "Comunicação PREMIUM" },
];

function read(row: Row | undefined, keys: string[], fallback = "—") {
  if (!row) return fallback;
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value);
  }
  return fallback;
}

function amount(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace(/[^0-9,.-]/g, "").replace(",", "."));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function dateOf(row: Row, keys: string[]) {
  const value = read(row, keys, "");
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date : null;
}

function dateText(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("pt-MZ", { timeZone: "Africa/Maputo", dateStyle: "medium", timeStyle: "short" }).format(date);
}

function money(value: number) {
  return new Intl.NumberFormat("pt-MZ", { style: "currency", currency: "MZN", maximumFractionDigits: 2 }).format(value);
}

function upper(value: unknown) {
  return normalizeToken(value);
}

function isStockLossMovement(row: Row) {
  const type = upper(row.tipo_movimento ?? row.tipo ?? row.type ?? row.movimento ?? row.movement_type);
  return ["AVARIA", "AVARIAS", "DAMAGE", "EXPIRACAO", "EXPIRACOES", "EXPIRY", "PERDA", "PERDAS", "LOSS"].includes(type);
}

function active(row: Row) {
  const value = row.ativo ?? row.is_active ?? row.licenca_ativa ?? row.active ?? row.status;
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  return !["0", "FALSE", "NAO", "INACTIVE", "INATIVO", "INATIVA", "SUSPENDED", "SUSPENSO", "SUSPENSA", "DISABLED", "EXPIRED", "EXPIRADA"].includes(upper(value));
}

function activeBranch(row: Row) {
  if (!active(row)) return false;
  const expiry = read(row, ["data_expiracao", "expires_at"], "");
  if (!expiry) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return ["current", "soon"].includes(validityOf(expiry).state);
  const date = new Date(expiry);
  return !Number.isNaN(date.getTime()) && date.getTime() >= Date.now();
}

function productValidity(row: Row) {
  return validityOf(read(row, ["data_validade", "validade", "expiry_date", "expires_at"], ""));
}

function movementTone(row: Row) {
  const type = upper(read(row, ["tipo_movimento", "tipo", "type", "movimento", "movement_type"], ""));
  return ["EXPIRACAO", "EXPIRACOES", "EXPIRY"].includes(type) ? "danger" : ["AVARIA", "AVARIAS", "DAMAGE", "PERDA", "PERDAS", "LOSS"].includes(type) ? "attention" : "neutral";
}

function notificationTone(row: Row) {
  const type = upper(row.tipo);
  return ["EXPIRACAO", "EXPIRADO", "ESTOQUEZERADO"].includes(type) ? "danger" : ["VALIDADEPROXIMA", "ESTOQUEBAIXO", "AVARIA"].includes(type) ? "attention" : "neutral";
}

function stockStatus(row: Row) {
  if (!read(row, ["stock", "estoque_atual", "quantidade", "quantity", "saldo"], "")) return { state: "unknown", label: "Stock não definido" };
  const quantity = amount(row, ["stock", "estoque_atual", "quantidade", "quantity", "saldo"]);
  const configuredMinimum = amount(row, ["stock_min", "min_stock", "estoque_minimo", "minimum_stock"]);
  const minimum = configuredMinimum > 0 ? configuredMinimum : 5;
  return quantity <= 0 ? { state: "expired", label: "Sem stock" } : quantity <= minimum ? { state: "soon", label: "Stock baixo" } : { state: "current", label: "Disponível" };
}

function productForMovement(movement: Row, products: Row[]) {
  const id = read(movement, ["local_produto_id", "produto_id", "product_id"], "");
  const barcode = read(movement, ["codigo_barras", "barcode"], "");
  const lot = read(movement, ["lote", "lot"], "");
  if (!id && !barcode) return undefined;
  const matches = products.filter((product) => product.company_id === movement.company_id && product.pharmacy_id === movement.pharmacy_id &&
    ((id && read(product, ["local_produto_id", "produto_id", "product_id", "id"], "") === id) || (barcode && read(product, ["codigo_barras", "barcode"], "") === barcode)) &&
    (!lot || read(product, ["lote", "lot"], "") === lot));
  return matches.length === 1 ? matches[0] : undefined;
}

function idOf(row: Row) {
  return read(row, ["pharmacy_id", "id"], "");
}

function nameOf(row: Row) {
  return read(row, ["nome_filial", "pharmacy_name", "nome_farmacia", "name", "branch_name"], "Filial sem nome");
}

function pharmacyNameOf(row: Row, pharmacies: Pharmacy[], keys = ["pharmacy_id"], fallback = "Rede") {
  const id = read(row, keys, "").trim();
  const pharmacy = id ? pharmacies.find((item) => [item.pharmacy_id, item.id].some((value) => String(value ?? "").trim() === id)) : undefined;
  return pharmacy ? nameOf(pharmacy) : read(row, ["pharmacy_name", "nome_filial", "nome_farmacia", "branch_name"], id ? "Filial não identificada" : fallback);
}

function inPharmacy(row: Row, selected: string) {
  if (!selected) return true;
  const value = read(row, ["pharmacy_id", "pharmacyId", "filial_id"], "");
  return Boolean(value) && value === selected;
}

function payloadItems(row: Row) {
  const raw = row.payload_itens;
  if (Array.isArray(raw)) return raw.filter((item): item is Row => typeof item === "object" && item !== null);
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item): item is Row => typeof item === "object" && item !== null) : [];
    } catch {
      return [];
    }
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as Row).items)) {
    return ((raw as Row).items as unknown[]).filter((item): item is Row => typeof item === "object" && item !== null);
  }
  return [];
}

type QueryResponse = {
  data: unknown;
  error: { message: string; code?: string; details?: string; hint?: string } | null;
  status: number;
  statusText: string;
  count?: number | null;
};

function logQueryResult(table: string, companyId: string, result: QueryResponse) {
  console.groupCollapsed(`[Dashboard] ${table} · company_id=${companyId}`);
  console.log("Filtro aplicado:", { company_id: companyId });
  console.log("HTTP:", result.status, result.statusText);
  console.log("Registos retornados:", Array.isArray(result.data) ? result.data.length : 0);
  console.log("Dados brutos:", result.data);
  console.log("Erro Supabase:", result.error);
  console.groupEnd();
}

function rowsFrom(result: QueryResponse, companyId?: string) {
  const rows = (Array.isArray(result.data) ? result.data : []) as Row[];
  const validRows = companyId
    ? rows.filter((row) => String(row.company_id ?? "").trim() === companyId)
    : rows;
  if (companyId && validRows.length !== rows.length) {
    console.error("[Dashboard] Registos fora do tenant foram descartados", {
      company_id: companyId,
      descartados: rows.length - validRows.length,
    });
  }
  return {
    data: validRows,
    error: result.error?.message ?? null,
  };
}

async function rowsFor(table: string, companyId: string, columns = "*", orderBy?: string) {
  try {
    let query = supabase.from(table).select(columns).eq("company_id", companyId);
    if (orderBy) query = query.order(orderBy, { ascending: false });
    const result = await query;
    logQueryResult(table, companyId, result);
    return rowsFrom(result, companyId);
  } catch (error) {
    console.error(`[Dashboard] Falha ao consultar ${table}`, { company_id: companyId, error });
    return { data: [] as Row[], error: error instanceof Error ? error.message : String(error) };
  }
}

async function productsFor(companyId: string) {
  try {
    const result = await supabase
      .from("cloud_produtos")
      .select("company_id,pharmacy_id,local_produto_id,codigo_barras,nome,categoria,preco_mzn,quantidade,lote,data_validade,classe_terapeutica,forma_farmaceutica,dosagem,numero_registo_regulador")
      .eq("company_id", companyId);
    logQueryResult("cloud_produtos", companyId, result);
    return rowsFrom(result, companyId);
  } catch (error) {
    console.error("[Dashboard] Falha ao consultar cloud_produtos", { company_id: companyId, error });
    return { data: [] as Row[], error: error instanceof Error ? error.message : String(error) };
  }
}

async function salesFor(companyId: string) {
  try {
    const result = await supabase
      .from("cloud_vendas")
      .select("company_id,pharmacy_id,local_venda_id,total_mzn,forma_pagamento,data_venda,created_at,usuario_nome,payload_itens")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    logQueryResult("cloud_vendas", companyId, result);
    return rowsFrom(result, companyId);
  } catch (error) {
    console.error("[Dashboard] Falha ao consultar cloud_vendas", { company_id: companyId, error });
    return { data: [] as Row[], error: error instanceof Error ? error.message : String(error) };
  }
}

async function messagesFor(companyId: string) {
  try {
    const result = await supabase
      .from("system_messages")
      .select("id,company_id,sender_type,sender_pharmacy_id,recipient_pharmacy_id,subject,body,is_read,created_at")
      .eq("company_id", companyId);
    logQueryResult("system_messages", companyId, result);
    return { ...rowsFrom(result, companyId), table: result.error ? null : ("system_messages" as const) };
  } catch (error) {
    console.error("[Dashboard] Falha ao consultar system_messages", { company_id: companyId, error });
    return { data: [] as Row[], table: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function usersFor(companyId: string) {
  try {
    const result = await supabase
      .from("cloud_usuarios")
      .select("company_id,pharmacy_id,local_user_id,nome,username,role,ativo,created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    logQueryResult("cloud_usuarios", companyId, result);
    console.info("[Dashboard] Utilizadores cloud carregados", {
      companyId,
      status: result.status,
      total: Array.isArray(result.data) ? result.data.length : 0,
      error: result.error,
    });
    return rowsFrom(result, companyId);
  } catch (error) {
    console.error("[Dashboard] Falha ao consultar cloud_usuarios", { company_id: companyId, error });
    return { data: [] as Row[], error: error instanceof Error ? error.message : String(error) };
  }
}

async function createMessage(table: "system_messages", payload: Row) {
  const result = await supabase.from(table).insert(payload);
  return result.error?.message ?? null;
}

function Icon({ children }: { children: ReactNode }) {
  return <span className={styles.icon} aria-hidden="true">{children}</span>;
}

function Metric({ label, value, helper, icon, tone = "green", featured = false }: { label: string; value: string; helper: string; icon: ReactNode; tone?: "green" | "blue" | "amber"; featured?: boolean }) {
  return <article className={`${styles.metric} ${featured ? styles.metricFeatured : ""}`}><div className={styles.metricTop}><span className={styles["metricMark" + tone]}><Icon>{icon}</Icon></span>{featured && <span className={styles.metricPeriod}>Este mês <ArrowUpRight size={13} /></span>}</div><span className={styles.metricLabel}>{label}</span><strong className={styles.metricValue}>{value}</strong><small className={styles.metricHelper}>{helper}</small></article>;
}

function Table({ headers, rows, scrollable = true, rowClasses = [] }: { headers: string[]; rows: ReactNode[][]; scrollable?: boolean; rowClasses?: string[] }) {
  if (!rows.length) return <div className={styles.emptyState}><span className={styles.emptyIcon}><Boxes size={24} /></span><strong>Ainda sem registos</strong><p>Nenhum registo sincronizado para este âmbito.</p></div>;
  return <div className={`${styles.tableWrap} ${scrollable ? styles.tableScrollable : ""}`} tabIndex={0} role="region" aria-label={headers.join(", ")}><table><thead><tr>{headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} className={rowClasses[rowIndex]}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function ValidityBadge({ value }: { value: Validity }) {
  return <span className={`${styles.stateBadge} ${styles["state" + value.state]}`}>{value.label}</span>;
}

function ActivationCode({ code, suffix }: { code: string; suffix: string }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => {
    if (copyStatus === "idle") return;
    const timeout = window.setTimeout(() => setCopyStatus("idle"), 3000);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  const displayedCode = code ? code.length > 16 ? `${code.slice(0, 8)}…${code.slice(-4)}` : code : suffix ? `•••• ${suffix}` : "Protegido";
  return <div className={styles.activationControl}>
    <div className={styles.activationCodeRow}>
      <code>{displayedCode}</code>
      <button className={styles.copyButton} type="button" disabled={!code} onClick={() => void copyCode()} aria-label="Copiar código de ativação completo" title={code ? "Copiar código completo" : "Código completo indisponível"}>{copyStatus === "copied" ? <Check size={14} /> : <Copy size={14} />}{copyStatus === "copied" ? "Copiado" : "Copiar"}</button>
    </div>
    <span className={`${styles.copyFeedback} ${copyStatus === "error" ? styles.error : ""}`} role="status" aria-live="polite">{copyStatus === "copied" ? "Código completo copiado." : copyStatus === "error" ? "Não foi possível copiar. Tente novamente." : ""}</span>
  </div>;
}

export default function Dashboard() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedCompany = searchParams.get("company_id")?.trim() ?? "";
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedPharmacy, setSelectedPharmacy] = useState("");
  const [recipient, setRecipient] = useState("broadcast");
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState("");
  const [messageSent, setMessageSent] = useState("");
  const [sending, setSending] = useState(false);
  const [provider, setProvider] = useState<Provider>("M-Pesa");
  const [phone, setPhone] = useState("");
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");
  const [payMessage, setPayMessage] = useState("");

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const navigation = document.getElementById("dashboard-navigation");
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const media = window.matchMedia("(max-width: 700px)");
    const focusable = () => Array.from(navigation?.querySelectorAll<HTMLElement>("button, a[href]") ?? []);
    const closeOnResize = () => { if (!media.matches) setMobileMenuOpen(false); };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.body.style.overflow = "hidden";
    focusable()[0]?.focus();
    document.addEventListener("keydown", handleKeyDown);
    media.addEventListener("change", closeOnResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      media.removeEventListener("change", closeOnResize);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [mobileMenuOpen]);

  const refresh = useCallback(async () => {
    setSyncing(true);
    setLoadError("");
    try {
      const auth = await supabase.auth.getUser();
      const email = auth.data.user?.email?.trim().toLowerCase();
      if (auth.error) throw auth.error;
      if (!email || !auth.data.user) {
        navigate("/login", { replace: true });
        return;
      }

      let companyQuery = supabase.from("companies").select("*").eq("admin_email", email);
      if (requestedCompany) companyQuery = companyQuery.eq("company_id", requestedCompany);
      const companyResult = await companyQuery.limit(1).maybeSingle();
      console.info("[Dashboard] Empresa resolvida", {
        requestedCompany: requestedCompany || null,
        admin_email: email,
        status: companyResult.status,
        error: companyResult.error,
        company_id: companyResult.data?.company_id ?? null,
      });
      if (companyResult.error || !companyResult.data) {
        setLoadError(companyResult.error?.message ?? "Nenhuma empresa configurada para este email.");
        setData(null);
        return;
      }

      const company = companyResult.data as Company;
      const companyId = String(company.company_id ?? "").trim();
      if (!companyId) {
        setLoadError("A empresa autenticada não possui um company_id válido.");
        setData(null);
        return;
      }
      if (requestedCompany && companyId !== requestedCompany) {
        setLoadError("O company_id selecionado não corresponde à empresa autenticada.");
        setData(null);
        return;
      }
      console.info("[Dashboard] company_id usado nas consultas cloud", { companyId });

      const [pharmacies, plans, products, sales, movements, users, audits, payments, messages, notifications] = await Promise.all([
        rowsFor("pharmacies", companyId, "id,company_id,pharmacy_id,nome_farmacia,nome_filial,plano,data_expiracao,licenca_ativa,created_at,localizacao"),
        supabase.from("plans").select("*"),
        productsFor(companyId),
        salesFor(companyId),
        rowsFor("cloud_estoque_movimentos", companyId, "company_id,pharmacy_id,local_movimento_id,local_produto_id,codigo_barras,tipo_movimento,quantidade,lote,data_validade,motivo,usuario_id,data_hora,created_at", "data_hora"),
        usersFor(companyId),
        rowsFor("cloud_audit_logs", companyId, "company_id,pharmacy_id,local_audit_id,usuario_id,acao,detalhes,data_hora", "data_hora"),
        rowsFor("payments_log", companyId, "id,company_id,transaction_id,amount,status,gateway,created_at", "created_at"),
        messagesFor(companyId),
        rowsFor("cloud_notificacoes", companyId, "id,company_id,pharmacy_id,chave,tipo,titulo,mensagem,lida,criada_em", "criada_em"),
      ]);
      const errors: Record<string, string> = {};
      const results = { pharmacies, products, sales, movements, users, audits, payments, notifications };
      for (const entry of Object.entries(results)) if (entry[1].error) errors[entry[0]] = entry[1].error as string;
      if (plans.error) errors.plans = plans.error.message;
      if (messages.error) errors.messages = messages.error;
      const next: DashboardData = {
        company,
        userId: auth.data.user.id,
        pharmacies: pharmacies.data as Pharmacy[],
        plans: (plans.data ?? []) as Row[],
        products: products.data,
        sales: sales.data,
        movements: movements.data,
        users: users.data,
        audits: audits.data,
        payments: payments.data,
        messages: messages.data,
        notifications: notifications.data,
        messageTable: messages.table,
        errors,
      };
      console.info("[Dashboard] Estado mapeado", {
        companyId,
        products: next.products.length,
        sales: next.sales.length,
        movements: next.movements.length,
        errors,
      });
      setData(next);
    } catch (error) {
      console.error("[Dashboard] Falha geral ao carregar dados", error);
      setLoadError(error instanceof Error ? error.message : String(error));
      setData(null);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, [navigate, requestedCompany]);

  useEffect(() => { void refresh(); }, [refresh]);

  const subscription = useMemo(() => resolvePlan(data?.company, data?.plans ?? []), [data]);
  const planCode = subscription.code;
  const premium = planCode === "PREMIUM";
  useEffect(() => {
    if (!premium && tab === "messages") setTab("overview");
  }, [premium, tab]);
  const visibleTabs = tabs.filter((item) => item.key !== "messages" || premium);
  const activeBranches = data?.pharmacies.filter(activeBranch) ?? [];
  const selected = selectedPharmacy;
  const products = (data?.products ?? []).filter((row) => inPharmacy(row, selected));
  const sales = (data?.sales ?? []).filter((row) => inPharmacy(row, selected));
  const saleItems = sales.flatMap(payloadItems);
  const movements = (data?.movements ?? []).filter((row) => inPharmacy(row, selected));
  const users = (data?.users ?? []).filter((row) => inPharmacy(row, selected));
  const notifications = (data?.notifications ?? []).filter((row) => inPharmacy(row, selected));
  const unreadNotifications = (data?.notifications ?? []).filter((row) => !Boolean(row.lida)).length;
  const metrics = useMemo(() => {
    const now = new Date();
    const monthSales = sales.filter((row) => {
      const date = dateOf(row, ["created_at", "data_venda", "sale_date", "date"]);
      return !date || (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear());
    });
    const total = monthSales.reduce((sum, row) => sum + amount(row, ["total_mzn", "total", "valor_total", "total_venda", "amount", "valor"]), 0);
    const stock = products.reduce((sum, row) => sum + amount(row, ["stock", "estoque_atual", "quantidade", "quantity", "saldo"]), 0);
    const alerts = products.filter((row) => {
      const stockState = stockStatus(row).state;
      const validityState = productValidity(row).state;
      return ["expired", "soon"].includes(stockState) || ["expired", "soon"].includes(validityState);
    }).length;
    const losses = movements.filter(isStockLossMovement).reduce((sum, row) => sum + amount(row, ["quantidade", "quantity", "amount"]), 0);
    const expiry = data?.company.expires_at ? new Date(String(data.company.expires_at)) : null;
    const days = expiry && !Number.isNaN(expiry.getTime()) ? Math.ceil((expiry.getTime() - Date.now()) / 86400000) : null;
    return { total, stock, alerts, losses, days, saleCount: monthSales.length, itemCount: saleItems.length, users: users.filter(active).length };
  }, [data, movements, products, saleItems, sales, users]);
  const maxPharmacies = subscription.pharmacies;
  const maxUsers = subscription.users;
  const branchUsage = (data?.pharmacies ?? []).filter((row) => !selected || idOf(row) === selected).map((pharmacy) => {
    const registered = (data?.users ?? []).filter((row) => inPharmacy(row, idOf(pharmacy)));
    return { pharmacy, registered: registered.length, active: registered.filter(active).length };
  });
  const branchRows = (data?.pharmacies ?? []).map((row) => [<strong key="name">{nameOf(row)}</strong>, <span key="status" className={activeBranch(row) ? styles.good : styles.warning}>{activeBranch(row) ? "Ativa" : "Inativa"}</span>, read(row, ["location", "localizacao", "cidade"])]);
  const productRows = products.map((row, index) => {
    const validity = productValidity(row);
    const stock = stockStatus(row);
    return [<strong key="name">{read(row, ["nome_produto", "produto_nome", "product_name", "nome", "descricao"], "Produto #" + (index + 1))}</strong>, read(row, ["importadora_fornecedor"], "-"), read(row, ["contacto_fornecedor"], "-"), <div key="stock" className={styles.stockCell}><strong>{read(row, ["stock", "estoque_atual", "quantidade", "quantity", "saldo"], "—")}</strong><span className={`${styles.stateBadge} ${styles["state" + stock.state]}`}>{stock.label}</span></div>, validity.date, <ValidityBadge key="validity" value={validity} />];
  });
  const productRowClasses = products.map((row) => productValidity(row).state === "expired" ? styles.expiredRow : "");
  const movementRows = movements.map((row) => {
    const product = productForMovement(row, data?.products ?? []);
    const validity = productValidity(read(row, ["data_validade", "validade", "expiry_date"], "") ? row : product ?? {});
    return [<span key="type" className={`${styles.movementType} ${styles["tone" + movementTone(row)]}`}>{read(row, ["tipo_movimento", "tipo", "type", "movimento", "movement_type"])}</span>, read(product, ["nome_produto", "produto_nome", "product_name", "nome"], "Produto não sincronizado"), read(row, ["quantidade", "quantity", "amount"], "0"), validity.date, <ValidityBadge key="validity" value={validity} />, dateText(read(row, ["data_hora", "created_at", "data", "movement_date"], "")), read(row, ["motivo", "reason", "observacao", "description"])];
  });
  const userRows = users.map((row) => [read(row, ["nome", "username"], "Utilizador"), read(row, ["role"], "—"), <span key="status" className={active(row) ? styles.good : styles.warning}>{active(row) ? "Ativo" : "Inativo"}</span>, pharmacyNameOf(row, data?.pharmacies ?? [])]);
  const auditRows = (data?.audits ?? []).map((row) => [dateText(read(row, ["data_hora", "created_at", "timestamp", "data"], "")), read(row, ["acao", "action", "event", "event_type"]), auditAuthorName(row, data?.users ?? []), pharmacyNameOf(row, data?.pharmacies ?? [], ["pharmacy_id", "entity_id"])]);
  const paymentRows = (data?.payments ?? []).map((row) => [read(row, ["reference", "transaction_id", "id"]), money(amount(row, ["amount", "valor"])), <span key="status" className={styles.good}>{read(row, ["status", "state"])}</span>, dateText(read(row, ["created_at", "processed_at"], ""))]);
  const salesRows = sales.map((row) => [read(row, ["numero_venda", "sale_number", "reference", "id"]), payloadItems(row).length.toString(), money(amount(row, ["total_mzn", "total", "valor_total", "total_venda", "amount", "valor"])), pharmacyNameOf(row, data?.pharmacies ?? []), dateText(read(row, ["created_at", "data_venda", "sale_date"], ""))]);

  async function logout() {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessageError("");
    setMessageSent("");
    if (!premium || !data || !data.messageTable || !message.trim()) return;
    setSending(true);
    const targetRows = recipient === "broadcast"
      ? data.pharmacies
      : data.pharmacies.filter((row) => idOf(row) === recipient);
    // O desktop usa pharmacies.pharmacy_id como identidade da filial.
    // pharmacies.id e pharmacy_id podem ser diferentes: o primeiro e gerado
    // pelo banco, enquanto o segundo e criado pelo fluxo de ativacao Java.
    const targets = [...new Set(targetRows.map((row) => idOf(row)).filter(Boolean))];
    const errors = await Promise.all(targets.map((recipient_pharmacy_id) => createMessage(data.messageTable!, {
      company_id: data.company.company_id,
      sender_type: "WEB_ADMIN",
      sender_pharmacy_id: null,
      recipient_pharmacy_id,
      subject: "Mensagem do administrador",
      body: message.trim(),
      is_read: false,
    })));
    const error = errors.filter(Boolean).join(" | ");
    setSending(false);
    if (error) {
      setMessageError(error);
      return;
    }
    setMessage("");
    setMessageSent("Mensagem enviada e registada na nuvem.");
    void refresh();
  }

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    setPayError("");
    setPayMessage("");
    const normalizedPhone = phone.replace(/\D/g, "");
    if (!/^8\d{8}$/.test(normalizedPhone) && !/^2588\d{8}$/.test(normalizedPhone)) {
      setPayError("Informe um número M-Pesa/e-Mola válido.");
      return;
    }
    setPaying(true);
    const result = await supabase.functions.invoke<{ message?: string; error?: string }>("paysuite-create-payment", { body: { company_id: data.company.company_id, phone: normalizedPhone, provider } });
    setPaying(false);
    if (result.error || result.data?.error) setPayError(result.data?.error ?? result.error?.message ?? "Não foi possível iniciar o pagamento.");
    else setPayMessage(result.data?.message ?? "Pedido enviado. Confirme o PIN no telemóvel.");
  }

  if (loading) return <main className={styles.loadingPage}><div className={styles.loadingState} role="status"><span><RefreshCw size={25} className={styles.spin} /></span><strong>A preparar o seu painel</strong><p>A carregar os dados da sua operação…</p></div></main>;
  if (loadError || !data) return <main className={styles.loadingPage}><div className={styles.errorBox}><strong>Não foi possível abrir o dashboard.</strong><p>{loadError}</p><Link to="/login">Voltar ao login</Link></div></main>;

  const companyName = read(data.company, ["name", "company_name", "responsible_name"], "Synap Pharma");
  const days = metrics.days;
  const licenseStatus = days === null ? "Sem data definida" : days >= 0 ? "Ativa" : "Expirada";
  const initials = companyName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const limitPercent = (value: number, limit: PlanLimit) => typeof limit === "number" && limit > 0 ? Math.min(100, value / limit * 100) + "%" : "0%";

  return <div className={styles.shell}>
    {mobileMenuOpen && <button className={styles.menuBackdrop} aria-label="Fechar navegação" onClick={() => setMobileMenuOpen(false)} type="button" />}
    <aside id="dashboard-navigation" className={`${styles.sidebar} ${mobileMenuOpen ? styles.sidebarOpen : ""}`}>
      <div className={styles.brand}><img src="/logo_icon.png" alt="" /><span><strong>Synap</strong> Pharma<small>GESTÃO DE FARMÁCIAS</small></span><button className={styles.menuClose} aria-label="Fechar menu" onClick={() => setMobileMenuOpen(false)} type="button"><X size={19} /></button></div>
      <nav className={styles.nav} aria-label="Navegação do dashboard">
        <p>ESPAÇO DE TRABALHO</p>
        {tabs.slice(0, 4).map((item) => <button className={tab === item.key ? styles.navActive : ""} aria-current={tab === item.key ? "page" : undefined} key={item.key} onClick={() => { setTab(item.key); setMobileMenuOpen(false); }} type="button"><Icon>{item.key === "overview" ? <LayoutDashboard size={18} /> : item.key === "network" ? <Building2 size={18} /> : item.key === "inventory" ? <PackageSearch size={18} /> : <BarChart3 size={18} />}</Icon>{item.label}{tab === item.key && <span className={styles.navIndicator} />}</button>)}
        <button className={tab === "notifications" ? styles.navActive : ""} aria-current={tab === "notifications" ? "page" : undefined} onClick={() => { setTab("notifications"); setMobileMenuOpen(false); }} type="button"><Icon><Bell size={18} /></Icon>Notificações{unreadNotifications > 0 && <b>{unreadNotifications}</b>}</button>
        <p>CONTA</p>
        {premium && <button className={tab === "messages" ? styles.navActive : ""} aria-current={tab === "messages" ? "page" : undefined} onClick={() => { setTab("messages"); setMobileMenuOpen(false); }} type="button"><Icon><MessageSquare size={18} /></Icon>Mensagens <b>{data.messages.filter((row) => !Boolean(row.is_read ?? row.read_at)).length || ""}</b></button>}
        <button onClick={() => void logout()} type="button"><Icon><LogOut size={17} /></Icon>Sair</button>
      </nav>
      <div className={styles.planCard}><span className={styles.planCardIcon}><ShieldCheck size={20} /></span><span>O SEU PLANO</span><strong>{subscription.name}</strong><small>{maxPharmacies === null ? "Filiais ilimitadas" : maxPharmacies === undefined ? "Limites não configurados" : data.pharmacies.length + "/" + maxPharmacies + " filiais registadas"}</small><Link to={`/planos?company_id=${encodeURIComponent(data.company.company_id)}`}>Gerir subscrição <ArrowUpRight size={15} /></Link></div>
      <small className={styles.syncDot}><i /> Espaço de trabalho protegido</small>
    </aside>
    <main className={styles.main}>
      <header className={styles.header}>
        <button className={styles.menuButton} aria-label="Abrir menu" aria-expanded={mobileMenuOpen} aria-controls="dashboard-navigation" onClick={() => setMobileMenuOpen(true)} type="button"><Menu size={21} /></button>
        <div className={styles.heading}>
          <span className={styles.breadcrumb}>Painel de gestão <span>/</span> {tabs.find((item) => item.key === tab)?.label}</span>
          <h1>{tab === "overview" ? "A sua operação, num só lugar." : tabs.find((item) => item.key === tab)?.label}</h1>
          <p>Acompanhe os dados da rede <strong>{companyName}</strong></p>
        </div>
        <div className={styles.headerTools}>
          <div className={styles.headerRight}><button className={styles.syncButton} aria-label={syncing ? "A sincronizar" : "Sincronizar dados"} disabled={syncing} onClick={() => void refresh()} type="button"><RefreshCw size={15} className={syncing ? styles.spin : ""} /><span>{syncing ? "A sincronizar..." : "Sincronizar"}</span></button><span className={styles.profileDivider} /><span className={styles.avatar}>{initials || "SA"}</span><span className={styles.profile}><strong>{companyName}</strong><small>{read(data.company, ["admin_email"], "Super Admin")}</small></span></div>
          <div className={`${styles.licenseBadge} ${days !== null && days < 0 ? styles.licenseExpired : ""}`}><ShieldCheck size={15} />Licença {licenseStatus.toLocaleLowerCase()}{days !== null && days >= 0 ? " · " + days + " dias" : ""}</div>
        </div>
      </header>
      <div className={styles.content}>
        {Object.keys(data.errors).length > 0 && <p className={styles.dataNotice} role="status">Alguns dados não puderam ser atualizados. Utilize Sincronizar para tentar novamente.</p>}
        <section className={styles.metrics} aria-label="Indicadores da operação"><Metric label="Faturamento do mês" value={money(metrics.total)} helper={metrics.saleCount + " vendas sincronizadas"} icon={<Wallet size={20} />} featured /><Metric label="Stock total" value={metrics.stock.toLocaleString("pt-MZ")} helper={metrics.alerts + " alertas de validade/stock"} icon={<Boxes size={20} />} tone={metrics.alerts ? "amber" : "blue"} /><Metric label="Filiais ativas" value={data.errors.pharmacies ? "—" : activeBranches.length + " / " + limitValue(maxPharmacies)} helper="Filiais ativas na sua rede" icon={<Building2 size={20} />} tone="blue" /><Metric label="Utilizadores ativos" value={data.errors.users ? "—" : String(metrics.users)} helper={maxUsers === null ? "Ativos · sem limite por filial" : maxUsers === undefined ? "Ativos · limite não configurado" : "Ativos · até " + maxUsers + " por filial"} icon={<Users size={20} />} /></section>
        <div className={styles.tabs} role="tablist" aria-label="Secções do painel">{visibleTabs.map((item, index) => <button className={tab === item.key ? styles.tabActive : ""} key={item.key} id={`tab-${item.key}`} role="tab" aria-selected={tab === item.key} aria-controls="dashboard-panel" tabIndex={tab === item.key ? 0 : -1} onClick={() => setTab(item.key)} onKeyDown={(event) => { const nextIndex = event.key === "ArrowRight" ? (index + 1) % visibleTabs.length : event.key === "ArrowLeft" ? (index + visibleTabs.length - 1) % visibleTabs.length : event.key === "Home" ? 0 : event.key === "End" ? visibleTabs.length - 1 : -1; if (nextIndex < 0) return; event.preventDefault(); setTab(visibleTabs[nextIndex].key); document.getElementById(`tab-${visibleTabs[nextIndex].key}`)?.focus(); }} type="button" title={item.description}><span>{item.label}</span></button>)}</div>

        <div id="dashboard-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "overview" && <section className={`${styles.grid} ${styles.overviewGrid}`}>
          <article className={`${styles.cardWide} ${styles.companyCard}`}>
            <div className={styles.cardHeader}><div><span className={styles.eyebrow}>EMPRESA & LICENÇA</span><h2>{companyName}</h2><p>{read(data.company, ["admin_email"], "Administrador")} · plano {subscription.name}</p></div><span className={`${styles.status} ${days !== null && days < 0 ? styles.statusExpired : ""}`}><i />{licenseStatus}</span></div>
            <div className={styles.licenseLine}><div><small><Clock3 size={13} /> Expiração</small><strong>{dateText(data.company.expires_at)}</strong></div><div><small><ShieldCheck size={13} /> Tolerância</small><strong>35 dias</strong></div><div className={styles.activationField}><small><LockKeyhole size={13} /> Código de ativação</small><ActivationCode key={data.company.company_id} code={read(data.company, ["activation_code_plain"], "")} suffix={read(data.company, ["activation_code_last4"], "")} /></div></div>
            {days !== null && days <= 35 && <div className={styles.warningBox}>Planeie a renovação: a licença está dentro da janela de tolerância de 35 dias.</div>}
          </article>
          <article className={`${styles.card} ${styles.operationsCard}`}>
            <div className={styles.cardHeader}><div><span className={styles.eyebrow}>ATIVIDADE DA REDE</span><h2>Resumo operacional</h2><p>Uma visão da sua atividade sincronizada</p></div><span className={styles.sectionIcon}><Activity size={19} /></span></div>
            <div className={styles.statList}><span><b>{metrics.losses.toLocaleString("pt-MZ")}</b><small>Avarias/expirações no Kardex</small></span><span><b>{data.audits.length}</b><small>Eventos de auditoria</small></span><span><b>{data.messages.length}</b><small>Mensagens sincronizadas</small></span></div>
          </article>
          <article className={`${styles.cardWide} ${styles.salesCard}`}>
            <div className={styles.cardHeader}><div><h2>Vendas sincronizadas</h2><p>{metrics.itemCount} itens detalhados nas vendas da rede</p></div><span className={styles.sectionIcon}><BarChart3 size={19} /></span></div>
            <Table headers={["Venda", "Itens", "Total", "Filial", "Data"]} rows={salesRows} />
          </article>
          <article className={`${styles.card} ${styles.paymentsCard}`}>
            <div className={styles.cardHeader}><div><h2>Pagamentos recentes</h2><p>Histórico de pagamentos da empresa</p></div><span className={styles.sectionIcon}><CreditCard size={19} /></span></div>
            <Table headers={["Referência", "Valor", "Estado", "Data"]} rows={paymentRows} />
          </article>
        </section>}

        {tab === "network" && <section className={styles.grid}>
          <article className={styles.cardWide}><div className={styles.cardHeader}><div><span className={styles.eyebrow}>A SUA REDE</span><h2>Rede de filiais</h2><p>Todas as farmácias ligadas à sua empresa.</p></div><select aria-label="Filtrar por filial" className={styles.select} value={selected} onChange={(event) => setSelectedPharmacy(event.target.value)}><option value="">Todas as filiais</option>{data.pharmacies.map((row) => <option key={idOf(row)} value={idOf(row)}>{nameOf(row)}</option>)}</select></div><Table headers={["Filial", "Estado", "Localização"]} rows={branchRows} /></article>
          <article className={styles.card}><div className={styles.cardHeader}><div><h2>Limites do plano</h2><p>Subscrição {subscription.name}</p></div></div>
            <div className={styles.limit}><span>Filiais registadas</span><strong>{data.errors.pharmacies ? "—" : data.pharmacies.length} / {limitValue(maxPharmacies)}</strong><div><i className={typeof maxPharmacies === "number" && data.pharmacies.length > maxPharmacies ? styles.limitExceeded : ""} style={{ width: limitPercent(data.pharmacies.length, maxPharmacies) }} /></div></div>
            <div className={styles.usageHeading}><span>Utilizadores por filial</span><strong>{limitText(maxUsers)}</strong></div><p className={styles.usageNote}>O limite inclui todos os utilizadores registados, ativos e inativos.</p>
            {data.errors.users ? <p className={styles.error}>Não foi possível carregar os utilizadores.</p> : <div className={styles.usageList}>{branchUsage.map((usage) => <div className={styles.branchUsage} key={idOf(usage.pharmacy)}><div><strong>{nameOf(usage.pharmacy)}</strong><span className={typeof maxUsers === "number" && usage.registered > maxUsers ? styles.warning : ""}>{usage.registered} / {limitValue(maxUsers)}</span></div><small>{usage.active} ativos · {usage.registered} registados</small>{typeof maxUsers === "number" && <div className={styles.usageBar}><i className={usage.registered > maxUsers ? styles.limitExceeded : ""} style={{ width: limitPercent(usage.registered, maxUsers) }} /></div>}</div>)}</div>}
          </article>
          <article className={styles.cardWide}><div className={styles.cardHeader}><div><h2>Utilizadores da rede</h2><p>Perfis e acessos nas suas farmácias</p></div></div><Table headers={["Utilizador", "Perfil", "Estado", "Filial"]} rows={userRows} /></article>
        </section>}

        {tab === "inventory" && <section className={`${styles.grid} ${styles.inventoryGrid}`}>
          <article className={styles.cardWide}><div className={styles.cardHeader}><div><span className={styles.eyebrow}>GESTÃO DE INVENTÁRIO</span><h2>Produtos e validade</h2><p>{products.length} produtos sincronizados · aviso de validade até {EXPIRY_WARNING_DAYS} dias</p></div><select aria-label="Filtrar por filial" className={styles.select} value={selected} onChange={(event) => setSelectedPharmacy(event.target.value)}><option value="">Todas as filiais</option>{data.pharmacies.map((row) => <option key={idOf(row)} value={idOf(row)}>{nameOf(row)}</option>)}</select></div>
            <Table headers={["Produto", "Importadora / fornecedor", "Contacto", "Stock", "Validade", "Estado da validade"]} rows={productRows} rowClasses={productRowClasses} />
          </article>
          <article className={styles.card}><div className={styles.cardHeader}><div><h2>Kardex · movimentos de stock</h2><p>Movimentos recentes e validade do lote associado</p></div><div className={styles.movementLegend}><span className={`${styles.movementType} ${styles.toneattention}`}>Avaria</span><span className={`${styles.movementType} ${styles.tonedanger}`}>Expiração</span></div></div><div className={styles.kardex}><strong>{metrics.losses.toLocaleString("pt-MZ")}</strong><span>unidades em avarias, perdas ou expirações</span></div>
            <Table headers={["Tipo", "Produto", "Qtd.", "Validade", "Estado da validade", "Data", "Motivo"]} rows={movementRows} />
          </article>
        </section>}

        {tab === "notifications" && <section className={styles.card}>
          <div className={styles.cardHeader}><div><span className={styles.eyebrow}>ALERTAS DAS FILIAIS</span><h2>Notificações</h2><p>{notifications.length} notificações · {notifications.filter((row) => !Boolean(row.lida)).length} não lidas neste âmbito</p></div><select aria-label="Filtrar notificações por filial" className={styles.select} value={selected} onChange={(event) => setSelectedPharmacy(event.target.value)}><option value="">Todas as filiais</option>{data.pharmacies.map((row) => <option key={idOf(row)} value={idOf(row)}>{nameOf(row)}</option>)}</select></div>
          {data.errors.notifications ? <p className={styles.error} role="alert">Não foi possível carregar as notificações. Utilize Sincronizar para tentar novamente.</p> : !notifications.length ? <div className={styles.emptyState}><span className={styles.emptyIcon}><Bell size={24} /></span><strong>Sem notificações neste âmbito</strong><p>Os alertas sincronizados das suas filiais aparecem aqui.</p></div> : <div className={styles.notificationList} tabIndex={0} role="region" aria-label="Lista de notificações">{notifications.map((row) => <article className={`${styles.notificationItem} ${!Boolean(row.lida) ? styles.notificationUnread : ""}`} key={read(row, ["id", "chave"])}><span className={`${styles.notificationIcon} ${styles["tone" + notificationTone(row)]}`}><Bell size={18} /></span><div className={styles.notificationContent}><div className={styles.notificationHeading}><strong>{read(row, ["titulo"], "Notificação")}</strong><span className={`${styles.stateBadge} ${Boolean(row.lida) ? styles.stateunknown : styles.statecurrent}`}>{Boolean(row.lida) ? "Lida" : "Não lida"}</span></div><p>{read(row, ["mensagem"], "")}</p><small>{pharmacyNameOf(row, data.pharmacies)} · {dateText(row.criada_em)}</small></div></article>)}</div>}
        </section>}

        {tab === "audit" && <section className={`${styles.grid} ${styles.auditGrid}`}>
          <article className={styles.cardWide}><div className={styles.cardHeader}><div><span className={styles.eyebrow}>RASTREABILIDADE</span><h2>Auditoria da rede</h2><p>Registo de atividade da rede {companyName}</p></div></div><Table headers={["Data", "Ação", "Autor", "Filial"]} rows={auditRows} scrollable /></article>
        </section>}

        {tab === "messages" && <section className={`${styles.grid} ${styles.messagesGrid}`}>{!premium ? <article className={styles.locked}><LockKeyhole size={34} /><h2>Módulo PREMIUM bloqueado</h2><p>A comunicação entre o administrador e as filiais está disponível apenas no plano PREMIUM.</p><Link to="/planos">Ver opções de plano <ArrowRight size={14} /></Link></article> : <><article className={styles.card}><div className={styles.cardHeader}><div><span className={styles.eyebrow}>PREMIUM / COMUNICAÇÃO</span><h2>Enviar mensagem</h2><p>Comunique diretamente com as suas farmácias.</p></div></div><form className={styles.messageForm} onSubmit={sendMessage}><label>Destinatário<select className={styles.select} value={recipient} onChange={(event) => setRecipient(event.target.value)}><option value="broadcast">Todas as filiais (Broadcast)</option>{data.pharmacies.map((row) => <option key={idOf(row)} value={idOf(row)}>{nameOf(row)}</option>)}</select></label><label>Mensagem<textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Escreva uma comunicação para a sua rede..." required rows={5} /></label><button className={styles.primaryButton} disabled={sending || !data.messageTable} type="submit">{sending ? "A enviar..." : "Enviar mensagem"}</button>{!data.messageTable && <p className={styles.warning}>Não foi possível aceder às mensagens. Tente sincronizar novamente.</p>}{messageError && <p role="alert" className={styles.error}>{messageError}</p>}{messageSent && <p role="status" className={styles.good}>{messageSent}</p>}</form></article><article className={styles.cardWide}><div className={styles.cardHeader}><div><h2>Histórico de comunicação</h2><p>Comunicações da sua empresa e das filiais</p></div></div><div className={styles.messageList}>{data.messages.map((row, index) => <div className={styles.messageRow} key={String(row.id ?? index)}><i className={Boolean(row.is_read ?? row.read_at) ? styles.readDot : styles.unreadDot} /><div><strong>{read(row, ["subject", "title", "message", "content", "body"], "Mensagem sem conteúdo")}</strong><small>{pharmacyNameOf(row, data.pharmacies, ["recipient_pharmacy_id"], "Todas as filiais")} · {dateText(read(row, ["created_at", "sent_at"], ""))}</small></div><em>{Boolean(row.is_read ?? row.read_at) ? "Lida" : "Não lida"}</em></div>)}</div>{!data.messages.length && <div className={styles.emptyState}>Nenhuma mensagem sincronizada.</div>}</article></>}</section>}

        </div>

        <section className={styles.renewal}><div className={styles.renewalIntro}><span className={styles.renewalIcon}><ShieldCheck size={24} /></span><div><span className={styles.eyebrow}>CONTINUIDADE DO SEU NEGÓCIO</span><h2>Renovar subscrição</h2><p>Receba o pedido de pagamento no seu telemóvel.</p></div></div><form className={styles.paymentForm} onSubmit={pay}><label>Carteira móvel<select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}><option>M-Pesa</option><option>e-Mola</option></select></label><label>Número de telemóvel<input required inputMode="tel" placeholder="84 123 4567" value={phone} onChange={(event) => setPhone(event.target.value)} /></label><button className={styles.primaryButton} disabled={paying} type="submit">{paying ? "A enviar..." : "Renovar plano"}<ArrowRight size={15} /></button></form>{payError && <p role="alert" className={styles.error}>{payError}</p>}{payMessage && <p role="status" className={styles.good}>{payMessage}</p>}</section>
        <footer className={styles.footer}><span>Synap Pharma <i /> Gestão que acompanha a sua rede.</span><a href={SUPPORT_MAILTO}><Mail size={12} />{SUPPORT_EMAIL}</a><span><LockKeyhole size={12} /> Dados da sua empresa protegidos</span></footer>
      </div>
    </main>
  </div>;
}
