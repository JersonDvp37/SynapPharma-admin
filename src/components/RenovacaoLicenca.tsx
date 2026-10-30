import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import styles from "./RenovacaoLicenca.module.css";

type Provider = "M-Pesa" | "e-Mola";
type Company = { company_id: string; name: string; plan_type: "BASIC" | "PREMIUM"; status: string; expires_at: string | null };
type PaymentResponse = { amount?: number; message?: string; error?: string };

function formatMzn(value: number) {
  return new Intl.NumberFormat("pt-MZ", { style: "currency", currency: "MZN" }).format(value);
}

export function RenovacaoLicenca() {
  const companyId = useMemo(() => new URLSearchParams(window.location.search).get("company_id")?.trim() ?? "", []);
  const [company, setCompany] = useState<Company | null>(null);
  const [provider, setProvider] = useState<Provider>("M-Pesa");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [amount, setAmount] = useState<number | null>(null);

  useEffect(() => {
    if (!companyId) {
      setError("O link de renovacao nao contem o company_id.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error: queryError } = await supabase.from("companies")
        .select("company_id, name, plan_type, status, expires_at")
        .eq("company_id", companyId).maybeSingle();
      if (cancelled) return;
      if (queryError || !data) setError("Nao foi possivel localizar esta empresa.");
      else setCompany(data as Company);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!company) return;
    const normalized = phone.replace(/\D/g, "");
    if (!/^8\d{8}$/.test(normalized) && !/^2588\d{8}$/.test(normalized)) {
      setError("Informe um numero M-Pesa ou e-Mola valido, por exemplo 84 123 4567.");
      return;
    }
    setSubmitting(true);
    const { data, error: functionError } = await supabase.functions.invoke<PaymentResponse>("paysuite-create-payment", {
      body: { company_id: company.company_id, phone: normalized, provider },
    });
    setSubmitting(false);
    if (functionError || data?.error) {
      setError(data?.error ?? "Nao foi possivel iniciar a cobranca.");
      return;
    }
    if (data?.amount) setAmount(data.amount);
    setMessage(data?.message ?? "Pedido enviado. Confirme o PIN no seu telemovel para concluir o pagamento.");
  }

  if (loading) return <main className={styles.page}><section className={styles.card}>A carregar...</section></main>;
  if (error && !company) return <main className={styles.page}><section className={styles.card}><p className={styles.error}>{error}</p></section></main>;
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="title">
        <div className={styles.brand}>Synap Pharma</div>
        <p className={styles.kicker}>RENOVACAO DE LICENCA</p>
        <h1 id="title" className={styles.title}>Continue a utilizar o seu sistema</h1>
        <p className={styles.description}>Informe o seu numero movel. O pedido sera enviado para o {provider} e a confirmacao sera feita no telemovel.</p>
        <div className={styles.companyBox}><span>Empresa</span><strong>{company?.name}</strong><span className={styles.plan}>PLANO {company?.plan_type ?? "BASIC"}</span></div>
        <form onSubmit={submit} className={styles.form}>
          <label htmlFor="provider">Carteira movel</label>
          <select id="provider" value={provider} onChange={(event) => setProvider(event.target.value as Provider)}><option>M-Pesa</option><option>e-Mola</option></select>
          <label htmlFor="phone">Numero do telemovel</label>
          <input id="phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="84 123 4567" inputMode="tel" autoComplete="tel" required />
          {amount !== null && <div className={styles.amount}>Total: {formatMzn(amount)}</div>}
          {error && <p className={styles.error} role="alert">{error}</p>}
          {message && <p className={styles.success} role="status">{message}</p>}
          <button type="submit" disabled={submitting}>{submitting ? "A enviar pedido..." : "Solicitar cobranca"}</button>
        </form>
        <small className={styles.note}>Nunca partilhe o seu PIN. O Synap Pharma nao solicita o PIN por este formulario.</small>
      </section>
    </main>
  );
}