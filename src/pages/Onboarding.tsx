import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import styles from "./Onboarding.module.css";

export function Onboarding() {
  const navigate = useNavigate(); const [email, setEmail] = useState("");
  useEffect(() => { void (async () => { const { data } = await supabase.auth.getUser(); if (!data.user?.email) { navigate("/login", { replace: true }); return; } setEmail(data.user.email.toLowerCase()); })(); }, [navigate]);
  if (!email) return <main className={styles.page}><section className={styles.card}>A verificar conta...</section></main>;
  return <main className={styles.page}><section className={styles.card}><div className={styles.brand}>Synap Pharma</div><p className={styles.kicker}>ATIVACAO DO DESKTOP</p><h1>Ative a filial no aplicativo</h1><p className={styles.description}>A criacao de empresas e filiais acontece no aplicativo JavaFX por chave de ativacao. Depois da ativacao, esta conta ({email}) podera apenas visualizar e monitorizar as filiais sincronizadas.</p><Link className={styles.link} to="/admin">Abrir painel de monitorizacao</Link></section></main>;
}
