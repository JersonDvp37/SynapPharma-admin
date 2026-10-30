import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Building2, Check, Crown, ShieldCheck, Sparkles, Users } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "../lib/support";
import { limitValue, planName, resolvePlan, type PlanCode } from "../lib/plans";
import styles from "./Plans.module.css";

type PlanKey = PlanCode;
type Row = Record<string, unknown>;

const plans: Array<{
  key: PlanKey;
  name: string;
  description: string;
  price: string;
  icon: typeof Building2;
  featured?: boolean;
  features: string[];
}> = [
  {
    key: "BASIC",
    name: "Plano Básico",
    description: "Para uma farmácia que está a começar a organizar a operação.",
    price: "2.500 MTS",
    icon: Building2,
    features: [
      "Alertas de validade na tela do Desktop (60 dias)",
      "Gestão de Stock & Kardex completa (entrada, saída e avarias)",
      "Acesso Web com resumo de vendas diárias e mensais",
      "Suporte técnico em horário comercial (Email/Chat)",
    ],
  },
  {
    key: "INTERMEDIATE",
    name: "Plano Intermédio",
    description: "Para redes em crescimento que precisam de controlo consolidado.",
    price: "5.500 MTS",
    icon: ShieldCheck,
    featured: true,
    features: [
      "Tudo do Básico",
      "Notificações por Email",
      "Relatórios Consolidados + Audit Logs",
      "PDF + Excel + filtros personalizados",
      "Relatórios e vendas",
    ],
  },
  {
    key: "PREMIUM",
    name: "Plano Premium",
    description: "Para operações sem limite e comunicação direta com toda a rede.",
    price: "Personalizado",
    icon: Crown,
    features: [
      "Tudo do Plano Intermédio",
      "Mensagens entre admin e filiais, nos dois sentidos",
      "Relatórios avançados + exportação geral",
      "Relatórios financeiros consolidados",
      "Cobrança por filial",
    ],
  },
];

export function Plans() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedCompany = searchParams.get("company_id")?.trim() ?? "";
  const [currentPlan, setCurrentPlan] = useState("");
  const [cloudPlans, setCloudPlans] = useState<Row[]>([]);
  const [planError, setPlanError] = useState("");
  const [checking, setChecking] = useState(true);
  const dashboardUrl = requestedCompany ? `/admin?company_id=${encodeURIComponent(requestedCompany)}` : "/admin";

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setPlanError("");
    setCurrentPlan("");
    setCloudPlans([]);
    void (async () => {
      try {
        const auth = await supabase.auth.getUser();
        if (auth.error) throw auth.error;
        if (!auth.data.user?.email) {
          navigate("/login", { replace: true });
          return;
        }
        let query = supabase.from("companies").select("*").eq("admin_email", auth.data.user.email.toLowerCase());
        if (requestedCompany) query = query.eq("company_id", requestedCompany);
        const [result, catalog] = await Promise.all([query.limit(1).maybeSingle(), supabase.from("plans").select("*")]);
        if (cancelled) return;
        if (result.error || !result.data) throw new Error("Não foi possível identificar o plano da sua empresa.");
        const records = (catalog.data ?? []) as Row[];
        setCloudPlans(records);
        setCurrentPlan(resolvePlan(result.data, records).code);
        if (catalog.error) setPlanError("Não foi possível obter os limites personalizados. Estão apresentados os limites padrão dos planos.");
      } catch (error) {
        if (!cancelled) setPlanError(error instanceof Error ? error.message : "Não foi possível carregar os planos.");
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [navigate, requestedCompany]);

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link className={styles.backLink} to={dashboardUrl}><ArrowLeft size={17} /> Voltar ao dashboard</Link>
      <div className={styles.brand}><img src="/logo_icon.png" alt="" /> <strong>Synap</strong> Pharma</div>
      <span className={styles.headerStatus}>{checking ? "A verificar..." : currentPlan ? "Plano atual: " + planName(currentPlan) : "Plano não identificado"}</span>
    </header>
    <section className={styles.hero}>
      <span className={styles.eyebrow}>PLANOS & SUBSCRIÇÕES</span>
      <h1>Escolha o plano certo para a sua operação.</h1>
      <p>Tenha mais controlo sobre as suas farmácias, utilizadores, stock, vendas e comunicação.</p>
    </section>
    {planError && <p className={styles.planNotice} role="status">{planError}</p>}
    <section className={styles.planGrid} aria-label="Planos Synap Pharma">
      {plans.map((plan) => {
        const PlanIcon = plan.icon;
        const isCurrent = currentPlan === plan.key;
        const limits = resolvePlan({ plan_type: plan.key }, cloudPlans);
        const features = [
          limits.pharmacies === null ? "Farmácias ilimitadas" : `${limitValue(limits.pharmacies)} farmácia${limits.pharmacies === 1 ? "" : "s"}`,
          limits.users === null ? "Utilizadores ilimitados por filial" : `Até ${limitValue(limits.users)} utilizadores por filial`,
          ...plan.features,
        ];
        return <article className={plan.featured ? styles.planCardFeatured : styles.planCard} key={plan.key}>
          {plan.featured && <span className={styles.recommended}>Mais escolhido</span>}
          <div className={styles.planIcon}><PlanIcon size={22} /></div>
          <div className={styles.planTitle}><div><h2>{plan.name}</h2><p>{plan.description}</p></div>{isCurrent && <span className={styles.current}>Atual</span>}</div>
          <strong className={styles.price}>{plan.price}{plan.key !== "PREMIUM" && <small>/mês</small>}</strong>
          <div className={styles.featureList}>{features.map((feature) => <span key={feature}><Check size={15} />{feature}</span>)}</div>
          {plan.key === "PREMIUM" && !isCurrent ? <a className={styles.secondaryButton} href={SUPPORT_MAILTO}>Falar com a Synap <ArrowRight size={15} /></a> : <button className={plan.featured ? styles.primaryButton : styles.secondaryButton} disabled={checking || isCurrent} onClick={() => navigate(dashboardUrl)} type="button">{isCurrent ? "Plano atual" : "Selecionar plano"}<ArrowRight size={15} /></button>}
        </article>;
      })}
    </section>
    <section className={styles.footerCard}><div className={styles.footerIcon}><Sparkles size={20} /></div><div><h2>Precisa de ajuda para decidir?</h2><p>A nossa equipa pode recomendar a melhor configuração para a sua rede de farmácias.<span className={styles.supportEmail}>{SUPPORT_EMAIL}</span></p></div><a href={SUPPORT_MAILTO}>Contactar suporte <ArrowRight size={15} /></a></section>
    <footer className={styles.footer}><Users size={14} /> Os limites de farmácias aplicam-se à empresa; os de utilizadores aplicam-se a cada filial.</footer>
  </main>;
}

export default Plans;
