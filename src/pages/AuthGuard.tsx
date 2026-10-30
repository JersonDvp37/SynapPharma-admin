import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export function AuthGuard({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      if (!data.user) navigate("/login", { replace: true });
      setChecking(false);
    });
    return () => { cancelled = true; };
  }, [navigate]);
  if (checking) return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0f141a", color: "#e5e7eb" }}>A verificar sessao...</main>;
  return <>{children}</>;
}