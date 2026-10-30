import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import styles from "./Auth.module.css";

export function Register() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [confirmation, setConfirmation] = useState(""); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    if (password.length < 8 || password !== confirmation) { setError("A senha deve ter 8 caracteres e coincidir com a confirmacao."); return; }
    setLoading(true);
    const { data, error: authError } = await supabase.auth.signUp({ email: email.trim().toLowerCase(), password });
    setLoading(false);
    if (authError) { setError(authError.message); return; }
    if (data.session) navigate("/onboarding", { replace: true }); else setMessage("Conta criada. Confirme o email e depois entre para continuar.");
  }
  return <main className={styles.page}><section className={styles.card}><div className={styles.brand}>Synap Pharma</div><p className={styles.kicker}>CRIAR CONTA</p><h1>Comecar no AdminPharma</h1><p className={styles.description}>Crie a conta do administrador da sua farmacia.</p><form className={styles.form} onSubmit={submit}><label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Senha<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>Confirmar senha<input required minLength={8} type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>{error && <p className={styles.error}>{error}</p>}{message && <p className={styles.success}>{message}</p>}<button disabled={loading}>{loading ? "A criar conta..." : "Criar conta"}</button></form><Link to="/login">Ja tenho uma conta</Link></section></main>;
}