import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthGuard } from "./pages/AuthGuard";
import Dashboard from "./pages/Dashboard";
import Plans from "./pages/Plans";
import { Login } from "./pages/Login";
import { Onboarding } from "./pages/Onboarding";
import { Register } from "./pages/Register";
import "./styles/global.css";

createRoot(document.getElementById("app")!).render(<StrictMode><BrowserRouter><Routes><Route path="/register" element={<Register />} /><Route path="/login" element={<Login />} /><Route path="/onboarding" element={<AuthGuard><Onboarding /></AuthGuard>} /><Route path="/admin" element={<AuthGuard><Dashboard /></AuthGuard>} /><Route path="/planos" element={<AuthGuard><Plans /></AuthGuard>} /><Route path="/pagar" element={<Navigate to="/admin" replace />} /><Route path="*" element={<Navigate to="/login" replace />} /></Routes></BrowserRouter></StrictMode>);
