import { useEffect, useMemo, useState } from "react";
import { getPharmacyCloudData, type CloudRecord, type Pharmacy } from "../services/monitoringService";
import styles from "./PharmacyMonitor.module.css";

type PharmacyMonitorProps = {
  companyId: string;
  companyName: string;
  pharmacies: Pharmacy[];
  loading: boolean;
  error: string;
};

type DisplayRow = { id: string; title: string; value: string; date: string };

function isActive(pharmacy: Pharmacy) {
  return pharmacy.licenca_ativa === 1 || pharmacy.licenca_ativa === true;
}

function firstValue(record: CloudRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== null && value !== undefined && String(value).trim() !== "") return String(value);
  }
  return "—";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-MZ", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function productRows(records: CloudRecord[]): DisplayRow[] {
  return records.map((record, index) => ({
    id: String(record.id ?? record.produto_id ?? index),
    title: firstValue(record, ["nome_produto", "produto_nome", "product_name", "nome", "designacao", "descricao"]),
    value: firstValue(record, ["quantidade", "quantity", "stock", "estoque", "saldo"]),
    date: firstValue(record, ["updated_at", "created_at", "data_atualizacao"]),
  }));
}

function saleRows(records: CloudRecord[]): DisplayRow[] {
  return records.map((record, index) => ({
    id: String(record.id ?? record.venda_id ?? index),
    title: firstValue(record, ["numero_venda", "sale_number", "referencia", "id"]),
    value: firstValue(record, ["total", "valor_total", "total_venda", "amount", "valor"]),
    date: firstValue(record, ["created_at", "data_venda", "sale_date", "data"]),
  }));
}

export function PharmacyMonitor({ companyId, companyName, pharmacies, loading, error }: PharmacyMonitorProps) {
  const [selectedId, setSelectedId] = useState("");
  const [products, setProducts] = useState<CloudRecord[]>([]);
  const [sales, setSales] = useState<CloudRecord[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState("");

  const selectedPharmacy = useMemo(() => pharmacies.find((pharmacy) => pharmacy.id === selectedId) ?? null, [pharmacies, selectedId]);
  const activeCount = pharmacies.filter(isActive).length;

  useEffect(() => {
    if (!pharmacies.length) {
      setSelectedId("");
      return;
    }
    if (!pharmacies.some((pharmacy) => pharmacy.id === selectedId)) {
      setSelectedId((pharmacies.find(isActive) ?? pharmacies[0]).id);
    }
  }, [pharmacies, selectedId]);

  useEffect(() => {
    if (!selectedPharmacy) {
      setProducts([]);
      setSales([]);
      setDataError("");
      return;
    }

    let cancelled = false;
    setDataLoading(true);
    setDataError("");
    void getPharmacyCloudData(companyId, selectedPharmacy.id).then((data) => {
      if (cancelled) return;
      setProducts(data.produtos);
      setSales(data.vendas);
      const errors = [data.produtosError && "stock", data.vendasError && "vendas"].filter(Boolean);
      setDataError(errors.length ? `Nao foi possivel carregar os dados de ${errors.join(" e ")}.` : "");
      setDataLoading(false);
    });
    return () => { cancelled = true; };
  }, [companyId, selectedPharmacy]);

  const productDisplayRows = productRows(products);
  const saleDisplayRows = saleRows(sales);

  return (
    <section className={styles.section} aria-labelledby="pharmacies-heading">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>FILIAIS REGISTADAS PELO DESKTOP</span>
          <h2 id="pharmacies-heading">Monitorização de filiais</h2>
          <p>Selecione uma filial para consultar o stock e as vendas sincronizadas da empresa.</p>
        </div>
        <span className={styles.count}>{activeCount} ativa{activeCount === 1 ? "" : "s"}</span>
      </div>

      {loading && <p className={styles.loading}>A carregar filiais registadas pelo desktop...</p>}
      {error && <p className={styles.error}>{error}</p>}
      {!loading && !error && pharmacies.length === 0 && (
        <div className={styles.empty}>
          <strong>Nenhuma filial ativada ainda pelo desktop.</strong>
          <span>Ative o aplicativo desktop com uma chave válida para sincronizar a primeira filial.</span>
        </div>
      )}

      {!loading && !error && pharmacies.length > 0 && (
        <>
          <div className={styles.branchGrid}>
            {pharmacies.map((pharmacy) => {
              const active = isActive(pharmacy);
              const name = pharmacy.nome_filial || pharmacy.pharmacy_name || pharmacy.nome_farmacia || "Filial sem nome";
              return (
                <button className={`${styles.branchCard} ${selectedPharmacy?.id === pharmacy.id ? styles.selected : ""}`} key={pharmacy.id} onClick={() => setSelectedId(pharmacy.id)} type="button">
                  <span className={styles.branchTopline}><strong>{name}</strong><span className={active ? styles.activeBadge : styles.inactiveBadge}>{active ? "Ativa" : "Inativa"}</span></span>
                  <span className={styles.branchCompany}>{pharmacy.nome_farmacia || companyName}</span>
                  <code>pharmacy_id: {pharmacy.pharmacy_id || pharmacy.id}</code>
                </button>
              );
            })}
          </div>

          {selectedPharmacy && (
            <div className={styles.dataPanel}>
              <div className={styles.dataHeader}>
                <div><span className={styles.eyebrow}>FILIAL SELECIONADA</span><h3>{selectedPharmacy.nome_filial || selectedPharmacy.pharmacy_name || "Filial sem nome"}</h3></div>
                <label className={styles.selectLabel}>Alterar filial<select aria-label="Selecionar filial" value={selectedPharmacy.id} onChange={(event) => setSelectedId(event.target.value)}>{pharmacies.map((pharmacy) => <option key={pharmacy.id} value={pharmacy.id}>{pharmacy.nome_filial || pharmacy.pharmacy_name || pharmacy.nome_farmacia || pharmacy.id}</option>)}</select></label>
              </div>

              {dataLoading && <p className={styles.loading}>A carregar dados da filial...</p>}
              {dataError && <p className={styles.error}>{dataError}</p>}
              {!dataLoading && (
                <div className={styles.dataGrid}>
                  <article className={styles.dataCard}><div className={styles.cardHeader}><h3>Stock</h3><span>{productDisplayRows.length} registo{productDisplayRows.length === 1 ? "" : "s"}</span></div>{productDisplayRows.length === 0 ? <p className={styles.muted}>Nenhum produto sincronizado para esta filial.</p> : <div className={styles.tableWrap}><table><thead><tr><th>Produto</th><th>Quantidade</th><th>Atualizado</th></tr></thead><tbody>{productDisplayRows.map((row) => <tr key={row.id}><td>{row.title}</td><td>{row.value}</td><td>{formatDate(row.date)}</td></tr>)}</tbody></table></div>}</article>
                  <article className={styles.dataCard}><div className={styles.cardHeader}><h3>Vendas</h3><span>{saleDisplayRows.length} registo{saleDisplayRows.length === 1 ? "" : "s"}</span></div>{saleDisplayRows.length === 0 ? <p className={styles.muted}>Nenhuma venda sincronizada para esta filial.</p> : <div className={styles.tableWrap}><table><thead><tr><th>Venda</th><th>Total</th><th>Data</th></tr></thead><tbody>{saleDisplayRows.map((row) => <tr key={row.id}><td>{row.title}</td><td>{row.value}</td><td>{formatDate(row.date)}</td></tr>)}</tbody></table></div>}</article>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
