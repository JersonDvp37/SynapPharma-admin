import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import DashboardLayout, { type BranchSummary } from "../components/DashboardLayout";
import { PharmacyMonitor } from "../components/PharmacyMonitor";
import { listCompanyPharmacies, type Pharmacy } from "../services/monitoringService";
import { supabase } from "../lib/supabase";
import styles from "./AdminDashboard.module.css";

type Provider = "M-Pesa" | "e-Mola";
type Company = { company_id: string; name: string; admin_email: string; plan_type: "BASIC" | "PREMIUM"; status: string; expires_at: string | null };
type PaymentResponse = { amount?: number; message?: string; error?: string };

export function AdminDashboard() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [company, setCompany] = useState<Company | null>(null);
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [loading, setLoading] = useState(true);
  const [pharmaciesLoading, setPharmaciesLoading] = useState(false);
  const [error, setError] = useState("");
  const [pharmacyError, setPharmacyError] = useState("");
  const [provider, setProvider] = useState<Provider>("M-Pesa");
  const [phone, setPhone] = useState("");
  const [payError, setPayError] = useState("");
  const [payMessage, setPayMessage] = useState("");
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user || !auth.user.email) {
        navigate("/login", { replace: true });
        return;
      }

      const requestedId = searchParams.get("company_id")?.trim();
      let query = supabase.from("companies").select("company_id, name, admin_email, plan_type, status, expires_at").eq("admin_email", auth.user.email.toLowerCase());
      if (requestedId) query = query.eq("company_id", requestedId);
      const result = await query.limit(1).maybeSingle();
      if (cancelled) return;
      if (result.error || !result.data) {
        setError("Nenhuma empresa configurada para este email.");
        setLoading(false);
        return;
      }

      const currentCompany = result.data as Company;
      setCompany(currentCompany);
      setPharmaciesLoading(true);
      const branches = await listCompanyPharmacies(currentCompany.company_id);
      if (cancelled) return;
      if (branches.error) {
        setPharmacyError(`Não foi possível carregar as filiais registadas pelo desktop. ${branches.error}`);
        setPharmacies([]);
      } else {
        setPharmacies(branches.data);
      }
      setPharmaciesLoading(false);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [navigate, searchParams]);

  const daysRemaining = useMemo(
    () => company?.expires_at ? Math.max(0, Math.ceil((new Date(company.expires_at).getTime() - Date.now()) / 86400000)) : 0,
    [company],
  );
  const active = company?.status.toUpperCase() === "ACTIVE" && daysRemaining > 0;
  const branchSummaries: BranchSummary[] = pharmacies.map((pharmacy, index) => {
    const name = pharmacy.nome_filial || pharmacy.pharmacy_name || pharmacy.nome_farmacia || "Filial sem nome";
    const isActive = pharmacy.licenca_ativa === undefined || pharmacy.licenca_ativa === null || pharmacy.licenca_ativa === 1 || pharmacy.licenca_ativa === true;
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "FP";
    const colors = ["#059669", "#2563eb", "#d97706", "#7c3aed"];
    const pharmacyCode = pharmacy.pharmacy_id || pharmacy.id;
    return { id: pharmacy.id, name, city: `ID: ${pharmacyCode}`, plan: company?.plan_type === "PREMIUM" ? "Premium" : "Básico", status: isActive ? "Ativa" : "Atenção", sales: "Dados em sincronização", initials, color: colors[index % colors.length] };
  });

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!company) return;
    setPayError("");
    setPayMessage("");
    const normalized = phone.replace(/\D/g, "");
    if (!/^8\d{8}$/.test(normalized) && !/^2588\d{8}$/.test(normalized)) {
      setPayError("Informe um numero M-Pesa/e-Mola valido.");
      return;
    }
    setPaying(true);
    const { data, error: functionError } = await supabase.functions.invoke<PaymentResponse>("paysuite-create-payment", { body: { company_id: company.company_id, phone: normalized, provider } });
    setPaying(false);
    if (functionError || data?.error) setPayError(data?.error ?? "Nao foi possivel iniciar o pagamento.");
    else setPayMessage(data?.message ?? "Pedido enviado. Confirme o PIN no telemovel.");
  }

  async function logout() {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }

  if (loading) return <main className={styles.page}><section className={styles.empty}>A carregar painel...</section></main>;
  if (error || !company) return <main className={styles.page}><section className={styles.empty}><p className={styles.error}>{error}</p><Link to="/onboarding">Aguardar ativação no desktop</Link></section></main>;

  function handleNavigate(item: string) {
    if (item === "Sair") {
      void logout();
      return;
    }
    if (item === "Filiais") document.getElementById("pharmacy-monitor-section")?.scrollIntoView({ behavior: "smooth" });
  }

  function handleQuickAction(action: "add-branch" | "renew-plan" | "report") {
    if (action === "add-branch") {
      navigate("/onboarding");
      return;
    }
    if (action === "renew-plan") {
      document.getElementById("renewal-section")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    document.getElementById("pharmacy-monitor-section")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <>
      <DashboardLayout
        activePlan={company.plan_type === "PREMIUM" ? "Premium" : "Básico"}
        adminName={company.name}
        adminRole={company.admin_email}
        branches={branchSummaries}
        expiringLicenses={active ? 0 : 1}
        onNavigate={handleNavigate}
        onQuickAction={handleQuickAction}
      />
      <div className={styles.supportingArea}>
        <section id="pharmacy-monitor-section">
          <PharmacyMonitor companyId={company.company_id} companyName={company.name} pharmacies={pharmacies} loading={pharmaciesLoading} error={pharmacyError} />
        </section>
        <section className={styles.renewal} id="renewal-section">
          <span className={styles.eyebrow}>RENOVAÇÃO DE LICENÇA</span>
          <h2>Renovar subscrição</h2>
          <p>Plano selecionado: <strong>{company.plan_type}</strong>. Informe o número para receber a cobrança no telemóvel.</p>
          <form className={styles.renewalForm} onSubmit={pay}>
            <label>Carteira<select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}><option>M-Pesa</option><option>e-Mola</option></select></label>
            <label>Número M-Pesa/e-Mola<input required inputMode="tel" placeholder="84 123 4567" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            <button className={styles.primaryButton} disabled={paying}>{paying ? "A enviar..." : "Renovar / Pagar"}</button>
          </form>
          {payError && <p className={styles.error}>{payError}</p>}
          {payMessage && <p className={styles.success}>{payMessage}</p>}
        </section>
        <footer className={styles.footer}><Link to="/onboarding">Estado da ativação desktop</Link><button className={styles.secondaryButton} onClick={() => void logout()} type="button">Sair</button></footer>
      </div>
    </>
  );
}
