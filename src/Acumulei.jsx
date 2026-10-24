import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { createPortal } from "react-dom";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, ReferenceLine } from "recharts";
import { initializeApp } from "@firebase/app";
import { getDatabase, ref, get, set } from "@firebase/database";
import ativosPadrao from "./data/ativos.json";
import proventosPadrao from "./data/proventos.json";
import evolucaoPadrao from "./data/evolucao.json";

const SHEET_BASE =
  "https://docs.google.com/spreadsheets/d/1sSujoT_tUBA0bHWRpn0aDf59cGpU0tTg3AVzBnFgbUo/export?format=csv&gid=";

const SHEET_GIDS = {
  ativos: "0",
};

const LOCAL_STORAGE_KEY = "acumulei_dados_locais";

const firebaseConfig = {
  apiKey: "AIzaSyCUuuo5LtLCPrQUnW99wJnFVvtVrbhkm2A",
  authDomain: "acumulei-97342.firebaseapp.com",
  databaseURL: "https://acumulei-97342-default-rtdb.firebaseio.com",
  projectId: "acumulei-97342",
  storageBucket: "acumulei-97342.firebasestorage.app",
  messagingSenderId: "340933560074",
  appId: "1:340933560074:web:4c37a408de5f85969d5cf3",
  measurementId: "G-6GJDNWWN5F",
};

const SEED_ATIVOS_URL    = "/dados/ativos.json";
const SEED_PROVENTOS_URL = "/dados/proventos.json";
const SEED_EVOLUCAO_URL  = "/dados/evolucao.json";

function dadosLocaisPadrao() {
  return {
    ativos: { ...ativosPadrao },
    reserva_atual: 0,
    metas: { stocks: 0, reits: 0, acoes: 0, fiis: 0, bitcoins: 0, reservas: 0 },
    proventos: [...proventosPadrao],

    evolucao: [...evolucaoPadrao],
    rentabilidade: [],
  };
}

const CLASSES_ATIVOS = [
  { classe: "stock",   titulo: "Stocks",   sufixo: "stocks"   },
  { classe: "reit",    titulo: "Reits",    sufixo: "reits"    },
  { classe: "acao",    titulo: "Ações",    sufixo: "acoes"    },
  { classe: "fii",     titulo: "Fiis",     sufixo: "fiis"     },
  { classe: "bitcoin", titulo: "Bitcoins", sufixo: "bitcoins" },
];

const ALOCACAO_CLASSES = [
  ...CLASSES_ATIVOS.map(({ sufixo, titulo }) => ({ sufixo, titulo })),
  { sufixo: "reservas", titulo: "Reserva" },
];

const PAGINAS = [
  { id: "patrimonio",     titulo: "Patrimônio"    },
  { id: "investimentos",  titulo: "Investimentos" },
  { id: "financas",       titulo: "Finanças"       },
];

const FILTROS = [
  { texto: "Nome",       key: "nome"                },
  { texto: "Total atual",key: "total_atual"         },
  { texto: "Variação",   key: "variacao_total"      },
  { texto: "Variação %", key: "variacao_percentual" },
  { texto: "% Atual",    key: "porcentagem_atual"   },
];

const COR_ALTA        = "#0a5550";
const COR_BAIXA       = "#8a3535";
const PALETA_ALOCACAO = ["#094945","#0b605b","#0e7771","#118d86","#13a49c","#16bdb4","#19d7cb"];

function toFloat(v) {
  const s = String(v ?? "0").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function fmtBRL(v) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function fmtUSD(v) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
}

function formatarBRLInput(raw) {
  const digitos = String(raw ?? "").replace(/\D/g, "");
  if (!digitos) return "";
  const centavos = parseInt(digitos, 10);
  return (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseBRLInput(formatado) {
  const s = String(formatado ?? "").trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function formatarBRLInputSigned(raw) {
  const str = String(raw ?? "");
  const negativo = str.includes("-");
  const digitos = str.replace(/\D/g, "");
  if (!digitos) return negativo ? "-" : "";
  const centavos = parseInt(digitos, 10);
  const formatado = (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return negativo ? `-${formatado}` : formatado;
}

function parseBRLInputSigned(formatado) {
  const s = String(formatado ?? "").trim();
  if (!s || s === "-") return 0;
  const negativo = s.startsWith("-");
  const n = parseFloat(s.replace(/^-/, "").replace(/\./g, "").replace(",", "."));
  if (isNaN(n)) return 0;
  return negativo ? -n : n;
}

function formatarUSDInput(raw) {
  const digitos = String(raw ?? "").replace(/\D/g, "");
  if (!digitos) return "";
  const centavos = parseInt(digitos, 10);
  return (centavos / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseUSDInput(formatado) {
  const s = String(formatado ?? "").trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function ehClasseEmDolar(classe) {
  return CLASSES_EM_DOLAR.includes(String(classe ?? "").toLowerCase().trim());
}

function formatarMoedaInput(raw, classe) {
  return ehClasseEmDolar(classe) ? formatarUSDInput(raw) : formatarBRLInput(raw);
}

function parseMoedaInput(formatado, classe) {
  return ehClasseEmDolar(classe) ? parseUSDInput(formatado) : parseBRLInput(formatado);
}

function sinal(v) { return v > 0 ? "+" : ""; }

function sinalCompleto(v) { return v > 0 ? "+" : v < 0 ? "-" : ""; }

function sentenceCase(str) {
  const s = String(str ?? "");
  const idx = s.search(/\p{L}/u);
  if (idx === -1) return s;
  return s.slice(0, idx) + s.charAt(idx).toUpperCase() + s.slice(idx + 1).toLowerCase();
}

function corVar(v) {
  if (v > 0) return COR_ALTA;
  if (v < 0) return COR_BAIXA;
  return "var(--color-neutral)";
}

function corHeatmap(pct) {

  if (pct >= 100) return "#063d3a";
  if (pct >= 50)  return "#0a5550";
  if (pct >= 20)  return "#0e7971";
  if (pct >= 0)   return "#16b8ae";

  if (pct >= -20) return "#c0504a";
  if (pct >= -50) return "#8a3535";
  return "#4f1f1f";
}

function calcularRentabilidadeComDiferenca(rentabilidadeBase) {
  const linhas = (rentabilidadeBase ?? [])
    .map(r => ({ ano: String(r.ano ?? "").trim(), valor: toFloat(r.valor) }))
    .filter(r => r.ano)
    .sort((a, b) => parseInt(a.ano, 10) - parseInt(b.ano, 10));

  return linhas.map((r, i) => ({
    ano: r.ano,
    valor: r.valor,
    diferenca: i === 0 ? null : r.valor - linhas[i - 1].valor,
  }));
}

function calcularEvolucaoComDiferenca(evolucaoBase, totalPatrimonioAtual) {
  const anoAtual = String(new Date().getFullYear());

  const linhas = (evolucaoBase ?? [])
    .map(r => ({ ano: String(r.ano ?? "").trim(), valor: toFloat(r.valor) }))
    .filter(r => r.ano)
    .sort((a, b) => parseInt(a.ano, 10) - parseInt(b.ano, 10));

  if (totalPatrimonioAtual != null) {
    const idxAtual = linhas.findIndex(r => r.ano === anoAtual);
    if (idxAtual >= 0) {
      linhas[idxAtual] = { ano: anoAtual, valor: totalPatrimonioAtual };
    } else {
      linhas.push({ ano: anoAtual, valor: totalPatrimonioAtual });
      linhas.sort((a, b) => parseInt(a.ano, 10) - parseInt(b.ano, 10));
    }
  }

  return linhas.map((r, i) => ({
    ano: r.ano,
    valor: r.valor,
    diferenca: i === 0 ? r.valor : r.valor - linhas[i - 1].valor,
  }));
}

function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 1) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const vals = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { vals.push(cur); cur = ""; }
      else cur += ch;
    }
    vals.push(cur);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] ?? "").trim().replace(/^"|"$/g, ""); });
    return obj;
  });
}

async function fetchSheet(gid) {
  const r = await fetch(SHEET_BASE + gid, { cache: "no-store" });
  const t = await r.text();
  return parseCSV(t);
}

async function carregarPlanilha() {
  const entries = await Promise.all(
    Object.entries(SHEET_GIDS).map(async ([k, gid]) => [k, await fetchSheet(gid)])
  );
  return Object.fromEntries(entries);
}

function normalizarDadosLocais(salvoBruto) {
  const salvo = { ...(salvoBruto ?? {}) };
  delete salvo.mensagem;
  delete salvo.sucesso;
  delete salvo.metas_financeiras;
  const ativosSalvos = salvo.ativos ?? {};
  const ativos = Object.keys(ativosSalvos).length > 0 ? ativosSalvos : { ...ativosPadrao };
  const proventosSalvos = salvo.proventos ?? [];
  const proventos = proventosSalvos.length > 0 ? proventosSalvos : [...proventosPadrao];
  const evolucaoSalva = salvo.evolucao ?? [];
  const evolucao = evolucaoSalva.length > 0 ? evolucaoSalva : [...evolucaoPadrao];
  const rentabilidade = salvo.rentabilidade ?? [];
  return {
    ...dadosLocaisPadrao(),
    ...salvo,
    ativos,
    proventos,
    evolucao,
    rentabilidade,
    metas: { ...dadosLocaisPadrao().metas, ...(salvo.metas ?? {}) },
  };
}

function carregarDadosLocais() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return dadosLocaisPadrao();
    return normalizarDadosLocais(JSON.parse(raw));
  } catch {
    return dadosLocaisPadrao();
  }
}

function salvarDadosLocais(dadosLocais) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(dadosLocais));
  } catch (err) {
    console.error("Erro ao salvar dados locais:", err);
  }
}

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

async function carregarDadosLocaisNuvem() {
  try {
    const snapshot = await get(ref(db, "dadosLocais"));
    const data = snapshot.val();
    return (data && typeof data === "object") ? data : {};
  } catch (err) {
    console.error("Erro ao carregar dados da nuvem:", err);
    return null;
  }
}

async function salvarDadosLocaisNuvem(dadosLocais) {
  try {
    await set(ref(db, "dadosLocais"), dadosLocais);
  } catch (err) {
    console.error("Erro ao salvar dados na nuvem:", err);
  }
}

const CLASSES_EM_DOLAR = ["stock", "reit"];

const NOVO_ATIVO_MARCADOR = "__novo_ativo__";

function calcularTaxaDolar(ativosPlanilha) {
  const linhaMoeda = (ativosPlanilha ?? []).find(
    row => String(row.ticker ?? "").trim().toLowerCase() === "dolar"
  );
  return linhaMoeda ? toFloat(linhaMoeda.cotacao) : 1;
}

function buscarExtraAtivo(ativosExtra, ticker) {
  const alvo = String(ticker ?? "").trim();
  if (!alvo) return {};
  if (ativosExtra?.[alvo]) return ativosExtra[alvo];
  const chaveLower = alvo.toLowerCase();
  const chaveEncontrada = Object.keys(ativosExtra ?? {}).find(
    k => k.toLowerCase() === chaveLower
  );
  return chaveEncontrada ? ativosExtra[chaveEncontrada] : {};
}

function montarAtivos(ativosPlanilha, dadosLocais) {

  const taxaDolar = calcularTaxaDolar(ativosPlanilha);

  const tickersDaPlanilha = new Set(
    (ativosPlanilha ?? [])
      .filter(row => String(row.ticker ?? "").trim().toLowerCase() !== "dolar")
      .map(row => String(row.ticker ?? "").trim().toLowerCase())
  );

  const linhas = [
    ...(ativosPlanilha ?? [])
      .filter(row => String(row.ticker ?? "").trim().toLowerCase() !== "dolar")
      .map(row => ({
        ticker: String(row.ticker ?? "").trim(),
        cotacao: toFloat(row.cotacao),
      })),
    ...Object.keys(dadosLocais.ativos ?? {})
      .filter(ticker => !tickersDaPlanilha.has(String(ticker).toLowerCase()))
      .map(ticker => ({
        ticker: String(ticker).trim(),
        cotacao: toFloat(dadosLocais.ativos[ticker]?.cotacao),
      })),
  ];

  const semPercentuais = linhas.map(({ ticker, cotacao }) => {
    const extra = buscarExtraAtivo(dadosLocais.ativos, ticker);
    const quantidade = toFloat(extra.quantidade);
    const preco_medio = toFloat(extra.preco_medio);
    const classe = String(extra.classe || "").toLowerCase().trim();

    const ehDolar = CLASSES_EM_DOLAR.includes(classe);
    const taxa = ehDolar ? taxaDolar : 1;
    const dolar_compra = ehDolar ? toFloat(extra.dolar_compra) : 0;
    // Aportado usa o dólar médio da compra (fixo). Se não informado, cai no dólar atual (comportamento antigo).
    const taxaCompra = ehDolar ? (dolar_compra > 0 ? dolar_compra : taxaDolar) : 1;
    const total_investido = quantidade * preco_medio * taxaCompra;
    const total_atual = quantidade * cotacao * taxa;
    const variacao_total = total_atual - total_investido;
    const variacao_percentual = total_investido > 0 ? (variacao_total / total_investido) * 100 : 0;


    return {
      ticker,
      cotacao,
      nome: extra.nome || ticker,
      classe,
      quantidade,
      preco_medio,
      dolar_compra,
      porcentagem_meta: toFloat(extra.porcentagem_meta),
      total_investido,
      total_atual,
      variacao_total,
      variacao_percentual,
    };
  });

  const totalPorClasse = {};
  semPercentuais.forEach(a => {
    totalPorClasse[a.classe] = (totalPorClasse[a.classe] ?? 0) + a.total_atual;
  });

  return semPercentuais.map(a => {
    const totalClasse = totalPorClasse[a.classe] ?? 0;
    const porcentagem_atual = totalClasse > 0 ? (a.total_atual / totalClasse) * 100 : 0;
    const porcentagem_sobrando_faltando = porcentagem_atual - a.porcentagem_meta;
    return { ...a, porcentagem_atual, porcentagem_sobrando_faltando };
  });
}

function calcularTotais(ativos, reservaAtual, taxaDolar) {
  const t = {};
  let totalInvestimentos = 0;
  let aportadoInvestimentos = 0;

  CLASSES_ATIVOS.forEach(({ classe, sufixo }) => {
    const doClasse = ativos.filter(a => a.classe === classe);
    const total      = doClasse.reduce((s, a) => s + a.total_atual, 0);
    const aportado   = doClasse.reduce((s, a) => s + a.total_investido, 0);
    t[`total_${sufixo}`]          = total;
    t[`total_aportado_${sufixo}`] = aportado;
    t[`diferenca_${sufixo}`]      = total - aportado;
    totalInvestimentos      += total;
    aportadoInvestimentos   += aportado;
  });

  const totalPatrimonio    = totalInvestimentos + reservaAtual;
  const aportadoPatrimonio = aportadoInvestimentos + reservaAtual;
  t.total_patrimonio             = totalPatrimonio;
  t.total_aportado               = aportadoPatrimonio;
  t.total_diferenca_patrimonio   = totalPatrimonio - aportadoPatrimonio;
  t.total_patrimonio_usd         = taxaDolar > 0 ? totalPatrimonio / taxaDolar : 0;

  t.total_investimentos          = totalInvestimentos;
  return [t];
}

function calcularAlocacao(totais, reservaAtual, metas) {
  const t = totais[0] ?? {};
  const totalPatrimonio = toFloat(t.total_patrimonio);
  const a = {};

  ALOCACAO_CLASSES.forEach(({ sufixo }) => {
    const valorAtual = sufixo === "reservas" ? reservaAtual : toFloat(t[`total_${sufixo}`]);
    const pctAtual    = totalPatrimonio > 0 ? (valorAtual / totalPatrimonio) * 100 : 0;
    const pctIdeal    = toFloat(metas[sufixo]);
    a[`alocacao_atual_${sufixo}`]      = pctAtual;
    a[`alocacao_ideal_${sufixo}`]      = pctIdeal;
    a[`alocacao_diferenca_${sufixo}`]  = pctAtual - pctIdeal;
  });

  return [a];
}

function Card({ children, className = "", style = {} }) {
  return (
    <div className={`card ${className}`} style={style}>
      {children}
    </div>
  );
}

function SubCard({ children, className = "", style = {}, id, ...rest }) {
  return (
    <div id={id} className={`subcard ${className}`} style={style} {...rest}>
      {children}
    </div>
  );
}

function HeroValor({ titulo, valor, cor, visible = true, className = "" }) {
  return (
    <div className={`hero-valor ${className}`}>
      <span className="campo-titulo hero-valor-titulo">{titulo}</span>
      <span
        className="campo-valor hero-valor-valor animated-value"
        style={{
          ...(cor ? { color: cor } : {}),
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(10px)",
          transition: "opacity 0.55s cubic-bezier(0.22,1,0.36,1), transform 0.55s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {valor}
      </span>
    </div>
  );
}

function ListRow({ label, tag, value, valueColor, sub, subColor, onClick, onMouseEnter, onMouseLeave, chevron = false, plain = false, highlight = false, highlightColor }) {
  return (
    <div
      className={`list-row${plain ? " list-row-plain" : ""}${onClick ? " list-row-clickable" : ""}${highlight ? " list-row-filtrado" : ""}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={highlight && highlightColor ? { "--hl-bg": `${highlightColor}22`, "--hl-border": `${highlightColor}80` } : undefined}
    >
      <div className="list-row-left">
        <span className="list-row-label">{label}</span>
        {tag && <span className="list-row-tag">{tag}</span>}
      </div>
      <div className="list-row-right">
        <div className="list-row-values">
          <span className="list-row-value" style={valueColor ? { color: valueColor } : {}}>{value}</span>
          {sub && <span className="list-row-sub" style={subColor ? { color: subColor } : {}}>{sub}</span>}
        </div>
        {chevron && (
          <svg className="list-row-chevron" width="7" height="12" viewBox="0 0 7 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </div>
  );
}

function criarBrilho(e, btn) {
  if (!btn) return;
  btn.classList.remove("click-glow");

  void btn.offsetWidth;
  btn.classList.add("click-glow");
  const onEnd = () => {
    btn.classList.remove("click-glow");
    btn.removeEventListener("animationend", onEnd);
  };
  btn.addEventListener("animationend", onEnd);
}

function BotaoFiltro({ children, onClick, ativo, seta, open }) {
  const btnRef = useRef(null);

  const handleClick = (e) => {
    criarBrilho(e, btnRef.current);
    onClick?.(e);
  };

  return (
    <button
      className={`btn-filtro-simples${ativo ? " btn-filtro-simples-ativo" : ""}`}
      onClick={handleClick}
    >
      <span ref={btnRef} className="btn-texto">{children}</span>
      {seta && (
        <svg className={`btn-ver-icon ${open ? "is-open" : ""}`} width="12" height="7" viewBox="0 0 12 7" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L6 6L11 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
}

function BotaoFiltroTrigger({ children, onClick, ativo, open }) {
  const btnRef = useRef(null);

  const handleClick = (e) => {
    criarBrilho(e, btnRef.current);
    onClick?.(e);
  };

  return (
    <button
      className={`btn-filtro-simples dropdown-trigger${ativo ? " btn-filtro-simples-ativo" : ""}`}
      onClick={handleClick}
      aria-expanded={open}
      aria-label="Filtrar"
    >
      <span ref={btnRef} className="btn-texto">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="6" x2="20" y2="6" />
          <circle cx="9" cy="6" r="2" fill="var(--bg3)" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <circle cx="15" cy="12" r="2" fill="var(--bg3)" />
          <line x1="4" y1="18" x2="20" y2="18" />
          <circle cx="11" cy="18" r="2" fill="var(--bg3)" />
        </svg>
        {children}
      </span>
    </button>
  );
}

function BotaoVer({ onClick, open }) {
  const btnRef = useRef(null);

  const handleClick = (e) => {
    criarBrilho(e, btnRef.current);
    onClick?.(e);
  };

  return (
    <button className="btn-tema" onClick={handleClick} aria-label={open ? "Ocultar" : "Ver mais"}>
      <span ref={btnRef} className="btn-texto">
        <svg className={`btn-ver-icon ${open ? "is-open" : ""}`} width="12" height="7" viewBox="0 0 12 7" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L6 6L11 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    </button>
  );
}

function Expandable({ open, children }) {
  const wrapRef = useRef(null);
  const estadoAnteriorRef = useRef(undefined);

  const getParentGap = (el) => {
    const parent = el?.parentElement;
    if (!parent) return 0;
    const g = getComputedStyle(parent).rowGap || getComputedStyle(parent).gap;
    const n = parseFloat(g);
    return isNaN(n) ? 0 : n;
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const anterior = estadoAnteriorRef.current;
    estadoAnteriorRef.current = open;

    if (anterior === undefined || anterior === open) {
      el.style.transition = "none";
      if (open) {
        el.style.height = "auto";
        el.style.opacity = "1";
        el.style.marginTop = "0px";
        el.style.marginBottom = "0px";
      } else {
        el.style.height = "0px";
        el.style.opacity = "0";
        const gap = getParentGap(el);
        el.style.marginTop = `-${gap / 2}px`;
        el.style.marginBottom = `-${gap / 2}px`;
      }
      return;
    }

    if (open) {
      el.style.marginTop = "0px";
      el.style.marginBottom = "0px";
      el.style.height = "0px";
      el.style.opacity = "0";
      void el.offsetHeight;
      const target = el.scrollHeight;
      el.style.transition = "height 0.42s cubic-bezier(0.4,0,0.2,1), opacity 0.32s cubic-bezier(0.4,0,0.2,1) 0.06s, margin 0.42s cubic-bezier(0.4,0,0.2,1)";
      el.style.height = target + "px";
      el.style.opacity = "1";
      const t = setTimeout(() => {
        if (el) el.style.height = "auto";
      }, 440);
      return () => clearTimeout(t);
    } else {
      const current = el.scrollHeight;
      el.style.height = current + "px";
      el.style.opacity = "1";
      void el.offsetHeight;
      el.style.transition = "height 0.38s cubic-bezier(0.4,0,0.2,1), opacity 0.22s cubic-bezier(0.4,0,0.2,1), margin 0.38s cubic-bezier(0.4,0,0.2,1)";
      el.style.height = "0px";
      el.style.opacity = "0";
      const gap = getParentGap(el);
      el.style.marginTop = `-${gap / 2}px`;
      el.style.marginBottom = `-${gap / 2}px`;
    }
  }, [open]);

  return (
    <div
      ref={wrapRef}
      style={{
        height: 0,
        overflow: "hidden",
        opacity: 0,
        // respiro lateral p/ sombras/glow dos botões não serem cortados pelo overflow:hidden
        paddingLeft: 12,
        paddingRight: 12,
        marginLeft: -12,
        marginRight: -12,
        willChange: "height, opacity, margin",
      }}
    >
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div className="spinner-wrap">
      <div className="spinner" />
    </div>
  );
}

function Loading({ tema }) {
  const [logoErr, setLogoErr] = useState(false);

  return (
    <div className="loading-page">
      <div className="loading-box">
        {logoErr ? (
          <div className="loading-logo loading-logo-breathe">V</div>
        ) : (
          <img
            src="/assets/logo.png"
            alt="Acumulei logo"
            onError={() => setLogoErr(true)}
            className="loading-logo-breathe loading-logo-img"
          />
        )}
        <Spinner />
        <p className="loading-texto">Carregando dados...</p>
      </div>
    </div>
  );
}

function LogoAtivo({ ticker, size = 72, offsetX = 0, className = "" }) {
  const [src, setSrc] = useState(() => `/logos_ativos/${String(ticker).toUpperCase()}.png`);
  const [estagio, setEstagio] = useState("local");

  useEffect(() => {
    setSrc(`/logos_ativos/${String(ticker).toUpperCase()}.png`);
    setEstagio("local");
  }, [ticker]);

  function handleErro() {
    setEstagio("letra");
  }

  if (estagio === "letra") {
    return (
      <div className={className} style={{
        width: size, height: size, background: "var(--accent)",
        borderRadius: 14, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: size * 0.42,
        fontWeight: 500, color: "#f5f5f7", flexShrink: 0,
        marginLeft: offsetX,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif'
      }}>
        {String(ticker)[0]}
      </div>
    );
  }
  return (
    <img
      className={className}
      src={src}
      alt={ticker}
      width={size} height={size}
      onError={handleErro}
      style={{ borderRadius: 12, objectFit: "contain", flexShrink: 0, marginLeft: offsetX }}
    />
  );
}

// Mantém o popup montado por um instante após fechar, para tocar a animação de saída.
function usePresenca(aberto, ms = 220) {
  const [montado, setMontado] = useState(aberto);
  useEffect(() => {
    if (aberto) { setMontado(true); return; }
    const t = setTimeout(() => setMontado(false), ms);
    return () => clearTimeout(t);
  }, [aberto, ms]);
  return aberto || montado;
}

function Navbar({ scrolled, ativos, onSelectTicker, pagina, onNavigate, tema, iaAberto, iaOcupado, onToggleIA }) {
  const [logoErr, setLogoErr]       = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery]           = useState("");
  const [menuAberto, setMenuAberto] = useState(false);
  const menuVisivel = usePresenca(menuAberto);
  const searchRef                   = useRef(null);
  const inputRef                    = useRef(null);
  const menuRef                     = useRef(null);
  const navRef                      = useRef(null);
  const [menuTop, setMenuTop]       = useState(0);

  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e) => {
      if (!e.target.closest(".navbar") && !e.target.closest(".navbar-search-box")) {
        setSearchOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [searchOpen]);

  useEffect(() => {
    if (!menuAberto) return;
    const medir = () => {
      const r = navRef.current?.getBoundingClientRect();
      if (r) setMenuTop(r.bottom + 8);
    };
    medir();
    const fechar = () => setMenuAberto(false);
    const onKey = (e) => { if (e.key === "Escape") setMenuAberto(false); };
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", fechar, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", medir);
      window.removeEventListener("scroll", fechar);
    };
  }, [menuAberto]);

  useEffect(() => {
    if (searchOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [searchOpen]);

  const searchBoxVisivel = searchOpen;
  const [searchBoxPos, setSearchBoxPos] = useState(null);
  const searchBoxRef    = useRef(null);
  const searchOffsetRef = useRef(0);
  const SEARCH_GAP      = 10; // px entre a barra superior e a caixa (mesma distância do popup do assistente)

  // Confere a posição real da caixa e corrige qualquer diferença em relação ao espaçamento desejado
  useEffect(() => {
    if (!searchBoxPos) return;
    const nav = navRef.current?.getBoundingClientRect();
    const box = searchBoxRef.current?.getBoundingClientRect();
    if (!nav || !box) return;
    const delta = (nav.bottom + SEARCH_GAP) - box.top;
    if (Math.abs(delta) > 0.5) {
      searchOffsetRef.current += delta;
      setSearchBoxPos(p => (p ? { ...p, top: p.top + delta } : p));
    }
  }, [searchBoxPos]);

  useEffect(() => {
    if (!searchBoxVisivel) { setSearchBoxPos(null); return; }
    const medir = () => {
      const nav = navRef.current?.getBoundingClientRect();
      const inp = searchRef.current?.getBoundingClientRect();
      if (!nav || !inp) return;
      setSearchBoxPos({ top: nav.bottom + SEARCH_GAP + searchOffsetRef.current, left: inp.left, width: inp.width, navLeft: nav.left, navRight: nav.right });
    };
    medir();
    const nav = navRef.current;
    const ro = typeof ResizeObserver !== "undefined" && nav ? new ResizeObserver(medir) : null;
    if (ro) ro.observe(nav);
    nav?.addEventListener("transitionend", medir);
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, { passive: true });
    return () => {
      ro?.disconnect();
      nav?.removeEventListener("transitionend", medir);
      window.removeEventListener("resize", medir);
      window.removeEventListener("scroll", medir);
    };
  }, [searchBoxVisivel, scrolled]);

  const resultados = query.trim().length >= 1
    ? (ativos ?? []).filter(a =>
        String(a.ticker ?? "").toLowerCase().includes(query.toLowerCase()) ||
        String(a.nome   ?? "").toLowerCase().includes(query.toLowerCase())
      ).slice(0, 6)
    : [];

  const [indiceAtivo, setIndiceAtivo] = useState(-1);

  useEffect(() => { setIndiceAtivo(-1); }, [query]);

  useEffect(() => {
    if (indiceAtivo < 0) return;
    searchBoxRef.current
      ?.querySelector(`[data-search-idx="${indiceAtivo}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [indiceAtivo]);

  const selecionarResultado = (a) => {
    const sufixo = CLASSES_ATIVOS.find(
      c => String(a.classe).toLowerCase().trim() === c.classe
    )?.sufixo;

    if (sufixo) onSelectTicker(a.ticker);

    setSearchOpen(false);
    setQuery("");
  };

  const onKeyDownBusca = (e) => {
    if (e.key === "Escape") {
      setSearchOpen(false);
      setQuery("");
      return;
    }
    if (resultados.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndiceAtivo(i => (i + 1) % resultados.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndiceAtivo(i => (i <= 0 ? resultados.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      selecionarResultado(resultados[indiceAtivo >= 0 ? indiceAtivo : 0]);
    }
  };

  return (
    <nav ref={navRef} className={`navbar ${scrolled ? "navbar-scrolled" : ""}`}>
      <div className="navbar-inner">

        <div className="navbar-left">

          {logoErr ? (
            <span className="navbar-logo">V</span>
          ) : (
            <img src="/assets/logo.png" alt="Acumulei" className="navbar-logo-img"
              onError={() => setLogoErr(true)} />
          )}
        </div>

        <div className="navbar-nav">
          <div className="navbar-tabs">
            {PAGINAS.map(p => (
              <button
                key={p.id}
                className={`navbar-tab${pagina === p.id ? " navbar-tab-ativo" : ""}`}
                onClick={() => onNavigate(p.id)}
              >
                {p.titulo}
              </button>
            ))}
          </div>
        </div>

        <div className="navbar-right">

        <div className="navbar-hamburger-wrap" ref={menuRef}>
          <button
            className="btn-tema navbar-hamburger"
            onClick={() => setMenuAberto(o => !o)}
            aria-label="Menu de navegação"
            title="Navegação"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          {menuVisivel && createPortal(
            <>
              <div className="navbar-menu-backdrop" onClick={() => setMenuAberto(false)} />
              <div className="navbar-menu-dropdown" style={{ top: menuTop }} role="menu" {...(!menuAberto ? { "data-saindo": "" } : {})}>
                {PAGINAS.map(p => (
                  <button
                    key={p.id}
                    role="menuitem"
                    className={`navbar-menu-overlay-item${pagina === p.id ? " is-ativo" : ""}`}
                    onClick={() => { onNavigate(p.id); setMenuAberto(false); }}
                  >
                    {p.titulo}
                  </button>
                ))}
                <button
                  role="menuitem"
                  className={`navbar-menu-overlay-item${pagina === "configuracoes" ? " is-ativo" : ""}`}
                  onClick={() => { onNavigate("configuracoes"); setMenuAberto(false); }}
                >
                  Configurações
                </button>
              </div>
            </>,
            document.body
          )}
        </div>

        <button
          data-ia-btn
          className={`btn-tema navbar-ia-btn${iaAberto ? " btn-tema-ativo" : ""}`}
          onClick={onToggleIA}
          aria-label="Assistente de IA"
          aria-expanded={iaAberto}
          title="Assistente de IA"
        >
          <img src="/assets/icone_ia.png" alt="" width="25" height="25" className="navbar-ia-img" draggable="false" />
          {iaOcupado && !iaAberto && <span className="navbar-ia-badge" />}
        </button>

        {pagina === "investimentos" && (
        <div style={{ position: "relative" }} ref={searchRef}>
          <button
            className={`btn-tema${searchOpen ? " btn-tema-ativo" : ""}`}
            title="Buscar ativo"
            onClick={() => { setSearchOpen(o => !o); setQuery(""); }}
            aria-label="Buscar ativo"
            aria-expanded={searchOpen}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>

          {searchBoxVisivel && searchBoxPos && createPortal(
            <div
              ref={searchBoxRef}
              className="navbar-search-box"
              style={
                window.innerWidth > 640
                  ? { position: "fixed", top: searchBoxPos.top, left: "auto", right: Math.max(12, document.documentElement.clientWidth - searchBoxPos.navRight), width: 320 }
                  : (Number.isFinite(searchBoxPos.navLeft) && Number.isFinite(searchBoxPos.navRight)
                      ? { top: searchBoxPos.top, left: searchBoxPos.navLeft, width: searchBoxPos.navRight - searchBoxPos.navLeft }
                      : { top: searchBoxPos.top })
              }
            >
              <input
                ref={inputRef}
                className="navbar-search-input"
                placeholder="Buscar ativo..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={onKeyDownBusca}
              />

              {resultados.length > 0 && (
                <div className="navbar-search-results">
                  {resultados.map((a, i) => (
                    <button
                      key={i}
                      data-search-idx={i}
                      className={`navbar-search-item${i === indiceAtivo ? " is-ativo" : ""}`}
                      onMouseEnter={() => setIndiceAtivo(i)}
                      onClick={() => selecionarResultado(a)}
                    >
                      <LogoAtivo ticker={a.ticker} size={28} />

                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 1,
                          textAlign: "left"
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: "var(--color-value)"
                          }}
                        >
                          {a.ticker}
                        </span>

                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--color-label)"
                          }}
                        >
                          {a.nome}
                        </span>
                      </div>

                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 11,
                          color: "var(--color-label)"
                        }}
                      >
                        {String(a.classe ?? "")}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {query.trim().length >= 1 && resultados.length === 0 && (
                <div className="navbar-search-results">
                  <div
                    style={{
                      padding: "var(--space-3) var(--space-4)",
                      color: "var(--color-label)",
                      fontSize: 13
                    }}
                  >
                    Nenhum ativo encontrado
                  </div>
                </div>
              )}
            </div>,
            document.body
          )}

          </div>
        )}

        <button
          className={`btn-tema navbar-config-btn${pagina === "configuracoes" ? " btn-tema-ativo" : ""}`}
          onClick={() => onNavigate("configuracoes")}
          aria-label="Configurações"
          title="Configurações"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <circle cx="12" cy="12" r="2.8" />
          </svg>
        </button>

        </div>

      </div>

    </nav>
  );
}

function BotaoTopoFlutuante({ scrolled, onTop }) {
  return (
    <button
      className={`btn-topo-flutuante ${scrolled ? "btn-topo-flutuante-visible" : ""}`}
      onClick={onTop}
      title="Voltar ao Topo"
      aria-label="Voltar ao topo"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      </svg>
    </button>
  );
}

const ANOS_PADRAO_HISTORICO = 8;

// Área rolável na horizontal para gráficos anuais: em telas pequenas mostra
// os últimos 8 anos na tela e, havendo mais, o gráfico rola com o dedo;
// em telas grandes ocupa 100% da largura. Abre já rolado até o ano mais recente.
// Se `children` for uma função, recebe o centro horizontal da área visível
// (em px, dentro do gráfico) em telas pequenas, ou null em telas grandes.
// Serve para centralizar os tooltips na tela.
function GraficoRolavel({ qtd, children, style = {} }) {
  const ref = useRef(null);
  const [centro, setCentro] = useState(null);
  const [tip, setTip] = useState(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [qtd]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => {
      const pequena = window.innerWidth <= 640;
      const novo = pequena ? Math.round(el.scrollLeft + el.clientWidth / 2) : null;
      setCentro(c => (c === novo ? c : novo));
      if (!pequena) setTip(null);
    };
    medir();
    el.addEventListener("scroll", medir, { passive: true });
    window.addEventListener("resize", medir);
    return () => {
      el.removeEventListener("scroll", medir);
      window.removeEventListener("resize", medir);
    };
  }, [qtd]);

  // O tooltip em telas pequenas é desenhado aqui, fora da área rolável, sempre
  // centralizado na largura visível (o Recharts não consegue centralizar sozinho).
  return (
    <div style={{ position: "relative", width: "100%", ...style }}>
      <div ref={ref} className="grafico-rolavel">
        <div className="grafico-rolavel-inner" style={{ "--n-anos": qtd }}>
          {typeof children === "function" ? children(centro, setTip) : children}
        </div>
      </div>
      {centro != null && tip && (
        <div style={{
          position: "absolute", left: "50%", top: 4, transform: "translateX(-50%)",
          maxWidth: "calc(100% - 8px)", pointerEvents: "none", zIndex: 10,
        }}>
          {tip}
        </div>
      )}
    </div>
  );
}

// Conteúdo "invisível" do Tooltip do Recharts: repassa o tooltip ativo ao GraficoRolavel.
function TooltipPonte({ active, payload, label, onChange, Comp }) {
  const ativo = !!active && !!payload?.length;
  const v0 = payload?.[0]?.value;
  const v1 = payload?.[1]?.value;
  useEffect(() => {
    onChange(ativo ? <Comp active payload={payload} label={label} /> : null);
  }, [ativo, label, v0, v1]);
  return null;
}

function SeletorAno({ anos, anoInicio, onChange }) {
  const [open, setOpen] = useState(false);
  const visivel = usePresenca(open);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const atualizarPos = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const cardRect = triggerRef.current?.closest(".subcard")?.getBoundingClientRect();

    setPos({
      top: rect.bottom + 8,
      left: rect.left,
      width: rect.width,
      height: cardRect ? cardRect.height * 0.65 : 0,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    atualizarPos();
    const handleClickFora = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) setOpen(false);
    };
    window.addEventListener("scroll", atualizarPos, true);
    window.addEventListener("resize", atualizarPos);
    document.addEventListener("mousedown", handleClickFora);
    return () => {
      window.removeEventListener("scroll", atualizarPos, true);
      window.removeEventListener("resize", atualizarPos);
      document.removeEventListener("mousedown", handleClickFora);
    };
  }, [open, atualizarPos]);

  if (!anos?.length) return null;

  return (
    <div className="dropdown-wrap" ref={triggerRef} style={{ marginLeft: "-6px" }}>
      <BotaoFiltroTrigger open={open} onClick={() => setOpen(o => !o)}>
        <span className="dropdown-trigger-sub">Desde {anoInicio}</span>
      </BotaoFiltroTrigger>
      {visivel && createPortal(
        <div
          ref={menuRef}
          className="dropdown-menu dropdown-menu-flutuante dropdown-menu-select dropdown-menu-anos"
          style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.height || undefined }}
          {...(!open ? { "data-saindo": "" } : {})}
        >
          {anos.map(ano => (
            <button
              key={ano}
              className={`dropdown-item${ano === anoInicio ? " is-ativo" : ""}`}
              onClick={() => { onChange(ano); setOpen(false); }}
            >
              {ano}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

function SeletorForm({ value, onChange, options, placeholder = "Selecione..." }) {
  const [open, setOpen] = useState(false);
  const visivel = usePresenca(open);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const atualizarPos = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => {
    if (!open) return;
    atualizarPos();
    const handleClickFora = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) setOpen(false);
    };
    window.addEventListener("scroll", atualizarPos, true);
    window.addEventListener("resize", atualizarPos);
    document.addEventListener("mousedown", handleClickFora);
    return () => {
      window.removeEventListener("scroll", atualizarPos, true);
      window.removeEventListener("resize", atualizarPos);
      document.removeEventListener("mousedown", handleClickFora);
    };
  }, [open, atualizarPos]);

  const selecionado = options.find(o => o.value === value);

  return (
    <div ref={triggerRef}>
      <button
        type="button"
        className={`form-input form-select${open ? " form-select-aberto" : ""}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span style={{ color: selecionado ? "var(--color-value)" : "var(--color-label)" }}>
          {selecionado ? selecionado.label : placeholder}
        </span>
      </button>
      {visivel && createPortal(
        <div
          ref={menuRef}
          className="dropdown-menu dropdown-menu-flutuante dropdown-menu-select"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
          {...(!open ? { "data-saindo": "" } : {})}
        >
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              className={`dropdown-item${o.value === value ? " is-ativo" : ""}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

function CardPatrimonio({ totais, evolucao, onEditarEvolucao }) {

  const total = toFloat(totais?.[0]?.total_patrimonio);

  const dataEvolucaoBruta = calcularEvolucaoComDiferenca(evolucao, total)
    .map(row => ({ ano: row.ano, valor: row.valor, diff: row.diferenca }));
  const temEvolucao = dataEvolucaoBruta.length > 0;

  if (!totais?.length) return null;
  const t = totais[0];
  const aportado  = toFloat(t.total_aportado);
  const diff      = toFloat(t.total_diferenca_patrimonio);
  const totalUSD  = toFloat(t.total_patrimonio_usd);

  const corDiff = corVar(diff);

  const pctVariacao  = aportado > 0 ? Math.abs(diff) / aportado * 100 : 0;

  const dataEvolucao = dataEvolucaoBruta;

  const primeiroEvolucao = dataEvolucao[0];
  const ultimoEvolucao   = dataEvolucao[dataEvolucao.length - 1];
  const anosCrescimento  = dataEvolucao.length > 1
    ? parseInt(ultimoEvolucao.ano, 10) - parseInt(primeiroEvolucao.ano, 10)
    : 0;
  const mediaCrescimentoAnual = (anosCrescimento > 0 && primeiroEvolucao?.valor > 0)
    ? (((ultimoEvolucao.valor - primeiroEvolucao.valor) / primeiroEvolucao.valor) * 100) / anosCrescimento
    : 0;
  const mediaCrescimentoAnualReais = anosCrescimento > 0
    ? (ultimoEvolucao.valor - primeiroEvolucao.valor) / anosCrescimento
    : 0;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo">Patrimônio</h2>
        </SubCard>
        {onEditarEvolucao && (
          <button className="btn-tema" onClick={onEditarEvolucao} aria-label="Editar evolução do patrimônio" title="Editar evolução do patrimônio">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
            </svg>
          </button>
        )}
      </div>

      <SubCard>
        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">Atual</span>
          </div>
          <div className="list-row-right">
            <span className="list-row-value">{fmtBRL(total)}</span>
          </div>
        </div>

        <ListRow label="Aportado" value={fmtBRL(aportado)} plain />

        {!!totalUSD && (
          <ListRow label="Atual em USD" value={fmtUSD(totalUSD)} plain />
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
            <ListRow
              label="Variação"
              value={`${sinal(diff)}${fmtBRL(diff)} (${pctVariacao.toFixed(1)}%)`}
              valueColor={corDiff}
              plain
            />
          </div>
        </div>
      </SubCard>

      {temEvolucao && (
        <SubCard style={{ overflow: "hidden" }}>
          <HeroValor titulo="Patrimônio atual" valor={fmtBRL(total)} visible={!!total} />
          <div
            className="campo-titulo"
            style={{
              marginTop: "var(--space-2)",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              opacity: anosCrescimento > 0 ? 1 : 0,
              transition: "opacity 0.55s cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            Média anual
            <span style={{ color: corVar(mediaCrescimentoAnualReais), fontWeight: 600 }}>
              {sinal(mediaCrescimentoAnualReais)}{fmtBRL(mediaCrescimentoAnualReais)} ({sinal(mediaCrescimentoAnual)}{mediaCrescimentoAnual.toFixed(2)}%)
            </span>
          </div>
          <GraficoRolavel qtd={dataEvolucao.length} style={{ marginTop: "var(--space-3)" }}>
          {(centro, setTip) => (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={dataEvolucao} margin={{ top: 12, right: 12, left: 12, bottom: 4 }}>
              <defs>
                <linearGradient id="gradEv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={COR_ALTA} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={COR_ALTA} stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="ano" tick={<EvolucaoXTick />} axisLine={false} tickLine={false} interval={0} />
              <YAxis hide />
              <Tooltip
                content={centro != null
                  ? <TooltipPonte onChange={setTip} Comp={CustomTooltipEvolucao} />
                  : <CustomTooltipEvolucao />}
              />
              <Area type="monotone" dataKey="valor" stroke={COR_ALTA} strokeWidth={2.5}
                fill="url(#gradEv)" dot={{ fill: COR_ALTA, r: 4 }}
                activeDot={{ r: 6, fill: COR_ALTA }}
              />
              <Area type="monotone" dataKey="diff" stroke="none" fill="none" dot={false} activeDot={false} legendType="none" />
            </AreaChart>
          </ResponsiveContainer>
          )}
          </GraficoRolavel>
        </SubCard>
      )}
    </Card>
  );
}

function classeTT(v) { return v > 0 ? "tt-pos" : v < 0 ? "tt-neg" : "tt-neu"; }

// Tooltip padrão dos gráficos anuais: ano, valor em destaque e linhas de detalhe.
function TooltipGrafico({ titulo, valor, valorClasse = "", linhas = [], style, className = "" }) {
  return (
    <div className={`chart-tooltip tt-card ${className}`} style={style}>
      <div className="tt-titulo">{titulo}</div>
      <div className={`tt-valor ${valorClasse}`}>{valor}</div>
      {linhas.length > 0 && (
        <div className="tt-bloco">
          {linhas.map(l => (
            <div className="tt-linha" key={l.rotulo}>
              <span className="tt-rotulo">{l.rotulo}</span>
              <span className={`tt-dado ${l.classe ?? ""}`}>{l.texto}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Em telas pequenas o wrapper do Recharts é posicionado no centro da área visível
// (prop `position`); o conteúdo se centraliza em torno desse ponto.
const ESTILO_TT_CENTRADO = { position: "absolute", left: 0, top: 0, transform: "translateX(-50%)" };

function CustomTooltipEvolucao({ active, payload, label, centrado = false }) {
  if (!active || !payload?.length) return null;
  const valor = payload[0].value;
  const diff  = payload[1]?.value;
  // no primeiro ano a "diferença" é o próprio valor, então não há comparação a mostrar
  const temComp = diff != null && Math.abs(diff - valor) > 0.005;
  const anterior = temComp ? valor - diff : 0;
  const pct = anterior > 0 ? (diff / anterior) * 100 : null;
  const linhas = temComp ? [{
    rotulo: "vs. ano anterior",
    classe: classeTT(diff),
    texto: `${sinalCompleto(diff)}${fmtBRL(Math.abs(diff))}${pct != null ? ` (${sinalCompleto(pct)}${Math.abs(pct).toFixed(1).replace(".", ",")}%)` : ""}`,
  }] : [];
  return <TooltipGrafico titulo={label} valor={fmtBRL(valor)} linhas={linhas} style={centrado ? ESTILO_TT_CENTRADO : undefined} />;
}

function EvolucaoXTick({ x, y, payload }) {
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 640;
  const fontSize = isMobile ? "clamp(8px, 1.8vw, 10px)" : 10;
  return (
    <text x={x} y={y + 10} textAnchor="middle" fill="#9a9d9c" fontSize={fontSize} fontFamily='-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif'>
      {payload.value}
    </text>
  );
}

function CustomTooltipRentabilidade({ active, payload, label, centrado = false }) {
  if (!active || !payload?.length) return null;
  const valor = payload[0].value;
  const diff  = payload[1]?.value;
  const pp = (v) => `${sinalCompleto(v)}${Math.abs(v).toFixed(2).replace(".", ",")}`;
  const linhas = diff != null ? [{
    rotulo: "vs. ano anterior",
    classe: classeTT(diff),
    texto: `${pp(diff)} p.p.`,
  }] : [];
  return <TooltipGrafico titulo={label} valor={`${pp(valor)}%`} valorClasse={classeTT(valor)} linhas={linhas} style={centrado ? ESTILO_TT_CENTRADO : undefined} />;
}

function CardRentabilidade({ rentabilidade, onEditarRentabilidade }) {
  const dataRentBruta = calcularRentabilidadeComDiferenca(rentabilidade);
  const temRentabilidade = dataRentBruta.length > 0;

  const dataRent = dataRentBruta
    .map(d => ({ ano: d.ano, valor: d.valor, diff: d.diferenca }));

  const acumulada = dataRent.length > 0
    ? (dataRent.reduce((acc, d) => acc * (1 + d.valor / 100), 1) - 1) * 100
    : 0;

  const anosDecorridosRent = dataRent.length > 1
    ? parseInt(dataRent[dataRent.length - 1].ano, 10) - parseInt(dataRent[0].ano, 10)
    : 0;
  const mediaAnual = anosDecorridosRent > 0
    ? acumulada / anosDecorridosRent
    : 0;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo">Rentabilidade</h2>
        </SubCard>
      </div>

      {temRentabilidade ? (
        <>
          <SubCard style={{ overflow: "hidden" }}>
            <HeroValor
              titulo="Rentabilidade acumulada"
              valor={`${sinal(acumulada)}${acumulada.toFixed(2)}%`}
              cor="var(--color-mono)"
              visible={dataRent.length > 0}
            />
            <div
              className="campo-titulo"
              style={{
                marginTop: "var(--space-2)",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                opacity: dataRent.length > 0 ? 1 : 0,
                transition: "opacity 0.55s cubic-bezier(0.22,1,0.36,1)",
              }}
            >
              Média anual
              <span style={{ color: corVar(mediaAnual), fontWeight: 600 }}>
                {sinal(mediaAnual)}{mediaAnual.toFixed(2)}%
              </span>
            </div>
            <GraficoRolavel qtd={dataRent.length} style={{ marginTop: "var(--space-3)" }}>
            {(centro, setTip) => (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={dataRent} margin={{ top: 12, right: 12, left: 12, bottom: 4 }}>
                <defs>
                  <linearGradient id="gradRent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={COR_ALTA} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COR_ALTA} stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="ano" tick={<EvolucaoXTick />} axisLine={false} tickLine={false} interval={0} />
                <YAxis hide />
                <ReferenceLine y={0} stroke="var(--border2)" strokeDasharray="3 3" />
                <Tooltip
                  content={centro != null
                    ? <TooltipPonte onChange={setTip} Comp={CustomTooltipRentabilidade} />
                    : <CustomTooltipRentabilidade />}
                />
                <Area type="monotone" dataKey="valor" stroke={COR_ALTA} strokeWidth={2.5}
                  fill="url(#gradRent)" dot={{ fill: COR_ALTA, r: 4 }}
                  activeDot={{ r: 6, fill: COR_ALTA }}
                />
                <Area type="monotone" dataKey="diff" stroke="none" fill="none" dot={false} activeDot={false} legendType="none" />
              </AreaChart>
            </ResponsiveContainer>
            )}
            </GraficoRolavel>
          </SubCard>
        </>
      ) : (
        <SubCard>
          <div className="lista-anos-vazio" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
            Nenhuma rentabilidade cadastrada ainda. Adicione em Configurações.
          </div>
        </SubCard>
      )}
    </Card>
  );
}

function CardReserva({ reservas, alocacao, totais, onEditar }) {
  if (!reservas?.length || !alocacao?.length) return null;
  const r = reservas[0], a = alocacao[0];
  const aktual   = toFloat(r.reserva_atual);
  const pctIdeal = toFloat(a.alocacao_ideal_reservas);

  const totalPatrimonio = toFloat(totais?.[0]?.total_patrimonio);
  const valorIdeal      = totalPatrimonio * pctIdeal / 100;
  const valorDiferenca  = aktual - valorIdeal;
  const textoSF         = valorDiferenca > 0 ? "Sobrando" : valorDiferenca < 0 ? "Faltando" : "Ok";
  const valorD           = Math.abs(valorDiferenca);
  const corDiferenca     = corVar(valorDiferenca);
  const ssf               = sinalCompleto(valorDiferenca);

  const pctVariacao = valorIdeal > 0 ? Math.abs(valorDiferenca) / valorIdeal * 100 : 0;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo">Reserva</h2>
        </SubCard>
        {onEditar && (
          <button className="btn-tema" onClick={onEditar} aria-label="Editar reserva" title="Editar reserva">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
            </svg>
          </button>
        )}
      </div>

      <SubCard>
        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">Atual</span>
          </div>
          <div className="list-row-right">
            <span className="list-row-value">{fmtBRL(aktual)}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
            <ListRow
              label={textoSF}
              value={`${ssf}${fmtBRL(valorD)}${pctVariacao > 0 ? ` (${pctVariacao.toFixed(1)}%)` : ""}`}
              valueColor={corDiferenca}
              plain
            />
            <ListRow
              label="Meta"
              value={`${fmtBRL(valorIdeal)} (${pctIdeal.toFixed(1)}%)`}
              plain
            />
          </div>
        </div>
      </SubCard>
    </Card>
  );
}

function CardResumoInvestimentos({ totais }) {
  if (!totais?.length) return null;
  const t = totais[0];

  const total    = CLASSES_ATIVOS.reduce((acc, c) => acc + toFloat(t[`total_${c.sufixo}`]), 0);
  const aportado = CLASSES_ATIVOS.reduce((acc, c) => acc + toFloat(t[`total_aportado_${c.sufixo}`]), 0);
  const diff     = CLASSES_ATIVOS.reduce((acc, c) => acc + toFloat(t[`diferenca_${c.sufixo}`]), 0);

  const corDiff = corVar(diff);

  const pctVariacao = aportado > 0 ? Math.abs(diff) / aportado * 100 : 0;

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <h2 className="card-titulo">Investimentos</h2>
      </SubCard>

      <SubCard>
        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">Atual</span>
          </div>
          <div className="list-row-right">
            <span className="list-row-value">{fmtBRL(total)}</span>
          </div>
        </div>

        <ListRow label="Aportado" value={fmtBRL(aportado)} plain />

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
            <ListRow
              label="Variação"
              value={`${sinal(diff)}${fmtBRL(diff)} (${pctVariacao.toFixed(1)}%)`}
              valueColor={corDiff}
              plain
            />
          </div>
        </div>
      </SubCard>
    </Card>
  );
}

function BarraAlocacao({ dados }) {
  return (
    <SubCard>
      <div style={{ marginTop: "calc(var(--space-4) * -1)", marginBottom: "calc(var(--space-4) * -1)" }}>
        {dados.map((d, i) => {
          const cor = PALETA_ALOCACAO[i % PALETA_ALOCACAO.length];
          return (
            <div key={d.titulo} className="list-row list-row-plain alocacao-item-compacta">
              <div className="list-row-left">
                <span className="alocacao-dot" style={{ background: cor }} />
                <span className="alocacao-label-col">
                  <span className="list-row-label">{d.titulo}</span>
                  {d.ideal > 0 && (
                    <span className="list-row-tag alocacao-meta-tag">Meta {d.ideal.toFixed(1)}%</span>
                  )}
                </span>
              </div>
              <div className="list-row-right">
                <div className="list-row-values">
                  <span className="list-row-value">{d.pct.toFixed(1)}%</span>
                  {d.diff != null && (
                    <span className="list-row-sub" style={{ color: corVar(d.diff) }}>
                      {sinal(d.diff)}{d.diff.toFixed(2)}%
                    </span>
                  )}
                </div>
                <div className="alocacao-mini-barra">
                  <div className="alocacao-mini-barra-fill" style={{ width: `${Math.max(Math.min(d.pct, 100), 0)}%`, background: cor }} />
                  {d.ideal > 0 && (
                    <div
                      className="alocacao-meta-marcador"
                      title={`Meta ${d.ideal.toFixed(1)}%`}
                      style={{ left: `${Math.max(Math.min(d.ideal, 100), 0)}%` }}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </SubCard>
  );
}

// Treemap "squarified": cada classe vira um bloco cuja área é proporcional ao seu peso no patrimônio.
function organizarBlocos(itens, W, H) {
  const total = itens.reduce((acc, i) => acc + i.peso, 0) || 1;
  const nos = [...itens].sort((a, b) => b.peso - a.peso).map(i => ({ ...i, a: (i.peso / total) * W * H }));
  const saida = [];
  let x = 0, y = 0, w = W, h = H, linha = [];

  const pior = (l, lado) => {
    const soma = l.reduce((t, n) => t + n.a, 0);
    const mx = Math.max(...l.map(n => n.a));
    const mn = Math.min(...l.map(n => n.a));
    return Math.max((lado * lado * mx) / (soma * soma), (soma * soma) / (lado * lado * mn));
  };

  const fecharLinha = (l) => {
    const soma = l.reduce((t, n) => t + n.a, 0);
    if (w >= h) {
      const cw = soma / h;
      let cy = y;
      l.forEach(n => { const nh = n.a / cw; saida.push({ ...n, x, y: cy, w: cw, h: nh }); cy += nh; });
      x += cw; w -= cw;
    } else {
      const rh = soma / w;
      let cx = x;
      l.forEach(n => { const nw = n.a / rh; saida.push({ ...n, x: cx, y, w: nw, h: rh }); cx += nw; });
      y += rh; h -= rh;
    }
  };

  let i = 0;
  while (i < nos.length) {
    const lado = Math.min(w, h);
    const n = nos[i];
    if (!linha.length || pior([...linha, n], lado) <= pior(linha, lado)) { linha.push(n); i++; }
    else { fecharLinha(linha); linha = []; }
  }
  if (linha.length) fecharLinha(linha);
  return saida;
}

// Escolhe o que cabe dentro de cada bloco do treemap sem cortar nenhum número:
//  "completo" = título + % + valor em R$
//  "duplo"    = título + %
//  "linha"    = título e % lado a lado (blocos baixos)
//  "so-pct"   = só o % (blocos minúsculos; o valor aparece no toque/hover)
function layoutBlocoTreemap(b, pctTxt, telaPequena) {
  const innerW = Math.max(b.w - 8, 0);   // desconta o respiro de 4px de cada lado do bloco
  const innerH = Math.max(b.h - 8, 0);
  const menor  = Math.min(innerW, innerH);
  const pad    = telaPequena
    ? (menor < 70 ? 7 : menor < 100 ? 10 : 12)
    : (menor < 80 ? 10 : 14);
  // blocos estreitos (ex.: Reserva em telas grandes) ganham menos respiro lateral para o texto caber
  const padX = innerW < 140 ? Math.min(pad, 7) : pad;
  const padY = pad;
  const w = Math.max(innerW - padX * 2, 0);
  const h = Math.max(innerH - padY * 2, 0);

  const ftBase = telaPequena ? 9 : 11;    // fonte base do título
  const fvBase = telaPequena ? 10 : 12;   // fonte base do valor
  // título e valor encolhem (até um mínimo legível) para caber na largura do bloco
  const ft = Math.max(Math.min(ftBase, w / (Math.max(String(b.titulo).length, 1) * 0.78)), 8);
  const fv = Math.min(fvBase, w / (Math.max(fmtBRL(b.valor).length, 1) * 0.66));
  const nPct   = String(pctTxt).length + 1;               // + "%"
  const larguraMax = (n, fator) => (n > 0 ? w / (n * fator) : 0);
  const fpLarg = larguraMax(nPct, 0.68);                  // maior fonte do % que cabe na largura
  const fpPref = telaPequena
    ? Math.min(Math.max(menor * 0.2, 13), 30)
    : Math.min(Math.max(menor * 0.26, 15), 44);
  const altTitulo = ft * 1.25;
  const fvMin  = telaPequena ? 8 : 9;
  const tituloW = String(b.titulo).length * ft * 0.78;

  // 1) completo
  const fpCompleto = Math.min(fpPref, h - (altTitulo + 6 + 4 + fv * 1.3), fpLarg);
  if (fpCompleto >= 13 && fv >= fvMin) return { modo: "completo", padX, padY, ft, fv, fp: fpCompleto };

  // 2) título + %
  const fpDuplo = Math.min(fpPref, telaPequena ? 22 : 28, h - (altTitulo + 6), fpLarg);
  if (fpDuplo >= 13) return { modo: "duplo", padX, padY, ft, fv, fp: fpDuplo };

  // 3) título e % na mesma linha
  const fpLinha = Math.min(telaPequena ? 16 : 20, h / 1.1, fpLarg);
  if (fpLinha >= 11 && tituloW + nPct * fpLinha * 0.68 + 8 <= w) {
    return { modo: "linha", padX, padY, ft, fv, fp: fpLinha };
  }

  // 4) só o %
  return { modo: "so-pct", padX, padY, ft, fv, fp: Math.max(Math.min(h / 1.1, fpLarg, 18), 8) };
}

function GraficoTreemap({ dados }) {
  const [hov, setHov] = useState(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [largura, setLargura] = useState(0);
  const wrapRef = useRef(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const medir = () => setLargura(el.clientWidth);
    medir();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", medir);
      return () => window.removeEventListener("resize", medir);
    }
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = largura || 600;
  const telaPequena = W < 480;
  // em telas pequenas o gráfico fica mais alto, para os blocos menores terem espaço para os números
  const H = W >= 760
    ? Math.min(Math.max(W * 0.38, 320), 440)
    : telaPequena ? Math.max(W * 1.3, 420) : Math.max(W * 0.95, 340);
  // peso mínimo para classes pequenas/zeradas continuarem visíveis e legíveis
  const pesoMinimo = telaPequena ? 8 : 4;
  const itens = dados.map(d => ({ ...d, peso: Math.max(d.pct, pesoMinimo) }));
  const blocos = largura > 0 ? organizarBlocos(itens, W, H) : [];

  const aoMover = (e, sufixo) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHov(sufixo);
    setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const bHov = hov ? blocos.find(b => b.sufixo === hov) : null;

  return (
    <div ref={wrapRef} className="treemap" style={{ height: H }} role="img" aria-label="Gráfico em blocos da alocação do patrimônio">
      {blocos.map((b, i) => {
        const menor    = Math.min(b.w, b.h);
        const dim      = hov && hov !== b.sufixo;
        const pctTxt   = b.pct < 10 ? b.pct.toFixed(1).replace(".", ",") : Math.round(b.pct);
        const L        = layoutBlocoTreemap(b, pctTxt, telaPequena);
        const estiloIn = { background: b.cor, borderRadius: `min(var(--radius-subcard), ${menor / 3.5}px)`, padding: `${L.padY}px ${L.padX}px` };
        if (L.modo === "linha")  Object.assign(estiloIn, { flexDirection: "row", alignItems: "center", gap: 8 });
        if (L.modo === "so-pct") Object.assign(estiloIn, { alignItems: "center", justifyContent: "center" });
        return (
          <div
            key={b.sufixo}
            className="treemap-bloco"
            style={{ left: b.x, top: b.y, width: b.w, height: b.h, opacity: dim ? 0.45 : 1, animationDelay: `${i * 60}ms` }}
            onMouseEnter={e => aoMover(e, b.sufixo)}
            onMouseMove={e => aoMover(e, b.sufixo)}
            onMouseLeave={() => setHov(null)}
            onClick={e => (hov === b.sufixo ? setHov(null) : aoMover(e, b.sufixo))}
          >
            <div className="treemap-bloco-in" style={estiloIn}>
              {L.modo !== "so-pct" && (
                <span className="treemap-titulo" style={{ fontSize: L.ft }}>{b.titulo}</span>
              )}
              {L.modo === "completo" || L.modo === "duplo" ? (
                <div className="treemap-num">
                  <span className="treemap-pct" style={{ fontSize: L.fp }}>{pctTxt}%</span>
                  {L.modo === "completo" && (
                    <span className="treemap-valor" style={{ fontSize: L.fv }}>{fmtBRL(b.valor)}</span>
                  )}
                </div>
              ) : (
                <span className="treemap-pct" style={{ fontSize: L.fp }}>{pctTxt}%</span>
              )}
            </div>
          </div>
        );
      })}

      {bHov && (() => {
        const dif = bHov.pct - bHov.ideal;
        const direita = mouse.x > W / 2;
        const topo = Math.min(Math.max(mouse.y, 100), H - 100);
        return (
          <div
            className="chart-tooltip tt-card treemap-tip"
            style={telaPequena ? {
              // telas pequenas: centralizado no gráfico, sempre dentro da largura disponível
              left: "50%",
              top: topo,
              transform: "translate(-50%, -50%)",
              maxWidth: Math.max(W - 8, 0),
              minWidth: Math.min(200, Math.max(W - 8, 0)),
            } : {
              left: mouse.x,
              top: topo,
              transform: direita ? "translate(calc(-100% - 14px), -50%)" : "translate(14px, -50%)",
            }}
          >
            {(() => {
              const pc = (v) => v.toFixed(1).replace(".", ",");
              const cls = (v) => (v > 0 ? "tt-pos" : v < 0 ? "tt-neg" : "tt-neu");
              const statusTxt = dif > 0 ? "Sobrando" : dif < 0 ? "Faltando" : "Na meta";
              return (
                <>
                  <div className="tt-head">
                    <span className="tt-titulo">{bHov.titulo}</span>
                    <span className={`tt-pilula ${cls(dif)}`}>
                      {statusTxt}{dif !== 0 ? ` ${sinalCompleto(dif)}${pc(Math.abs(dif))}%` : ""}
                    </span>
                  </div>

                  <div className="tt-valor">{fmtBRL(bHov.valor)}</div>

                  {bHov.temAportado && (
                    <div className="tt-bloco">
                      <div className="tt-linha">
                        <span className="tt-rotulo">Aportado</span>
                        <span className="tt-dado">{fmtBRL(bHov.aportado)}</span>
                      </div>
                      <div className="tt-linha">
                        <span className="tt-rotulo">Variação</span>
                        <span className={`tt-dado ${cls(bHov.variacao)}`}>
                          {sinalCompleto(bHov.variacao)}{fmtBRL(Math.abs(bHov.variacao))} ({sinalCompleto(bHov.variacaoPct)}{pc(Math.abs(bHov.variacaoPct))}%)
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="tt-bloco">
                    <div className="tt-linha">
                      <span className="tt-rotulo">% do patrimônio</span>
                      <span className="tt-dado">{pc(bHov.pct)}%</span>
                    </div>
                    <div className="tt-linha">
                      <span className="tt-rotulo">Meta</span>
                      <span className="tt-dado">{pc(bHov.ideal)}%</span>
                    </div>
                    <div className="tt-barra" aria-hidden="true">
                      <div className="tt-barra-fill" style={{ width: `${Math.max(Math.min(bHov.pct, 100), 0)}%` }} />
                      {bHov.ideal > 0 && (
                        <div className="tt-barra-meta" style={{ left: `${Math.max(Math.min(bHov.ideal, 100), 0)}%` }} />
                      )}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        );
      })()}
    </div>
  );
}

function CardClassesAtivos({ totais, reservas, alocacao }) {
  if (!totais?.length) return null;
  const t = totais[0];
  const totalPatrimonio = toFloat(t.total_patrimonio);
  const reservaAtual = toFloat(reservas?.[0]?.reserva_atual);

  const dados = ALOCACAO_CLASSES.map((c, i) => {
    const valor = c.sufixo === "reservas" ? reservaAtual : toFloat(t[`total_${c.sufixo}`]);
    const pct   = totalPatrimonio > 0 ? (valor / totalPatrimonio) * 100 : 0;
    const temAportado = c.sufixo !== "reservas";
    const aportado    = temAportado ? toFloat(t[`total_aportado_${c.sufixo}`]) : 0;
    const variacao    = temAportado ? toFloat(t[`diferenca_${c.sufixo}`]) : 0;
    return {
      titulo: c.titulo,
      sufixo: c.sufixo,
      valor,
      pct,
      ideal: toFloat(alocacao?.[0]?.[`alocacao_ideal_${c.sufixo}`]),
      temAportado,
      aportado,
      variacao,
      variacaoPct: aportado > 0 ? (variacao / aportado) * 100 : 0,
      cor: PALETA_ALOCACAO[0],
    };
  });

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <h2 className="card-titulo">Alocação do patrimônio</h2>
      </SubCard>

      <SubCard>
        <div className="bolhas-wrap">
          <GraficoTreemap dados={dados} />
        </div>
      </SubCard>

    </Card>
  );
}

function CardAlocacao({ alocacao, onEditar }) {
  if (!alocacao?.length) return null;
  const a = alocacao[0];

  const dados = ALOCACAO_CLASSES.map((c, i) => ({
    ...c,
    pct:   toFloat(a[`alocacao_atual_${c.sufixo}`]),
    ideal: toFloat(a[`alocacao_ideal_${c.sufixo}`]),
    diff:  toFloat(a[`alocacao_diferenca_${c.sufixo}`]),
    cor:   PALETA_ALOCACAO[i % PALETA_ALOCACAO.length],
  }));

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo">Alocação</h2>
        </SubCard>
        {onEditar && (
          <button className="btn-tema" onClick={onEditar} aria-label="Editar metas de alocação" title="Editar metas de alocação">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
            </svg>
          </button>
        )}
      </div>

      <BarraAlocacao dados={dados} />
    </Card>
  );
}

const BRASIL_EXTERIOR_COR = { brasil: "#0a5550", exterior: PALETA_ALOCACAO[1] };

function CardBrasilExterior({ alocacao, totais }) {
  if (!alocacao?.length || !totais?.length) return null;
  const a = alocacao[0];
  const t = totais[0];
  const totalPatrimonio = toFloat(t.total_patrimonio);

  const pctBrasil =
    toFloat(a.alocacao_atual_acoes) +
    toFloat(a.alocacao_atual_fiis) +
    toFloat(a.alocacao_atual_reservas);

  const pctExterior =
    toFloat(a.alocacao_atual_stocks) +
    toFloat(a.alocacao_atual_reits) +
    toFloat(a.alocacao_atual_bitcoins);

  const valorBrasil   = (pctBrasil   / 100) * totalPatrimonio;
  const valorExterior = (pctExterior / 100) * totalPatrimonio;

  const dados = [
    { titulo: "Brasil",   pct: pctBrasil,   valor: valorBrasil,   cor: BRASIL_EXTERIOR_COR.brasil   },
    { titulo: "Exterior", pct: pctExterior, valor: valorExterior, cor: BRASIL_EXTERIOR_COR.exterior },
  ];

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <h2 className="card-titulo">Brasil x Exterior</h2>
      </SubCard>

      <SubCard>
        <div style={{ position: "relative", width: "100%", height: 8 }}>
          <div style={{ display: "flex", width: "100%", height: "100%", borderRadius: 999, overflow: "hidden", background: "var(--bg3)" }}>
            {dados.filter(d => d.pct > 0).map(d => (
              <div
                key={d.titulo}
                style={{ width: `${d.pct}%`, background: d.cor, transition: "width 0.3s ease" }}
                title={`${d.titulo}: ${d.pct.toFixed(1)}%`}
              />
            ))}
          </div>
          {pctBrasil > 0 && pctExterior > 0 && (
            <div
              className="alocacao-meta-marcador"
              style={{ top: -1.5, left: `${Math.min(Math.max(pctBrasil, 0), 100)}%`, transition: "left 0.3s ease" }}
            />
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
          {dados.map((d, i) => {
            const alinhaDireita = i === 1;
            return (
              <div
                key={d.titulo}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexDirection: alinhaDireita ? "row-reverse" : "row",
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: d.cor, flexShrink: 0 }} />
                <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.3, alignItems: alinhaDireita ? "flex-end" : "flex-start" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                    {d.titulo} · {d.pct.toFixed(1)}%
                  </span>
                  <span style={{ fontSize: 12, color: "var(--color-label)" }}>{fmtBRL(d.valor)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </SubCard>
    </Card>
  );
}

function CardAporte({ ativos, alocacao }) {
  if (!ativos?.length || !alocacao?.length) return null;
  const a = alocacao[0];

  const APORTE_MAP = {
    stock:   ["alocacao_ideal_stocks",   "alocacao_atual_stocks"  ],
    reit:    ["alocacao_ideal_reits",    "alocacao_atual_reits"   ],
    acao:    ["alocacao_ideal_acoes",    "alocacao_atual_acoes"   ],
    fii:     ["alocacao_ideal_fiis",     "alocacao_atual_fiis"    ],
    bitcoin: ["alocacao_ideal_bitcoins", "alocacao_atual_bitcoins"],
    reserva: ["alocacao_ideal_reservas", "alocacao_atual_reservas"],
  };

  const ORDEM = [
    { classe: "stock",   nome: "Stocks"   },
    { classe: "reit",    nome: "Reits"    },
    { classe: "acao",    nome: "Ações"    },
    { classe: "fii",     nome: "Fiis"     },
    { classe: "bitcoin", nome: "Bitcoins" },
    { classe: "reserva", nome: "Reserva" },
  ];

  const deficits = ORDEM.map(({ classe, nome }) => {
    const [ki, ka] = APORTE_MAP[classe];
    const ideal  = toFloat(a[ki]);
    const aktual = toFloat(a[ka]);
    const diff   = ideal - aktual;
    return { classe, nome, ideal, atual: aktual, diff };
  }).filter(d => d.ideal > 0 && d.diff > 0).sort((a, b) => b.diff - a.diff);

  const classePrio = deficits[0] ?? null;

  const ativosPrioClasse = classePrio
    ? ativos
        .filter(at => String(at.classe ?? "").toLowerCase().trim() === classePrio.classe)
        .sort((a, b) => toFloat(a.porcentagem_sobrando_faltando) - toFloat(b.porcentagem_sobrando_faltando))
    : [];

  const ativo1Obj = ativosPrioClasse[0] ?? null;
  const ativo2Obj = ativosPrioClasse[1] ?? null;

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <h2 className="card-titulo">Aporte</h2>
      </SubCard>

      {classePrio && (() => {
        return (
          <SubCard>
            <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
              <div className="list-row-left">
                <span className="list-row-label">Classe prioritária</span>
              </div>
              <div className="list-row-right">
                <span className="list-row-value">{classePrio.nome}</span>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
                <ListRow label="Atual" value={`${classePrio.atual.toFixed(1)}%`} plain />
                <ListRow label="Meta" value={`${classePrio.ideal.toFixed(1)}%`} plain />
                <ListRow
                  label="Faltando"
                  value={`-${classePrio.diff.toFixed(1)}%`}
                  valueColor={COR_BAIXA}
                  plain
                />
              </div>
            </div>
          </SubCard>
        );
      })()}

      {ativo1Obj && (
        <CardAtivo ativo={ativo1Obj} soMeta titulo="Ativo prioritário 1" />
      )}

      {ativo2Obj && (
        <CardAtivo ativo={ativo2Obj} soMeta titulo="Ativo prioritário 2" />
      )}
    </Card>
  );
}

function GraficoProventos({ porAno, centro = null, setTip = null }) {
  const [hovIdx, setHovIdx] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const vMax     = Math.max(...porAno.map(r => r.valor), 1);
  const anoAtual = String(new Date().getFullYear());
  const CHART_H  = 220;
  const BAR_GAP  = 10;

  const [containerW, setContainerW] = useState(0);

  useEffect(() => {
    if (!setTip) return;
    if (centro == null || hovIdx === null) { setTip(null); return; }
    const d = porAno[hovIdx];
    const anterior = hovIdx > 0 ? porAno[hovIdx - 1].valor : null;
    const diff = anterior !== null ? d.valor - anterior : null;
    setTip(
      <TooltipGrafico
        titulo={d.ano}
        valor={fmtBRL(d.valor)}
        linhas={diff !== null ? [{
          rotulo: "vs. ano anterior",
          classe: classeTT(diff),
          texto: `${sinalCompleto(diff)}${fmtBRL(Math.abs(diff))}${anterior > 0 ? ` (${sinalCompleto(diff)}${Math.abs((diff / anterior) * 100).toFixed(1).replace(".", ",")}%)` : ""}`,
        }] : []}
      />
    );
  }, [hovIdx, centro != null]);

  const handleMouseMove = (e) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setContainerW(rect.width);
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      style={{ position: "relative", width: "100%", boxSizing: "border-box" }}
    >
      {hovIdx !== null && (() => {
        const d        = porAno[hovIdx];
        const anterior = hovIdx > 0 ? porAno[hovIdx - 1].valor : null;
        const diff     = anterior !== null ? d.valor - anterior : null;
        const isRightSide = mousePos.x > containerW / 2;
        const linhas = diff !== null ? [{
          rotulo: "vs. ano anterior",
          classe: classeTT(diff),
          texto: `${sinalCompleto(diff)}${fmtBRL(Math.abs(diff))}${anterior > 0 ? ` (${sinalCompleto(diff)}${Math.abs((diff / anterior) * 100).toFixed(1).replace(".", ",")}%)` : ""}`,
        }] : [];
        // telas pequenas: o tooltip é desenhado centralizado pelo GraficoRolavel
        if (centro != null) return null;
        return (
          <TooltipGrafico
            titulo={d.ano}
            valor={fmtBRL(d.valor)}
            linhas={linhas}
            style={{
              position: "absolute",
              left: mousePos.x,
              top: mousePos.y,
              transform: isRightSide
                ? "translate(calc(-100% - 14px), calc(-100% - 14px))"
                : "translate(14px, calc(-100% - 14px))",
              pointerEvents: "none",
              whiteSpace: "nowrap",
              zIndex: 10,
            }}
          />
        );
      })()}

      <div style={{
        display: "flex",
        alignItems: "flex-end",
        gap: BAR_GAP,
        height: CHART_H,
        overflow: "visible",
      }}>
        {porAno.map((d, i) => {
          const heightPct = (d.valor / vMax) * 100;
          const isHov     = hovIdx === i;

          return (
            <div
              key={d.ano}
              onMouseEnter={() => setHovIdx(i)}
              onMouseLeave={() => setHovIdx(null)}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                height: "100%",
                justifyContent: "flex-end",
                cursor: "default",
                position: "relative",
              }}
            >
              <div className="barra-proventos" style={{
                width: "100%",
                height: `${heightPct}%`,
                minHeight: d.valor > 0 ? 4 : 0,
                background: isHov ? "#13a097" : "#0a5550",
                transition: "height 0.6s cubic-bezier(0.4,0,0.2,1), background 0.15s",
                position: "relative",
                overflow: "hidden",
              }}>
                {isHov && (
                  <div className="barra-proventos-glow" style={{
                    position: "absolute", inset: 0,
                    background: "linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 60%)",
                  }} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: BAR_GAP, marginTop: "var(--space-2)" }}>
        {porAno.map((d, i) => (
          <div key={d.ano} style={{
            flex: 1,
            textAlign: "center",
            fontSize: "clamp(8px, 1.8vw, 11px)",
            fontWeight: 500,
            color: d.ano === anoAtual ? "#13a097" : hovIdx === i ? "var(--color-value)" : "var(--color-label)",
            transition: "color 0.15s",
            minWidth: 0,
            whiteSpace: "nowrap",
          }}>
            {d.ano}
          </div>
        ))}
      </div>
    </div>
  );
}

function CardProventos({ proventos, onEditar }) {
  const porAnoCompleto = (proventos ?? [])
    .map(row => ({ ano: String(row.ano ?? ""), valor: toFloat(row.total_ano) }))
    .filter(r => r.ano)
    .sort((a, b) => parseInt(a.ano, 10) - parseInt(b.ano, 10));

  if (!proventos?.length) return null;

  const totalRecebido = porAnoCompleto.reduce((s, r) => s + r.valor, 0);
  const anosDecorridosProventos = porAnoCompleto.length > 1
    ? parseInt(porAnoCompleto[porAnoCompleto.length - 1].ano, 10) - parseInt(porAnoCompleto[0].ano, 10)
    : 0;
  const mediaAnualProventos = anosDecorridosProventos > 0
    ? totalRecebido / anosDecorridosProventos
    : 0;
  const porAno = porAnoCompleto;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo">Proventos</h2>
        </SubCard>
        {onEditar && (
          <button className="btn-tema" onClick={onEditar} aria-label="Editar proventos" title="Editar proventos">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
            </svg>
          </button>
        )}
      </div>

      <SubCard style={{ overflow: "hidden" }}>
        <HeroValor titulo="Total recebido" valor={fmtBRL(totalRecebido)} visible={!!totalRecebido} />
        <div
          className="campo-titulo"
          style={{
            marginTop: "var(--space-2)",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            opacity: mediaAnualProventos > 0 ? 1 : 0,
            transition: "opacity 0.55s cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          Média anual
          <span style={{ color: "var(--color-mono)", fontWeight: 600 }}>
            {fmtBRL(mediaAnualProventos)}
          </span>
        </div>
        <GraficoRolavel qtd={porAno.length} style={{ marginTop: "var(--space-3)" }}>
          {(centro, setTip) => <GraficoProventos porAno={porAno} centro={centro} setTip={setTip} />}
        </GraficoRolavel>
      </SubCard>
    </Card>
  );
}

function HeatmapCell({ ativo, onSelect }) {
  const [imgErr, setImgErr] = useState(false);
  const [hovered, setHovered] = useState(false);
  const pct    = toFloat(ativo.variacao_percentual);
  const varBRL = toFloat(ativo.variacao_total);
  const cor    = corHeatmap(pct);
  const s      = pct > 0 ? "+" : "";
  const sb     = varBRL > 0 ? "+" : "";
  const ticker = String(ativo.ticker).toUpperCase();

  return (
    <div
      className="heatmap-cell"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect?.(ativo)}
      title={`Ver detalhes de ${ticker}`}
      style={{
        background: cor,
        "--hm-glow": `${cor}b3`,
      }}
    >
      {!imgErr ? (
        <img src={`/logos_ativos/${ticker}.png`} alt={ticker}
          width={40} height={40}
          onError={() => setImgErr(true)}
          style={{ objectFit: "contain", borderRadius: 6 }} />
      ) : null}
      <span className="hm-ticker">{ticker}</span>
      <span className="hm-pct">{s}{pct.toFixed(2)}%</span>
      <span className="hm-brl">{sb}{fmtBRL(varBRL)}</span>
    </div>
  );
}

function CardHeatmap({ ativos }) {
  const [open, setOpen] = useState(false);
  const [ativoSel, setAtivoSel] = useState(null);
  if (!ativos?.length) return null;

  const df = ativos
    .filter(a => toFloat(a.total_atual) > 0)
    .sort((a, b) => toFloat(b.variacao_percentual) - toFloat(a.variacao_percentual));

  const LIMITE = 12;
  const temMais = df.length > LIMITE;

  return (
    <Card>
      <div className="card-header">
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo">Mapa de ativos</h2>
        </SubCard>
        {temMais && (
          <BotaoVer onClick={() => setOpen(o => !o)} open={open} />
        )}
      </div>
      <SubCard style={{ overflow: "hidden" }}>
        <div className="heatmap-grid">
          {df.slice(0, LIMITE).map((at, i) => <HeatmapCell key={i} ativo={at} onSelect={setAtivoSel} />)}
        </div>
        {temMais && (
          <Expandable open={open}>
            <div className="heatmap-grid" style={{ marginTop: "var(--space-3)" }}>
              {df.slice(LIMITE).map((at, i) => <HeatmapCell key={i} ativo={at} onSelect={setAtivoSel} />)}
            </div>
          </Expandable>
        )}
      </SubCard>
      {ativoSel && <ModalDetalheAtivo ativo={ativoSel} onFechar={() => setAtivoSel(null)} />}
    </Card>
  );
}

function montarMetricasAtivo(ativo, soMeta = false) {
  const ehUSD = ["stock", "reit"].includes(String(ativo.classe).toLowerCase().trim());
  const cot   = toFloat(ativo.cotacao);
  const qtd   = toFloat(ativo.quantidade);
  const pm    = toFloat(ativo.preco_medio);
  const ti    = toFloat(ativo.total_investido);
  const ta    = toFloat(ativo.total_atual);
  const vt    = toFloat(ativo.variacao_total);
  const vpct  = toFloat(ativo.variacao_percentual);
  const pmeta = toFloat(ativo.porcentagem_meta);
  const pat   = toFloat(ativo.porcentagem_atual);
  const psf   = toFloat(ativo.porcentagem_sobrando_faltando);

  const textoSF = psf > 0 ? "Sobrando" : psf < 0 ? "Faltando" : "Ok";
  const s   = sinal(vt);
  const ssf = sinalCompleto(psf);

  const metricas = soMeta
    ? [
        { titulo: "Atual", chave: "porcentagem_atual", valor: `${pat.toFixed(2)}%`,                  cor: null        },
        { titulo: "Meta",  chave: null,                 valor: `${pmeta.toFixed(2)}%`,               cor: null        },
        { titulo: textoSF, chave: null,                 valor: `${ssf}${Math.abs(psf).toFixed(2)}%`, cor: corVar(psf) },
      ]
    : [
        { titulo: "Cotação",         chave: null,                    valor: ehUSD ? fmtUSD(cot) : fmtBRL(cot), cor: null        },
        { titulo: "Quantidade",      chave: null,                    valor: String(qtd),                         cor: null        },
        { titulo: "Preço médio",     chave: null,                    valor: ehUSD ? fmtUSD(pm) : fmtBRL(pm),   cor: null        },
        { titulo: "Total investido", chave: null,                    valor: fmtBRL(ti),                          cor: null        },
        { titulo: "Total atual",     chave: "total_atual",           valor: fmtBRL(ta),                          cor: null        },
        { titulo: "Variação",        chave: "variacao_total",        valor: `${s}${fmtBRL(vt)}`,                cor: corVar(vt)  },
        { titulo: "Variação %",      chave: "variacao_percentual",   valor: `${s}${vpct.toFixed(2)}%`,          cor: corVar(vt)  },
        { titulo: "% Meta",          chave: null,                    valor: `${pmeta.toFixed(2)}%`,             cor: null        },
        { titulo: "% Atual",         chave: "porcentagem_atual",     valor: `${pat.toFixed(2)}%`,               cor: null        },
        { titulo: textoSF,           chave: null,                    valor: `${ssf}${Math.abs(psf).toFixed(2)}%`, cor: corVar(psf) },
      ];
  return { metricas, pat };
}

function ModalDetalheAtivo({ ativo, onFechar, sortBy = null }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFechar]);

  const { metricas } = montarMetricasAtivo(ativo);

  return (
    <ModalFinancas titulo="" onFechar={onFechar} className="modal-ativo-detalhe">
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", marginTop: "calc(var(--space-4) * -2.5)", marginBottom: "calc(var(--space-4) * -1)" }}>
        <LogoAtivo ticker={ativo.ticker} size={72} />
        <div style={{ minWidth: 0 }}>
          <div className="ativo-nome-ticker">{String(ativo.ticker).toUpperCase()}</div>
          <div className="ativo-nome-texto">{ativo.nome}</div>
        </div>
      </div>
      <div className="divisor" />
      <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
        {metricas.map((m) => (
          <ListRow key={m.titulo} label={m.titulo} value={m.valor} valueColor={m.cor} plain highlight={!!m.chave && m.chave === sortBy} />
        ))}
      </div>
    </ModalFinancas>
  );
}

function CardAtivo({ ativo, highlight, soMeta = false, titulo = null, sortBy = null, onEditar = null }) {
  const [open, setOpen] = useState(false);

  const { metricas, pat } = montarMetricasAtivo(ativo, soMeta);

  const clicavel = !titulo && !soMeta;

  return (
    <>
    <SubCard id={`ativo-${ativo.ticker}`}
      className={clicavel ? "ativo-clicavel" : ""}
      {...(clicavel ? {
        onClick: () => setOpen(true),
        onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } },
        role: "button",
        tabIndex: 0,
        "aria-label": `Ver detalhes de ${String(ativo.ticker).toUpperCase()}`,
      } : {})}
      style={{
      overflow: "hidden",
      transition: "box-shadow 0.4s ease, border-color 0.4s ease, transform 0.22s cubic-bezier(0.22,1,0.36,1), background 0.22s ease",
      ...(highlight ? {
        background: "linear-gradient(135deg, rgba(19,160,151,0.12), rgba(19,160,151,0.03)), var(--bg3)",
        boxShadow: "0 0 22px rgba(19,160,151,0.18)",
      } : {}),
    }}>
      {titulo ? (
        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">{titulo}</span>
          </div>
          <div className="list-row-right">
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 0 }}>
              <span className="list-row-value">{String(ativo.ticker).toUpperCase()}</span>
              <span className="list-row-sub">{ativo.nome}</span>
            </div>
            <LogoAtivo ticker={ativo.ticker} size={36} />
          </div>
        </div>
      ) : (
        <>
          <div className={`ativo-cabecalho${sortBy === "nome" ? " ativo-cabecalho-filtrado" : ""}`} style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-4)",
          }}>
            <LogoAtivo ticker={ativo.ticker} size={72} offsetX={-6} className="logo-ativo-principal" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ativo-nome-ticker">
                {String(ativo.ticker).toUpperCase()}
              </div>
              <div className="ativo-nome-texto">{ativo.nome}</div>
              <div className="ativo-posicao-classe" title={`${pat.toFixed(1)}% da classe`}>
                <div className="alocacao-mini-barra ativo-posicao-classe-barra">
                  <div className="alocacao-mini-barra-fill" style={{ width: `${Math.max(Math.min(pat, 100), 0)}%`, background: "var(--accent)" }} />
                </div>
                <span className="ativo-posicao-classe-pct">{pat.toFixed(1)}%</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              {onEditar && (
                <button className="btn-tema btn-tema-subcard" onClick={(e) => { e.stopPropagation(); onEditar(ativo); }} aria-label="Editar ativo" title="Editar ativo">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {titulo && (
        <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
          {metricas.map((m) => (
            <ListRow key={m.titulo} label={m.titulo} value={m.valor} valueColor={m.cor} plain highlight={!!m.chave && m.chave === sortBy} />
          ))}
        </div>
      )}
    </SubCard>
    {open && clicavel && (
      <ModalDetalheAtivo ativo={ativo} sortBy={sortBy} onFechar={() => setOpen(false)} />
    )}
    </>
  );
}

function CardClasse({ titulo, sufixo, classe, totais, ativos, selectedTicker, searchVersion, scrollRef, onEditarAtivo, onAdicionarAtivo }) {
  const [open, setOpen]               = useState(false);
  const [sortBy, setSortBy]           = useState(null);
  const [sortDir, setSortDir]         = useState("asc");
  const [filtrosOpen, setFiltrosOpen] = useState(false);
  const filtrosVisivel = usePresenca(filtrosOpen);
  const [highlightTicker, setHighlightTicker] = useState(null);

  useEffect(() => {
    if (!selectedTicker || !searchVersion) return;
    const pertenceAessa = (ativos ?? []).some(a =>
      String(a.ticker) === selectedTicker &&
      String(a.classe).toLowerCase().trim() === classe
    );
    if (!pertenceAessa) { setHighlightTicker(null); return; }

    const jaAberto = open;
    setOpen(true);
    setHighlightTicker(selectedTicker);

    const scrollToAtivo = () => {
      const el = document.getElementById(`ativo-${selectedTicker}`);
      const container = scrollRef?.current;
      if (el && container) {
        const containerRect = container.getBoundingClientRect();
        const elRect        = el.getBoundingClientRect();
        const offset        = container.scrollTop + elRect.top - containerRect.top - 110;
        container.scrollTo({ top: offset, behavior: "smooth" });
      }
    };

    let t;
    if (jaAberto) {
      scrollToAtivo();
    } else {
      const secEl = document.getElementById(`sec-${sufixo}`);
      const container = scrollRef?.current;
      if (secEl && container) {
        const containerRect = container.getBoundingClientRect();
        const secRect       = secEl.getBoundingClientRect();
        container.scrollTo({ top: container.scrollTop + secRect.top - containerRect.top - 110, behavior: "smooth" });
      }
      t = setTimeout(scrollToAtivo, 550);
    }

    return () => clearTimeout(t);
  }, [searchVersion]);

  useEffect(() => {
    if (!highlightTicker) return;
    const aoClicar = (e) => {
      if (!e.target.closest?.(`#ativo-${highlightTicker}`)) setHighlightTicker(null);
    };
    document.addEventListener("pointerdown", aoClicar);
    return () => document.removeEventListener("pointerdown", aoClicar);
  }, [highlightTicker]);

  const handleSort = (key) => {
    if (sortBy === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortDir(key === "nome" ? "asc" : "desc");
    }
  };

  if (!totais?.length) return null;
  const t = totais[0];

  const total    = toFloat(t[`total_${sufixo}`]);
  const aportado = toFloat(t[`total_aportado_${sufixo}`]);
  const diff     = toFloat(t[`diferenca_${sufixo}`]);

  let df = (ativos ?? []).filter(a => String(a.classe).toLowerCase().trim() === classe);
  if (sortBy) {
    df = [...df].sort((a, b) => {
      const va = sortBy === "nome" ? String(a[sortBy]) : toFloat(a[sortBy]);
      const vb = sortBy === "nome" ? String(b[sortBy]) : toFloat(b[sortBy]);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  const corDiff = corVar(diff);
  const pctVariacao = aportado > 0 ? Math.abs(diff) / aportado * 100 : 0;

  return (
    <Card>
      <div className="card-header">
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo">
            {titulo}
            <span className="card-titulo-contador">{df.length}</span>
          </h2>
        </SubCard>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <button className="btn-tema" onClick={() => onAdicionarAtivo(classe)} aria-label={`Adicionar ${titulo}`} title={`Adicionar ${titulo}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <BotaoVer onClick={() => setOpen(o => !o)} open={open} />
        </div>
      </div>

      <SubCard>

        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">Atual</span>
          </div>
          <div className="list-row-right">
            <span className="list-row-value">{fmtBRL(total)}</span>
          </div>
        </div>

        <ListRow label="Aportado" value={fmtBRL(aportado)} plain />

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
            <ListRow
              label="Variação"
              value={`${sinalCompleto(diff)}${fmtBRL(Math.abs(diff))} (${pctVariacao.toFixed(1)}%)`}
              valueColor={corDiff}
              plain
            />
          </div>
        </div>
      </SubCard>

      <Expandable open={open}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>

          <div className="dropdown-wrap filtro-botao-mobile">
            <BotaoFiltroTrigger
              open={filtrosOpen}
              onClick={() => setFiltrosOpen(o => !o)}
            >
              {sortBy && (
                <span className="dropdown-trigger-sub">
                  {FILTROS.find(f => f.key === sortBy)?.texto}
                </span>
              )}
            </BotaoFiltroTrigger>

            {filtrosVisivel && (
              <div className="dropdown-menu" {...(!filtrosOpen ? { "data-saindo": "" } : {})}>
                {FILTROS.map(f => {
                  const ativo = sortBy === f.key;
                  return (
                    <button
                      key={f.key}
                      className={`dropdown-item${ativo ? " is-ativo" : ""}`}
                      onClick={() => { handleSort(f.key); setFiltrosOpen(false); }}
                    >
                      {f.texto}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="filtros-row filtro-botao-desktop">
            {FILTROS.map(f => {
              const ativo = sortBy === f.key;
              return (
                <BotaoFiltro
                  key={f.key}
                  ativo={ativo}
                  onClick={() => handleSort(f.key)}
                >
                  {f.texto}
                </BotaoFiltro>
              );
            })}
          </div>
          <div className="ativos-lista">
            {df.map((at, i) => <CardAtivo key={i} ativo={at} highlight={at.ticker === highlightTicker} sortBy={sortBy} onEditar={onEditarAtivo} />)}
          </div>
        </div>
      </Expandable>
    </Card>
  );
}

async function carregarLancamentos() {
  try {
    const snapshot = await get(ref(db, "financas"));
    const data = snapshot.val();
    if (!data || typeof data !== "object") return { transactions: [], metaDespesa: 0 };
    return {
      transactions: Array.isArray(data.transactions) ? data.transactions : [],
      metaDespesa: Number(data.metaDespesa) || 0,
    };
  } catch (err) {
    console.error("Erro ao carregar lançamentos:", err);
    return { transactions: [], metaDespesa: 0 };
  }
}

async function salvarLancamentos(transactions, metaDespesa) {
  try {
    await set(ref(db, "financas"), { transactions, metaDespesa });
  } catch (err) {
    console.error("Erro ao salvar lançamentos:", err);
  }
}

function CardFinancasResumo({ totais }) {
  const corNet = corVar(totais.net);

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <h2 className="card-titulo">Finanças</h2>
      </SubCard>

      <SubCard>
        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">Total líquido</span>
          </div>
          <div className="list-row-right">
            <span className="list-row-value" style={{ color: corNet }}>{`${sinalCompleto(totais.net)}${fmtBRL(Math.abs(totais.net))}`}</span>
          </div>
        </div>

        <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
          <ListRow
            label="Receitas totais"
            value={`+${fmtBRL(totais.income)}`}
            valueColor={COR_ALTA}
            plain
          />
          <ListRow
            label="Despesas totais"
            value={`-${fmtBRL(totais.expense)}`}
            valueColor={COR_BAIXA}
            plain
          />
        </div>
      </SubCard>

    </Card>
  );
}

function GraficoMetaGastos({ pct, cor }) {
  const [anim, setAnim] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnim(Math.min(Math.max(pct, 0), 100)), 60);
    return () => clearTimeout(t);
  }, [pct]);
  const arco = "M 20 100 A 80 80 0 0 1 180 100";
  return (
    <div className="meta-gauge" role="img" aria-label={`${pct.toFixed(0)}% da meta de gastos utilizada`}>
      <svg viewBox="0 0 200 118" width="100%">
        <path d={arco} fill="none" stroke="var(--bar-track)" strokeWidth="14" strokeLinecap="round" />
        <path
          d={arco} fill="none" stroke={cor} strokeWidth="14" strokeLinecap="round"
          pathLength="100" strokeDasharray={`${anim} 100`}
          style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1), stroke 0.3s ease", filter: `drop-shadow(0 0 6px ${cor}66)` }}
        />
        <text x="100" y="88" textAnchor="middle" className="meta-gauge-pct" fill="var(--color-value)">
          {pct.toFixed(0)}%
        </text>
        <text x="100" y="108" textAnchor="middle" className="meta-gauge-sub" fill="var(--color-label)">
          da meta utilizada
        </text>
      </svg>
    </div>
  );
}

function CardMetaGastos({ meta, gasto }) {
  const restante = meta - gasto;
  const excedeu  = meta > 0 && gasto > meta;
  const pct      = meta > 0 ? (gasto / meta) * 100 : 0;
  const corGauge = excedeu ? "#c0504a" : pct >= 80 ? "#d9a441" : "#13a097";

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <h2 className="card-titulo">Meta de gastos</h2>
      </SubCard>

      <SubCard>
        {meta > 0 ? (
          <>
            <GraficoMetaGastos pct={pct} cor={corGauge} />

            <div style={{ marginBottom: "calc(var(--space-4) * -1)", marginTop: "var(--space-2)" }}>
              <ListRow label="Meta" value={fmtBRL(meta)} plain />
              <ListRow label="Já gasto esse mês" value={`-${fmtBRL(gasto)}`} valueColor={excedeu ? COR_BAIXA : undefined} plain />
              <ListRow
                label={excedeu ? "Ultrapassou em" : "Ainda pode gastar"}
                value={`${sinalCompleto(restante)}${fmtBRL(Math.abs(restante))}`}
                valueColor={excedeu ? COR_BAIXA : COR_ALTA}
                plain
              />
            </div>
          </>
        ) : (
          <>
            <div className="campo-titulo">Nenhuma meta definida</div>
            <div className="campo-titulo" style={{ marginTop: "var(--space-2)" }}>
              Defina um limite mensal nas configurações para acompanhar seus gastos.
            </div>
          </>
        )}
      </SubCard>
    </Card>
  );
}

function MenuLancamento({ onEditar, onExcluir }) {
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const aberto = !!pos;
  const visivel = usePresenca(aberto);
  const ultimaPos = useRef(pos);
  if (pos) ultimaPos.current = pos;
  const posMenu = ultimaPos.current;

  const abrir = (e) => {
    e.stopPropagation();
    if (aberto) { setPos(null); return; }
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
  };

  useEffect(() => {
    if (!aberto) return;
    const fechar = () => setPos(null);
    const onKey = (e) => e.key === "Escape" && fechar();
    window.addEventListener("scroll", fechar, true);
    window.addEventListener("resize", fechar);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", fechar, true);
      window.removeEventListener("resize", fechar);
      window.removeEventListener("keydown", onKey);
    };
  }, [aberto]);

  return (
    <>
      <button ref={btnRef} className="btn-mais-opcoes" onClick={abrir} aria-label="Mais opções" aria-haspopup="menu" aria-expanded={aberto}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>
      {visivel && posMenu && createPortal(
        <div className="menu-lanc-overlay" onClick={(e) => { e.stopPropagation(); setPos(null); }} {...(!aberto ? { "data-saindo": "" } : {})}>
          <div className="menu-lanc" role="menu" style={{ top: posMenu.top, right: posMenu.right }} onClick={e => e.stopPropagation()} {...(!aberto ? { "data-saindo": "" } : {})}>
            <button className="menu-lanc-item" role="menuitem" onClick={() => { setPos(null); onEditar(); }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
              </svg>
              Editar
            </button>
            <button className="menu-lanc-item menu-lanc-item-perigo" role="menuitem" onClick={() => { setPos(null); onExcluir(); }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" />
              </svg>
              Excluir
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function CardFinancasComparativo({ lancamentos, onEditar, onExcluir, onAdicionar }) {
  const receitas = lancamentos.filter(t => t.type === "income");

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo">Receitas</h2>
        </SubCard>
        <button className="btn-tema" onClick={() => onAdicionar("income")} aria-label="Adicionar receita" title="Adicionar receita">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {receitas.length === 0 ? (
        <SubCard>
          <div className="campo-titulo">Nenhuma receita cadastrada ainda.</div>
        </SubCard>
      ) : (
        <SubCard>
          <div style={{ marginTop: "calc(var(--space-4) * -1)", marginBottom: "calc(var(--space-4) * -1)" }}>
            {receitas.map(tx => (
              <div key={tx.id} className="list-row list-row-plain">
                <div className="list-row-left">
                  <span className="list-row-label">{sentenceCase(tx.name)}</span>
                </div>
                <div className="list-row-right">
                  <span className="list-row-value" style={{ color: COR_ALTA }}>
                    +{fmtBRL(tx.value)}
                  </span>
                  <MenuLancamento onEditar={() => onEditar(tx)} onExcluir={() => onExcluir(tx)} />
                </div>
              </div>
            ))}
          </div>
        </SubCard>
      )}
    </Card>
  );
}

function CardFinancasMeta({ lancamentos, onEditarLancamento, onExcluirLancamento, onAdicionar }) {
  const despesas = lancamentos.filter(t => t.type === "expense");

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo">Despesas</h2>
        </SubCard>
        <button className="btn-tema" onClick={() => onAdicionar("expense")} aria-label="Adicionar despesa" title="Adicionar despesa">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {despesas.length === 0 ? (
        <SubCard>
          <div className="campo-titulo">Nenhuma despesa cadastrada ainda.</div>
        </SubCard>
      ) : (
        <SubCard>
          <div style={{ marginTop: "calc(var(--space-4) * -1)", marginBottom: "calc(var(--space-4) * -1)" }}>
            {despesas.map(tx => (
              <div key={tx.id} className="list-row list-row-plain">
                <div className="list-row-left">
                  <span className="list-row-label">{sentenceCase(tx.name)}</span>
                </div>
                <div className="list-row-right">
                  <span className="list-row-value" style={{ color: COR_BAIXA }}>
                    -{fmtBRL(tx.value)}
                  </span>
                  <MenuLancamento onEditar={() => onEditarLancamento(tx)} onExcluir={() => onExcluirLancamento(tx)} />
                </div>
              </div>
            ))}
          </div>
        </SubCard>
      )}
    </Card>
  );
}

function ModalFinancas({ titulo, onFechar, children, className }) {
  const [saindo, setSaindo] = useState(false);
  const fechar = () => {
    if (saindo) return;
    setSaindo(true);
    setTimeout(onFechar, 200);
  };
  const atr = saindo ? { "data-saindo": "" } : {};
  return createPortal(
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && fechar()} {...atr}>
      <div className={`modal-sheet${className ? ` ${className}` : ""}`} {...atr}>
        <div className="modal-header">
          <h3 className="modal-titulo">{titulo}</h3>
          <button className="modal-fechar" onClick={fechar} aria-label="Fechar">✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

function ModalConfirmarExclusao({ tx, onConfirmar, onCancelar }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onCancelar();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancelar]);

  return (
    <ModalFinancas titulo="Excluir lançamento" onFechar={onCancelar}>
      <div className="campo-titulo" style={{ lineHeight: 1.5 }}>
        Tem certeza que deseja excluir <strong style={{ color: "var(--color-value)" }}>{tx.name}</strong> ({fmtBRL(tx.value)})? Essa ação não pode ser desfeita.
      </div>
      <div className="confirmar-exclusao-acoes">
        <button className="form-botao form-botao-perigo form-botao-confirmar-exclusao" onClick={onConfirmar}>Excluir</button>
        <button className="form-botao form-botao-secundario" onClick={onCancelar}>Cancelar</button>
      </div>
    </ModalFinancas>
  );
}

function ModalLancamento({ form, editando, onChange, onSalvar, onExcluir, onFechar, formatarValor }) {
  const tipoClasse = form.type === "expense" ? "tipo-despesa" : "tipo-receita";

  return (
    <ModalFinancas titulo={editando ? "Editar lançamento" : "Novo lançamento"} onFechar={onFechar} className={tipoClasse}>
      <div className="tipo-toggle">
        <button
          className={`tipo-opcao${form.type === "income" ? " tipo-opcao-ativa income" : ""}`}
          onClick={() => onChange({ ...form, type: "income" })}
        >
          Receita
        </button>
        <button
          className={`tipo-opcao tipo-opcao-despesa${form.type === "expense" ? " tipo-opcao-ativa expense" : ""}`}
          onClick={() => onChange({ ...form, type: "expense" })}
        >
          Despesa
        </button>
      </div>

      <div className="form-grupo">
        <label className="campo-titulo">Descrição</label>
        <input
          className="form-input"
          placeholder="Ex: salário, aluguel..."
          value={form.name}
          onChange={e => onChange({ ...form, name: e.target.value })}
        />
      </div>

      <div className="form-grupo">
        <label className="campo-titulo">Valor (R$)</label>
        <input
          className="form-input"
          type="text"
          inputMode="numeric"
          placeholder="0,00"
          value={form.value}
          onChange={e => onChange({ ...form, value: formatarValor(e.target.value) })}
        />
      </div>

      <button className="form-botao" onClick={onSalvar}>
        {editando ? "Salvar alterações" : "Adicionar lançamento"}
      </button>

      {editando && (
        <button className="form-botao form-botao-perigo" onClick={onExcluir}>
          Excluir Lançamento
        </button>
      )}
    </ModalFinancas>
  );
}

function ModalMeta({ valor, onChange, onSalvar, onLimpar, temMeta, onFechar }) {
  return (
    <ModalFinancas titulo="Meta de gastos" onFechar={onFechar}>
      <div className="form-grupo">
        <label className="campo-titulo">Valor da meta (R$)</label>
        <input
          className="form-input"
          type="text"
          inputMode="numeric"
          placeholder="0,00"
          value={valor}
          onChange={e => onChange(e.target.value)}
        />
      </div>

      <button className="form-botao" onClick={onSalvar}>Salvar meta</button>

      {temMeta && (
        <button className="form-botao form-botao-secundario" onClick={onLimpar}>
          Remover Meta
        </button>
      )}
    </ModalFinancas>
  );
}

function ModalAtivo({ ticker, form, onChange, onSalvar, onLimpar, temDados, onFechar, isNovo }) {
  const precoEmDolar = ehClasseEmDolar(form.classe);

  function trocarClasse(novaClasse) {
    const valor = parseMoedaInput(form.preco_medio, form.classe);
    onChange({
      ...form,
      classe: novaClasse,
      preco_medio: valor ? numParaMoedaInput(valor, novaClasse) : "",
    });
  }

  return (
    <ModalFinancas titulo={isNovo ? "Novo ativo" : `Editar ${String(ticker).toUpperCase()}`} onFechar={onFechar}>
      <div className="form-grupo">
        <label className="campo-titulo">Ticker</label>
        <input
          className="form-input"
          placeholder="Ex: AAPL"
          value={form.ticker}
          onChange={e => onChange({ ...form, ticker: e.target.value.toUpperCase() })}
        />
        {!isNovo && form.ticker.trim().toUpperCase() !== String(ticker).toUpperCase() && (
          <span style={{ fontSize: 12, color: "var(--color-label)", marginTop: 4, display: "block" }}>
            Ao salvar, os dados deste ativo serão movidos de {String(ticker).toUpperCase()} para {form.ticker.trim().toUpperCase() || "—"}.
            Lembre-se de usar exatamente o mesmo ticker que está na planilha.
          </span>
        )}
      </div>

      <div className="form-grupo">
        <label className="campo-titulo">Nome</label>
        <input
          className="form-input"
          placeholder="Ex: Apple Inc."
          value={form.nome}
          onChange={e => onChange({ ...form, nome: e.target.value })}
        />
      </div>

      <div className="form-grupo">
        <label className="campo-titulo">Classe</label>
        <SeletorForm
          value={form.classe}
          onChange={trocarClasse}
          options={CLASSES_ATIVOS.map(c => ({ value: c.classe, label: c.titulo }))}
        />
      </div>

      <div className="form-grupo">
        <label className="campo-titulo">Quantidade</label>
        <input
          className="form-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={form.quantidade}
          onChange={e => onChange({ ...form, quantidade: e.target.value })}
        />
      </div>

      <div className="form-grupo">
        <label className="campo-titulo">Preço médio ({precoEmDolar ? "US$" : "R$"})</label>
        <input
          className="form-input"
          type="text"
          inputMode="numeric"
          placeholder={precoEmDolar ? "0.00" : "0,00"}
          value={form.preco_medio}
          onChange={e => onChange({ ...form, preco_medio: formatarMoedaInput(e.target.value, form.classe) })}
        />
      </div>

      {precoEmDolar && (
        <div className="form-grupo">
          <label className="campo-titulo">Dólar médio na compra (R$)</label>
          <input
            className="form-input"
            type="text"
            inputMode="numeric"
            placeholder="0,00"
            value={form.dolar_compra ?? ""}
            onChange={e => onChange({ ...form, dolar_compra: formatarBRLInput(e.target.value) })}
          />
        </div>
      )}

      <div className="form-grupo">
        <label className="campo-titulo">% Meta (dentro da classe)</label>
        <input
          className="form-input"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={form.porcentagem_meta}
          onChange={e => onChange({ ...form, porcentagem_meta: e.target.value })}
        />
      </div>

      <button className="form-botao" onClick={onSalvar}>{isNovo ? "Adicionar ativo" : "Salvar alterações"}</button>

      {temDados && (
        <button className="form-botao form-botao-perigo" onClick={onLimpar}>
          Remover cadastro deste ativo
        </button>
      )}
    </ModalFinancas>
  );
}

function ModalReserva({ valor, onChangeValor, onSalvar, onFechar }) {
  return (
    <ModalFinancas titulo="Editar reserva" onFechar={onFechar}>
      <div className="form-grupo">
        <label className="campo-titulo">Valor atual da reserva (R$)</label>
        <input
          className="form-input"
          type="text"
          inputMode="numeric"
          placeholder="0,00"
          value={valor}
          onChange={e => onChangeValor(e.target.value)}
        />
      </div>

      <button className="form-botao" onClick={onSalvar}>Salvar reserva</button>
    </ModalFinancas>
  );
}

function ModalListaAnos({ titulo, campos, linhas, onChange, onSalvar, onFechar, className }) {
  function atualizarLinha(i, campo, valor) {
    const novas = linhas.slice();
    novas[i] = { ...novas[i], [campo]: valor };
    onChange(novas);
  }

  function removerLinha(i) {
    onChange(linhas.filter((_, idx) => idx !== i));
  }

  function adicionarLinha() {
    const anoAtual = new Date().getFullYear();
    const anosExistentes = linhas.map(l => parseInt(l.ano, 10)).filter(n => !isNaN(n));
    const proximoAno = anosExistentes.length ? Math.max(...anosExistentes) + 1 : anoAtual;
    const nova = { ano: String(proximoAno) };
    campos.forEach(c => { nova[c.key] = ""; });
    onChange([...linhas, nova]);
  }

  return (
    <ModalFinancas titulo={titulo} onFechar={onFechar} className={className}>
      <div className="lista-anos-wrap">
        {linhas.map((linha, i) => (
          <div key={i} className="lista-anos-linha">
            <div className="lista-anos-linha-header">
              <div className="form-grupo lista-anos-ano">
                <label className="campo-titulo">Ano</label>
                <input
                  className="form-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="Ex: 2024"
                  value={linha.ano ?? ""}
                  onChange={e => atualizarLinha(i, "ano", e.target.value)}
                />
              </div>
              {campos.map(c => (
                <div className="form-grupo lista-anos-valor" key={c.key}>
                  <label className="campo-titulo">{c.label}</label>
                  <input
                    className="form-input"
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={linha[c.key] ?? ""}
                    onChange={e => atualizarLinha(i, c.key, c.signed ? formatarBRLInputSigned(e.target.value) : formatarBRLInput(e.target.value))}
                  />
                </div>
              ))}
              <button
                className="btn-remover-linha"
                onClick={() => removerLinha(i)}
                aria-label="Remover ano"
                title="Remover ano"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        ))}

        {linhas.length === 0 && (
          <div className="lista-anos-vazio">Nenhum ano cadastrado ainda.</div>
        )}
      </div>

      <button className="form-botao form-botao-secundario" onClick={adicionarLinha}>+ Adicionar ano</button>
      <button className="form-botao" onClick={onSalvar}>Salvar</button>
    </ModalFinancas>
  );
}

function ModalMetasAlocacao({ form, onChange, onSalvar, onFechar }) {
  return (
    <ModalFinancas titulo="Metas de alocação" onFechar={onFechar} className="modal-evolucao">
      <div className="lista-anos-wrap">
        {ALOCACAO_CLASSES.map(c => (
          <div className="lista-anos-linha" key={c.sufixo}>
            <div className="form-grupo">
              <label className="campo-titulo">Definir meta para {c.titulo}</label>
              <input
                className="form-input input-meta-alocacao"
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={form[c.sufixo] ?? ""}
                onChange={e => onChange({ ...form, [c.sufixo]: e.target.value })}
              />
            </div>
          </div>
        ))}
      </div>

      <button className="form-botao" onClick={onSalvar}>Salvar metas</button>
    </ModalFinancas>
  );
}

function PaginaFinancas({ lancamentos, setLancamentos, metaDespesa, setMetaDespesa }, ref) {
  const [modalAberto, setModalAberto] = useState(false);
  const [editandoId, setEditandoId]   = useState(null);
  const [form, setForm]               = useState({ name: "", value: "", type: "income" });
  const [txParaExcluir, setTxParaExcluir] = useState(null);

  const totais = {
    income:  lancamentos.filter(t => t.type === "income" ).reduce((s, t) => s + t.value, 0),
    expense: lancamentos.filter(t => t.type === "expense").reduce((s, t) => s + t.value, 0),
  };
  totais.net = totais.income - totais.expense;

  function formatarBRL(raw) {
    const digitos = raw.replace(/\D/g, "");
    if (!digitos) return "";
    const centavos = parseInt(digitos, 10);
    return (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function parseBRL(formatado) {
    return parseFloat(formatado.replace(/\./g, "").replace(",", ".")) || 0;
  }

  function abrirNovoLancamento(tipo = "income") {
    setEditandoId(null);
    setForm({ name: "", value: "", type: tipo });
    setModalAberto(true);
  }

  useImperativeHandle(ref, () => ({
    abrirNovoLancamento,
  }));

  function abrirEdicaoLancamento(tx) {
    setEditandoId(tx.id);
    const formatado = tx.value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    setForm({ name: tx.name, value: formatado, type: tx.type });
    setModalAberto(true);
  }

  function salvarLancamento() {
    const valor = parseBRL(form.value);
    if (!form.name.trim() || isNaN(valor) || valor <= 0) return;

    if (editandoId !== null) {
      setLancamentos(prev => prev.map(t =>
        t.id === editandoId ? { ...t, name: form.name.trim(), value: valor, type: form.type } : t
      ));
    } else {
      setLancamentos(prev => [{ id: Date.now(), name: form.name.trim(), value: valor, type: form.type }, ...prev]);
    }
    setModalAberto(false);
  }

  function excluirLancamento() {
    if (editandoId == null) return;
    const tx = lancamentos.find(t => t.id === editandoId);
    if (tx) setTxParaExcluir(tx);
  }

  function excluirLancamentoDaLista(tx) {
    setTxParaExcluir(tx);
  }

  function confirmarExclusao() {
    if (!txParaExcluir) return;
    const id = txParaExcluir.id;
    setLancamentos(prev => prev.filter(t => t.id !== id));
    setTxParaExcluir(null);
    setModalAberto(false);
  }

  return (
    <>
      <div id="sec-financas-resumo">
        <CardFinancasResumo totais={totais} />
      </div>
      <div id="sec-financas-comparativo">
        <CardFinancasComparativo lancamentos={lancamentos} onEditar={abrirEdicaoLancamento} onExcluir={excluirLancamentoDaLista} onAdicionar={abrirNovoLancamento} />
      </div>
      <div id="sec-financas-meta">
        <CardFinancasMeta
          lancamentos={lancamentos}
          onEditarLancamento={abrirEdicaoLancamento}
          onExcluirLancamento={excluirLancamentoDaLista}
          onAdicionar={abrirNovoLancamento}
        />
      </div>
      <div id="sec-financas-meta-gastos">
        <CardMetaGastos meta={metaDespesa} gasto={totais.expense} />
      </div>

      {modalAberto && (
        <ModalLancamento
          form={form}
          editando={editandoId !== null}
          onChange={setForm}
          onSalvar={salvarLancamento}
          onExcluir={excluirLancamento}
          onFechar={() => setModalAberto(false)}
          formatarValor={formatarBRL}
        />
      )}

      {txParaExcluir && (
        <ModalConfirmarExclusao
          tx={txParaExcluir}
          onConfirmar={confirmarExclusao}
          onCancelar={() => setTxParaExcluir(null)}
        />
      )}

    </>
  );
}

PaginaFinancas = forwardRef(PaginaFinancas);

function numParaTexto(n) {
  if (!n) return "";
  return String(n).replace(".", ",");
}

function numParaBRLInput(n) {
  const v = toFloat(n);
  if (!v) return "";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function numParaMoedaInput(n, classe) {
  const v = toFloat(n);
  if (!v) return "";
  const locale = ehClasseEmDolar(classe) ? "en-US" : "pt-BR";
  return v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function LinhaConfig({ label, onClick }) {
  return (
    <div className="list-row list-row-plain list-row-clickable" onClick={onClick}>
      <div className="list-row-left">
        <span className="list-row-label">{label}</span>
      </div>
      <div className="list-row-right">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-value)" }}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
        </svg>
      </div>
    </div>
  );
}

function PaginaConfiguracoes({ tema, onAlternarTema, onEditarEvolucao, onEditarRentabilidade, onEditarReserva, onEditarAlocacao, onEditarProventos, onEditarMetaDespesa, iaCfg, onSalvarIaCfg }) {
  const [formIa, setFormIa]   = useState(iaCfg);
  const [salvoIa, setSalvoIa] = useState(false);
  const alterado = formIa.url.trim() !== iaCfg.url || formIa.token.trim() !== iaCfg.token;

  function salvarIa() {
    const novo = { url: formIa.url.trim() || IA_URL_PADRAO, token: formIa.token.trim() };
    onSalvarIaCfg(novo);
    setFormIa(novo);
    setSalvoIa(true);
    setTimeout(() => setSalvoIa(false), 2200);
  }

  function restaurarIa() {
    setFormIa({ url: IA_URL_PADRAO, token: IA_TOKEN_PADRAO });
    setSalvoIa(false);
  }

  return (
    <>
      <div id="sec-configuracoes-editar">
      <Card>
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo">Valores</h2>
        </SubCard>

        <SubCard>
          <div className="config-grid">
            <LinhaConfig label="Editar evolução do patrimônio" onClick={onEditarEvolucao} />
            <LinhaConfig label="Editar rentabilidade" onClick={onEditarRentabilidade} />
            <LinhaConfig label="Editar reserva" onClick={onEditarReserva} />
            <LinhaConfig label="Editar alocação" onClick={onEditarAlocacao} />
            <LinhaConfig label="Editar proventos" onClick={onEditarProventos} />
            <LinhaConfig label="Editar meta de gastos" onClick={onEditarMetaDespesa} />
          </div>
        </SubCard>
      </Card>
      </div>

      <div id="sec-configuracoes-ia">
      <Card>
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo">Assistente IA</h2>
        </SubCard>

        <SubCard>
          <div className="ia-config ia-config-pagina">
            <p className="ia-config-texto">
              O assistente usa a Gemini através de um Worker seu na Cloudflare, que guarda a chave de API.
              A URL e o token já ficam salvos; altere aqui só se mudar o Worker.
            </p>
            <div className="form-grupo">
              <label className="campo-titulo">URL do Worker</label>
              <input
                className="form-input"
                placeholder={IA_URL_PADRAO}
                value={formIa.url}
                onChange={e => setFormIa({ ...formIa, url: e.target.value })}
                autoCapitalize="off" autoCorrect="off" spellCheck={false}
              />
            </div>
            <div className="form-grupo">
              <label className="campo-titulo">Token de acesso (o mesmo APP_TOKEN do Worker)</label>
              <input
                className="form-input"
                type="password"
                placeholder="opcional, mas recomendado"
                value={formIa.token}
                onChange={e => setFormIa({ ...formIa, token: e.target.value })}
                autoComplete="off"
              />
            </div>
            <div className="confirmar-exclusao-acoes">
              <button className="form-botao" onClick={salvarIa} disabled={!alterado && !salvoIa}>
                {salvoIa ? "Salvo" : "Salvar"}
              </button>
              <button className="form-botao form-botao-secundario" onClick={restaurarIa}>Restaurar</button>
            </div>
          </div>
        </SubCard>
      </Card>
      </div>

      <div id="sec-configuracoes-aparencia">
      <Card>
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo">Aparência</h2>
        </SubCard>

        <SubCard>
          <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)", marginBottom: "calc(var(--space-4) * -1)" }}>
            <div className="list-row-left">
              <span className="list-row-label">Mudar tema</span>
            </div>
            <div className="list-row-right">
              <div className="config-tema-toggle">
                <button
                  className={`config-tema-btn${tema === "light" ? " is-ativo" : ""}`}
                  onClick={() => tema !== "light" && onAlternarTema()}
                >
                  Claro
                </button>
                <button
                  className={`config-tema-btn${tema === "dark" ? " is-ativo" : ""}`}
                  onClick={() => tema !== "dark" && onAlternarTema()}
                >
                  Escuro
                </button>
              </div>
            </div>
          </div>
        </SubCard>
      </Card>
      </div>
    </>
  );
}

// =====================================================================
// Assistente IA — Gemini (camada gratuita) via Cloudflare Worker + function calling
// A chave da Gemini fica só no Worker; o app conversa com o Worker.
// Leituras rodam direto; qualquer alteração de dados pede confirmação.
// =====================================================================

const IA_CFG_KEY    = "acumulei_ia_cfg";
const IA_URL_PADRAO   = "https://acumulei-ia.acumulei.workers.dev";
const IA_TOKEN_PADRAO = "Acumulei-Api";
const IA_MAX_PASSOS = 6;
// true = envia um retrato resumido dos seus dados junto de cada mensagem (respostas bem mais rápidas, 1 chamada).
// false = a IA só recebe o que pedir por ferramentas (mais privado, porém mais lento).
const IA_ENVIAR_RESUMO = true;
const IA_PAGINAS    = ["patrimonio", "investimentos", "financas", "configuracoes"];

const IA_SUGESTOES = [
  "Qual ativo está com maior valorização?",
  "Qual ativo mais perdeu valor?",
  "Quanto tenho em cada classe?",
  "Em qual classe devo aportar?",
  "Como estão meus gastos?",
  "Qual o meu patrimônio total?",
  "Quanto já aportei no total?",
  "Qual minha rentabilidade geral?",
  "Quanto tenho na reserva?",
  "Quais são meus 5 maiores ativos?",
  "Como está minha alocação em relação às metas?",
  "Quanto tenho em ações?",
  "Quanto tenho em fundos imobiliários?",
  "Quanto tenho em dólar?",
  "Qual a cotação do dólar hoje?",
  "Quanto tenho em bitcoin?",
  "Quanto já recebi de proventos?",
  "Qual foi meu melhor ano de proventos?",
  "Quais foram meus últimos lançamentos?",
  "Qual minha maior despesa do mês?",
  "Estou dentro da meta de gastos?",
  "Quanto sobrou este mês?",
  "Qual classe está mais distante da meta?",
  "Me dê um resumo da minha carteira",
  "Quais ativos estão no prejuízo?",
  "Qual o preço médio do meu maior ativo?",
  "Mude o tema para claro",
  "Vá para a página de finanças",
  "Abra as configurações",
];

function sortearSugestoesIA(qtd = 5) {
  const a = [...IA_SUGESTOES];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, qtd);
}

const IA_SISTEMA = `Você é o assistente do Acumulei, o app pessoal do usuário para acompanhar patrimônio, investimentos e finanças.
Responda sempre em português do Brasil, de forma curta e direta.
Nunca invente números. No fim destas instruções há um RETRATO ATUAL dos dados do usuário: use-o para responder. Chame as ferramentas de leitura só quando faltar algum detalhe (ex.: preço médio, quantidade, cotação).
Valores em R$, exceto onde indicado. Stocks e REITs têm cotação e preço médio em US$, mas os totais das ferramentas já vêm convertidos para R$.
Classes de ativos: stock, reit, acao, fii, bitcoin. A reserva é separada dos ativos.
O app registra os proventos (dividendos, JCP e rendimentos) recebidos por ano; use o campo proventos do retrato ou a ferramenta listar_proventos para responder sobre eles.
Para alterar qualquer dado use as ferramentas de ação. O app já pede a confirmação ao usuário, então chame a ferramenta direto, sem pedir permissão em texto. Se faltar alguma informação (ex.: o valor), pergunte antes.
"Metas" pode ser: metas de alocação por classe (campo classes) e meta de gastos mensal (campo financas). Quando o usuário perguntar sobre "minhas metas" em geral, inclua as duas.
Você pode apontar fatos e comparar com as metas do usuário, mas não trate isso como recomendação financeira garantida.
Formato: texto simples; pode usar **negrito** e listas com "-".`;

const IA_FERRAMENTAS = [
  {
    name: "listar_proventos",
    description: "Proventos (dividendos, JCP e rendimentos) recebidos por ano, em R$: total de cada ano, total acumulado, média anual e melhor ano. Use para qualquer pergunta sobre dividendos ou proventos.",
    parameters: {
      type: "OBJECT",
      properties: { ano: { type: "INTEGER", description: "Opcional. Retorna só este ano (ex.: 2025)." } },
    },
  },
  {
    name: "resumo_geral",
    description: "Totais do patrimônio: valor atual, aportado, variação, investimentos, reserva, valor em dólar e cotação do dólar.",
  },
  {
    name: "resumo_classes",
    description: "Resumo por classe (stocks, reits, ações, fiis, bitcoins e reserva): total, aportado, variação, % do patrimônio, % da meta e diferença para a meta.",
  },
  {
    name: "ranking_ativos",
    description: "Lista ativos ordenados por um critério. Use para maior/menor valorização, maiores posições, ativos mais abaixo da meta etc.",
    parameters: {
      type: "OBJECT",
      properties: {
        ordenar_por: {
          type: "STRING",
          enum: ["variacao_percentual", "variacao_total", "total_atual", "total_investido", "porcentagem_atual", "porcentagem_sobrando_faltando"],
          description: "Critério. porcentagem_sobrando_faltando: negativo = abaixo da meta da classe.",
        },
        ordem:  { type: "STRING", enum: ["desc", "asc"], description: "desc = maiores primeiro (padrão)." },
        classe: { type: "STRING", enum: ["stock", "reit", "acao", "fii", "bitcoin"], description: "Filtrar por classe (opcional)." },
        limite: { type: "NUMBER", description: "Quantos ativos retornar (padrão 5, máximo 30)." },
      },
      required: ["ordenar_por"],
    },
  },
  {
    name: "buscar_ativo",
    description: "Detalhes de um ativo (quantidade, preço médio, cotação, variação, % da meta) por ticker ou nome.",
    parameters: {
      type: "OBJECT",
      properties: { consulta: { type: "STRING", description: "Ticker ou parte do nome." } },
      required: ["consulta"],
    },
  },
  {
    name: "listar_lancamentos",
    description: "Receitas e despesas cadastradas na aba Finanças, totais, saldo e meta de gastos.",
  },
  {
    name: "editar_ativo",
    description: "Altera (ou cadastra, se não existir) um ativo. Envie só os campos que mudam. preço médio em US$ para stock/reit e em R$ para os demais; dólar médio na compra em R$.",
    parameters: {
      type: "OBJECT",
      properties: {
        ticker:           { type: "STRING" },
        nome:             { type: "STRING" },
        classe:           { type: "STRING", enum: ["stock", "reit", "acao", "fii", "bitcoin"], description: "Obrigatória só para ativo novo." },
        quantidade:       { type: "NUMBER" },
        preco_medio:      { type: "NUMBER" },
        dolar_compra:     { type: "NUMBER" },
        porcentagem_meta: { type: "NUMBER", description: "% meta dentro da classe." },
      },
      required: ["ticker"],
    },
  },
  {
    name: "remover_ativo",
    description: "Remove o cadastro de um ativo.",
    parameters: { type: "OBJECT", properties: { ticker: { type: "STRING" } }, required: ["ticker"] },
  },
  {
    name: "definir_reserva",
    description: "Define o valor atual da reserva, em R$.",
    parameters: { type: "OBJECT", properties: { valor: { type: "NUMBER" } }, required: ["valor"] },
  },
  {
    name: "definir_meta_alocacao",
    description: "Define a meta de alocação (% do patrimônio) de uma classe.",
    parameters: {
      type: "OBJECT",
      properties: {
        classe:     { type: "STRING", enum: ["stocks", "reits", "acoes", "fiis", "bitcoins", "reservas"] },
        percentual: { type: "NUMBER", description: "De 0 a 100." },
      },
      required: ["classe", "percentual"],
    },
  },
  {
    name: "definir_meta_gastos",
    description: "Define a meta mensal de gastos, em R$ (0 remove a meta).",
    parameters: { type: "OBJECT", properties: { valor: { type: "NUMBER" } }, required: ["valor"] },
  },
  {
    name: "adicionar_lancamento",
    description: "Adiciona uma receita ou despesa na aba Finanças.",
    parameters: {
      type: "OBJECT",
      properties: {
        tipo:      { type: "STRING", enum: ["receita", "despesa"] },
        descricao: { type: "STRING" },
        valor:     { type: "NUMBER", description: "Valor positivo em R$." },
      },
      required: ["tipo", "descricao", "valor"],
    },
  },
  {
    name: "remover_lancamento",
    description: "Exclui um lançamento pela descrição.",
    parameters: {
      type: "OBJECT",
      properties: {
        descricao: { type: "STRING" },
        tipo:      { type: "STRING", enum: ["receita", "despesa"], description: "Opcional, para desambiguar." },
      },
      required: ["descricao"],
    },
  },
  {
    name: "alterar_tema",
    description: "Troca o tema do app.",
    parameters: { type: "OBJECT", properties: { tema: { type: "STRING", enum: ["claro", "escuro"] } }, required: ["tema"] },
  },
  {
    name: "ir_para_pagina",
    description: "Navega para uma página do app.",
    parameters: { type: "OBJECT", properties: { pagina: { type: "STRING", enum: ["patrimonio", "investimentos", "financas", "configuracoes"] } }, required: ["pagina"] },
  },
];

const IA_ACOES_COM_CONFIRMACAO = new Set([
  "editar_ativo", "remover_ativo", "definir_reserva", "definir_meta_alocacao",
  "definir_meta_gastos", "adicionar_lancamento", "remover_lancamento",
]);
const IA_ACOES_LIVRES = new Set(["alterar_tema", "ir_para_pagina"]);

function carregarCfgIA() {
  try {
    const c = JSON.parse(localStorage.getItem(IA_CFG_KEY) || "{}");
    const url = String(c.url ?? "").trim();
    const token = String(c.token ?? "").trim();
    return {
      url: url || IA_URL_PADRAO,
      token: token || IA_TOKEN_PADRAO,
    };
  } catch {
    return { url: IA_URL_PADRAO, token: IA_TOKEN_PADRAO };
  }
}

function salvarCfgIA(cfg) {
  try { localStorage.setItem(IA_CFG_KEY, JSON.stringify(cfg)); } catch {}
}

function semAcento(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function r2(n) { return Math.round(toFloat(n) * 100) / 100; }

function temNumero(v) {
  return v != null && String(v).trim() !== "" && !isNaN(parseFloat(String(v).replace(",", ".")));
}

const MAPA_CLASSE_IA = {
  stock: "stock", stocks: "stock", reit: "reit", reits: "reit",
  acao: "acao", acoes: "acao", fii: "fii", fiis: "fii",
  bitcoin: "bitcoin", bitcoins: "bitcoin", btc: "bitcoin",
};
const SUFIXO_POR_CLASSE_IA = { stock: "stocks", reit: "reits", acao: "acoes", fii: "fiis", bitcoin: "bitcoins" };

function normalizarClasseIA(x) { return MAPA_CLASSE_IA[semAcento(x)] ?? null; }

function sufixoMetaIA(x) {
  const s = semAcento(x);
  if (s === "reserva" || s === "reservas") return "reservas";
  const cl = normalizarClasseIA(x);
  return cl ? SUFIXO_POR_CLASSE_IA[cl] : null;
}

function mapAtivoIA(a) {
  return {
    ticker: String(a.ticker).toUpperCase(),
    nome: a.nome,
    classe: a.classe,
    quantidade: toFloat(a.quantidade),
    cotacao_moeda_original: r2(a.cotacao),
    total_atual_brl: r2(a.total_atual),
    total_investido_brl: r2(a.total_investido),
    variacao_total_brl: r2(a.variacao_total),
    variacao_percentual: r2(a.variacao_percentual),
    porcentagem_atual_na_classe: r2(a.porcentagem_atual),
    porcentagem_meta_na_classe: r2(a.porcentagem_meta),
    sobrando_faltando_pct: r2(a.porcentagem_sobrando_faltando),
  };
}

function executarLeituraIA(nome, args, c) {
  const t = c.totais?.[0] ?? {};
  switch (nome) {
    case "resumo_geral": {
      const aportado = toFloat(t.total_aportado);
      const dif = toFloat(t.total_diferenca_patrimonio);
      return {
        patrimonio_total_brl: r2(t.total_patrimonio),
        aportado_brl: r2(aportado),
        variacao_brl: r2(dif),
        variacao_pct: aportado > 0 ? r2((dif / aportado) * 100) : 0,
        investimentos_brl: r2(t.total_investimentos),
        reserva_brl: r2(c.dadosLocais.reserva_atual),
        patrimonio_usd: r2(t.total_patrimonio_usd),
        cotacao_dolar: r2(c.taxaDolar),
        quantidade_ativos: c.ativos.filter(a => toFloat(a.quantidade) > 0).length,
      };
    }

    case "resumo_classes": {
      const al = c.alocacao?.[0] ?? {};
      const classes = CLASSES_ATIVOS.map(({ titulo, sufixo }) => {
        const total = toFloat(t[`total_${sufixo}`]);
        const aportado = toFloat(t[`total_aportado_${sufixo}`]);
        return {
          classe: titulo,
          total_brl: r2(total),
          aportado_brl: r2(aportado),
          variacao_brl: r2(total - aportado),
          variacao_pct: aportado > 0 ? r2(((total - aportado) / aportado) * 100) : 0,
          pct_do_patrimonio: r2(al[`alocacao_atual_${sufixo}`]),
          meta_pct: r2(al[`alocacao_ideal_${sufixo}`]),
          diferenca_pct: r2(al[`alocacao_diferenca_${sufixo}`]),
        };
      });
      classes.push({
        classe: "Reserva",
        total_brl: r2(c.dadosLocais.reserva_atual),
        pct_do_patrimonio: r2(al.alocacao_atual_reservas),
        meta_pct: r2(al.alocacao_ideal_reservas),
        diferenca_pct: r2(al.alocacao_diferenca_reservas),
      });
      return { classes, observacao: "diferenca_pct negativa = abaixo da meta (falta aportar); positiva = acima da meta." };
    }

    case "ranking_ativos": {
      const chaves = ["variacao_percentual", "variacao_total", "total_atual", "total_investido", "porcentagem_atual", "porcentagem_sobrando_faltando"];
      const ordenar = chaves.includes(args.ordenar_por) ? args.ordenar_por : "variacao_percentual";
      const dir = args.ordem === "asc" ? 1 : -1;
      const classe = args.classe != null ? normalizarClasseIA(args.classe) : null;
      if (args.classe != null && !classe) return { erro: `Classe inválida: ${args.classe}.` };
      const limite = Math.min(Math.max(parseInt(args.limite, 10) || 5, 1), 30);
      const base = c.ativos.filter(a => toFloat(a.quantidade) > 0 && (!classe || a.classe === classe));
      const ativos = [...base]
        .sort((x, y) => (toFloat(x[ordenar]) - toFloat(y[ordenar])) * dir)
        .slice(0, limite)
        .map(mapAtivoIA);
      return { ordenado_por: ordenar, ordem: dir === 1 ? "asc" : "desc", total_considerados: base.length, ativos };
    }

    case "buscar_ativo": {
      const q = semAcento(args.consulta);
      if (!q) return { erro: "Informe o ticker ou o nome." };
      const achados = c.ativos
        .filter(a => semAcento(a.ticker).includes(q) || semAcento(a.nome).includes(q))
        .sort((x, y) => (semAcento(y.ticker) === q) - (semAcento(x.ticker) === q))
        .slice(0, 5);
      if (!achados.length) return { erro: `Nenhum ativo encontrado para "${args.consulta}".` };
      return {
        ativos: achados.map(a => ({ ...mapAtivoIA(a), preco_medio_moeda_original: r2(a.preco_medio), dolar_medio_compra: r2(a.dolar_compra) })),
      };
    }

    case "listar_proventos": {
      const todos = (c.dadosLocais?.proventos ?? [])
        .map(r => ({ ano: String(r.ano ?? "").trim(), valor: toFloat(r.total_ano) }))
        .filter(r => r.ano)
        .sort((a, b) => parseInt(a.ano, 10) - parseInt(b.ano, 10));
      if (!todos.length) return { erro: "Nenhum provento cadastrado. O usuário pode cadastrar em Configurações > Editar proventos." };
      const total = todos.reduce((s, r) => s + r.valor, 0);
      const anos = todos.length > 1 ? parseInt(todos[todos.length - 1].ano, 10) - parseInt(todos[0].ano, 10) : 0;
      const melhor = todos.reduce((m, r) => (r.valor > m.valor ? r : m), todos[0]);
      const filtro = args?.ano != null ? String(args.ano).trim() : null;
      const lista = filtro ? todos.filter(r => r.ano === filtro) : todos;
      if (filtro && !lista.length) return { erro: `Não há proventos cadastrados para ${filtro}.`, anos_disponiveis: todos.map(r => r.ano) };
      return {
        proventos_por_ano: lista.map(r => ({ ano: r.ano, total_brl: r2(r.valor) })),
        total_acumulado_brl: r2(total),
        media_anual_brl: anos > 0 ? r2(total / anos) : null,
        melhor_ano: { ano: melhor.ano, total_brl: r2(melhor.valor) },
      };
    }

    case "listar_lancamentos": {
      const lista = c.lancamentos ?? [];
      const receitas = lista.filter(l => l.type === "income").reduce((s, l) => s + toFloat(l.value), 0);
      const despesas = lista.filter(l => l.type === "expense").reduce((s, l) => s + toFloat(l.value), 0);
      const meta = toFloat(c.metaDespesa);
      return {
        lancamentos: lista.map(l => ({ tipo: l.type === "income" ? "receita" : "despesa", descricao: l.name, valor_brl: r2(l.value) })),
        receitas_total_brl: r2(receitas),
        despesas_total_brl: r2(despesas),
        saldo_brl: r2(receitas - despesas),
        meta_gastos_brl: r2(meta),
        restante_da_meta_brl: meta > 0 ? r2(meta - despesas) : null,
      };
    }

    default:
      return { erro: `Ferramenta desconhecida: ${nome}.` };
  }
}

function montarResumoIA(c) {
  if (!c?.totais?.length) return "";
  const geral = executarLeituraIA("resumo_geral", {}, c);
  const classes = executarLeituraIA("resumo_classes", {}, c).classes;
  const ativos = c.ativos
    .filter(a => toFloat(a.quantidade) > 0)
    .slice(0, 80)
    .map(a => {
      const m = mapAtivoIA(a);
      return {
        ticker: m.ticker, nome: m.nome, classe: m.classe,
        total_brl: m.total_atual_brl, variacao_brl: m.variacao_total_brl, variacao_pct: m.variacao_percentual,
        pct_na_classe: m.porcentagem_atual_na_classe, meta_na_classe: m.porcentagem_meta_na_classe,
        sobrando_faltando_pct: m.sobrando_faltando_pct,
      };
    });
  const fin = executarLeituraIA("listar_lancamentos", {}, c);
  fin.lancamentos = fin.lancamentos.slice(0, 40);
  const prov = executarLeituraIA("listar_proventos", {}, c);
  return `\n\nRETRATO ATUAL (R$; variacao_pct = valorização sobre o aportado; sobrando_faltando_pct negativo = abaixo da meta):\n` +
    JSON.stringify({ geral, classes, ativos, financas: fin, proventos: prov.erro ? null : prov });
}

function descreverAcaoIA(nome, a) {
  const brl = v => fmtBRL(toFloat(v));
  const tk  = String(a.ticker ?? "").toUpperCase();
  switch (nome) {
    case "editar_ativo": {
      const p = [];
      if (a.nome != null)             p.push(`nome: ${a.nome}`);
      if (a.classe != null)           p.push(`classe: ${a.classe}`);
      if (a.quantidade != null)       p.push(`quantidade: ${a.quantidade}`);
      if (a.preco_medio != null)      p.push(`preço médio: ${a.preco_medio}`);
      if (a.dolar_compra != null)     p.push(`dólar médio: ${brl(a.dolar_compra)}`);
      if (a.porcentagem_meta != null) p.push(`% meta: ${a.porcentagem_meta}%`);
      return `Alterar o ativo ${tk}${p.length ? ` — ${p.join(", ")}` : ""}`;
    }
    case "remover_ativo":          return `Remover o cadastro do ativo ${tk}`;
    case "definir_reserva":        return `Definir a reserva em ${brl(a.valor)}`;
    case "definir_meta_alocacao":  return `Definir a meta de ${a.classe} em ${toFloat(a.percentual)}%`;
    case "definir_meta_gastos":    return `Definir a meta de gastos em ${brl(a.valor)}`;
    case "adicionar_lancamento":   return `Adicionar ${semAcento(a.tipo) === "receita" ? "receita" : "despesa"} "${a.descricao}" de ${brl(a.valor)}`;
    case "remover_lancamento":     return `Excluir o lançamento "${a.descricao}"`;
    default:                       return nome;
  }
}

function criarExecutorIA({ ctxRef, setDadosLocais, setLancamentos, setMetaDespesa, setTema, irParaPagina }) {
  const erro = (mensagem) => ({ ok: false, erro: mensagem });

  return (nome, a) => {
    const c = ctxRef.current;
    const ativosSalvos = c?.dadosLocais?.ativos ?? {};
    const achaChave = (ticker) =>
      Object.keys(ativosSalvos).find(k => k.toLowerCase() === String(ticker).toLowerCase());

    switch (nome) {
      case "editar_ativo": {
        const ticker = String(a.ticker ?? "").trim();
        if (!ticker) return erro("Informe o ticker do ativo.");
        const chave = achaChave(ticker);
        const classe = a.classe != null ? normalizarClasseIA(a.classe) : null;
        if (a.classe != null && !classe) return erro(`Classe inválida: ${a.classe}.`);
        if (!chave && !classe) return erro("Esse ticker não está cadastrado. Para criar um ativo novo, informe a classe.");

        setDadosLocais(prev => {
          const ativos = { ...(prev.ativos ?? {}) };
          const k = Object.keys(ativos).find(x => x.toLowerCase() === ticker.toLowerCase()) ?? ticker.toLowerCase();
          const novo = { ...(ativos[k] ?? { nome: "", classe: "", quantidade: 0, preco_medio: 0, dolar_compra: 0, porcentagem_meta: 0, cotacao: 0 }) };
          if (classe) novo.classe = classe;
          if (a.nome != null)             novo.nome = String(a.nome).trim();
          if (a.quantidade != null)       novo.quantidade = toFloat(a.quantidade);
          if (a.preco_medio != null)      novo.preco_medio = toFloat(a.preco_medio);
          if (a.dolar_compra != null)     novo.dolar_compra = toFloat(a.dolar_compra);
          if (a.porcentagem_meta != null) novo.porcentagem_meta = toFloat(a.porcentagem_meta);
          ativos[k] = novo;
          return { ...prev, ativos };
        });
        return chave
          ? { ok: true, mensagem: `Ativo ${ticker.toUpperCase()} atualizado.` }
          : { ok: true, mensagem: `Ativo ${ticker.toUpperCase()} cadastrado. A cotação vem da planilha: confirme que o ticker existe nela.` };
      }

      case "remover_ativo": {
        const ticker = String(a.ticker ?? "").trim();
        const chave = achaChave(ticker);
        if (!chave) return erro(`Ativo ${ticker.toUpperCase()} não está cadastrado.`);
        setDadosLocais(prev => {
          const ativos = { ...(prev.ativos ?? {}) };
          const k = Object.keys(ativos).find(x => x.toLowerCase() === ticker.toLowerCase());
          if (k) delete ativos[k];
          return { ...prev, ativos };
        });
        return { ok: true, mensagem: `Cadastro de ${ticker.toUpperCase()} removido.` };
      }

      case "definir_reserva": {
        if (!temNumero(a.valor) || toFloat(a.valor) < 0) return erro("Informe um valor válido para a reserva.");
        const v = toFloat(a.valor);
        setDadosLocais(prev => ({ ...prev, reserva_atual: v }));
        return { ok: true, mensagem: `Reserva definida em ${fmtBRL(v)}.` };
      }

      case "definir_meta_alocacao": {
        const suf = sufixoMetaIA(a.classe);
        if (!suf) return erro(`Classe inválida: ${a.classe}.`);
        if (!temNumero(a.percentual)) return erro("Informe o percentual da meta.");
        const p = toFloat(a.percentual);
        if (p < 0 || p > 100) return erro("O percentual precisa estar entre 0 e 100.");
        setDadosLocais(prev => ({ ...prev, metas: { ...(prev.metas ?? {}), [suf]: p } }));
        const titulo = ALOCACAO_CLASSES.find(x => x.sufixo === suf)?.titulo ?? suf;
        const soma = ALOCACAO_CLASSES.reduce(
          (s, x) => s + (x.sufixo === suf ? p : toFloat(c?.dadosLocais?.metas?.[x.sufixo])), 0
        );
        return { ok: true, mensagem: `Meta de ${titulo} definida em ${p}%. Soma das metas: ${r2(soma)}%.`, soma_das_metas_pct: r2(soma) };
      }

      case "definir_meta_gastos": {
        if (!temNumero(a.valor) || toFloat(a.valor) < 0) return erro("Informe um valor válido para a meta de gastos.");
        const v = toFloat(a.valor);
        setMetaDespesa(v);
        return { ok: true, mensagem: v > 0 ? `Meta de gastos definida em ${fmtBRL(v)}.` : "Meta de gastos removida." };
      }

      case "adicionar_lancamento": {
        const tp = semAcento(a.tipo);
        const type = tp === "receita" ? "income" : tp === "despesa" ? "expense" : null;
        const descricao = String(a.descricao ?? "").trim();
        if (!type) return erro("O tipo precisa ser receita ou despesa.");
        if (!descricao) return erro("Informe a descrição do lançamento.");
        if (!temNumero(a.valor) || toFloat(a.valor) <= 0) return erro("Informe um valor maior que zero.");
        const valor = toFloat(a.valor);
        setLancamentos(prev => [{ id: Date.now(), name: descricao, value: valor, type }, ...prev]);
        return { ok: true, mensagem: `${type === "income" ? "Receita" : "Despesa"} "${descricao}" de ${fmtBRL(valor)} adicionada.` };
      }

      case "remover_lancamento": {
        const q = semAcento(a.descricao);
        if (!q) return erro("Informe a descrição do lançamento.");
        const tp = semAcento(a.tipo);
        const type = tp === "receita" ? "income" : tp === "despesa" ? "expense" : null;
        const achados = (c?.lancamentos ?? []).filter(l =>
          semAcento(l.name).includes(q) && (!type || l.type === type)
        );
        if (achados.length === 0) return erro(`Nenhum lançamento encontrado para "${a.descricao}".`);
        if (achados.length > 1) {
          return erro(`Vários lançamentos correspondem: ${achados.map(l => `"${l.name}"`).join(", ")}. Peça ao usuário para especificar.`);
        }
        const alvo = achados[0];
        setLancamentos(prev => prev.filter(l => l.id !== alvo.id));
        return { ok: true, mensagem: `Lançamento "${alvo.name}" excluído.` };
      }

      case "alterar_tema": {
        const s = semAcento(a.tema);
        const novo = s === "claro" || s === "light" ? "light" : s === "escuro" || s === "dark" ? "dark" : null;
        if (!novo) return erro("O tema precisa ser claro ou escuro.");
        setTema(novo);
        return { ok: true, mensagem: `Tema ${novo === "light" ? "claro" : "escuro"} ativado.` };
      }

      case "ir_para_pagina": {
        const p = semAcento(a.pagina);
        if (!IA_PAGINAS.includes(p)) return erro(`Página inválida: ${a.pagina}.`);
        irParaPagina(p);
        return { ok: true, mensagem: `Abri a página ${p}.` };
      }

      default:
        return erro(`Ferramenta desconhecida: ${nome}.`);
    }
  };
}

async function chamarGemini(cfg, contents, signal, sistema = IA_SISTEMA) {
  const headers = { "Content-Type": "application/json" };
  if (cfg.token) headers["x-app-token"] = cfg.token;

  const resp = await fetch(cfg.url.trim().replace(/\/+$/, "").replace(/\/chat$/, "") + "/chat", {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sistema }] },
      contents,
      tools: [{ functionDeclarations: IA_FERRAMENTAS }],
      generationConfig: { temperature: 0.3 },
    }),
  });

  if (!resp.ok) {
    let detalhe = "";
    try {
      const j = await resp.json();
      detalhe = j?.error?.message || (typeof j?.error === "string" ? j.error : "");
    } catch {}
    const err = new Error(detalhe || `Erro ${resp.status} ao falar com o Worker.`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

function mensagemErroIA(e) {
  if (e?.status === 401) return "Token inválido. Confira o token em Configurações > Assistente IA.";
  if (e?.status === 403) return "Origem não autorizada no Worker (confira ALLOWED_ORIGINS).";
  if (e?.status === 404) return "Endereço do Worker não encontrado (404). Confira a URL em Configurações > Assistente IA: ela deve ser só https://nome.usuario.workers.dev, sem nada depois.";
  if (e?.status === 429) return "O limite gratuito da Gemini foi atingido por agora. Tente de novo em instantes.";
  if (e?.status === 503 || e?.status === 500 || e?.status === 504) return "A Gemini está sobrecarregada no momento (já tentei algumas vezes). Tente de novo em alguns segundos.";
  if (e instanceof TypeError) {
    const origem = typeof window !== "undefined" ? window.location.origin : "";
    return `Não consegui falar com o Worker. Confira a URL em Configurações > Assistente IA e sua conexão. Se a URL estiver certa, o Worker pode estar bloqueando esta origem (${origem}): inclua-a em ALLOWED_ORIGINS.`;
  }
  return e?.message || "Erro inesperado.";
}

function podarHistoricoIA(hist) {
  if (hist.length <= 40) return hist;
  let i = hist.length - 30;
  while (i < hist.length && !(hist[i].role === "user" && hist[i].parts?.[0]?.text)) i++;
  return i < hist.length ? hist.slice(i) : hist;
}

function TextoIA({ texto }) {
  return (
    <>
      {String(texto).split("\n").map((linha, i) => {
        const bullet = /^\s*[-*•]\s+/.test(linha);
        const conteudo = linha.replace(/^\s*[-*•]\s+/, "");
        const partes = conteudo.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
          p.length > 4 && p.startsWith("**") && p.endsWith("**")
            ? <strong key={j}>{p.slice(2, -2)}</strong>
            : p
        );
        return (
          <div key={i} className={bullet ? "ia-li" : undefined}>
            {partes}
            {!linha && <br />}
          </div>
        );
      })}
    </>
  );
}

function AssistenteIA({ cfg, ctxRef, aberto, setAberto, onOcupado }) {
  const [msgs, setMsgs]                 = useState([]);
  const [texto, setTexto]               = useState("");
  const [ocupado, setOcupado]           = useState(false);
  const [pendente, setPendente]         = useState(null);
  const [aviso, setAviso]               = useState(null);
  const [topo, setTopo]                 = useState(90);
  const [dir, setDir]                   = useState(30);
  const [caixaNav, setCaixaNav]         = useState({ dir: 18, larg: 0 });
  const [sugestoes, setSugestoes]       = useState(() => sortearSugestoesIA());
  const [telaPequena, setTelaPequena]   = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const atualizar = () => setTelaPequena(mq.matches);
    atualizar();
    mq.addEventListener ? mq.addEventListener("change", atualizar) : mq.addListener(atualizar);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", atualizar) : mq.removeListener(atualizar); };
  }, []);

  const ilhaRef   = useRef(null);
  const abertoRef = useRef(false);
  abertoRef.current = aberto;

  // avisa o botão da barra superior quando a IA está trabalhando
  useEffect(() => { onOcupado?.(ocupado || !!pendente); }, [ocupado, pendente]);
  const histRef   = useRef([]);
  const abortRef  = useRef(null);
  const corpoRef  = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    const el = corpoRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, ocupado, pendente, aberto]);

  useEffect(() => {
    if (!aberto) return;
    const onKey = (e) => e.key === "Escape" && fechar();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (aberto && typeof window !== "undefined" && window.innerWidth > 640) {
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [aberto]);

  // novas sugestões a cada vez que o chat é aberto
  useEffect(() => { if (aberto) setSugestoes(sortearSugestoesIA()); }, [aberto]);

  // aviso curto na ilha (como uma "atividade ao vivo"), some sozinho
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 2800);
    return () => clearTimeout(t);
  }, [aviso]);

  // a ilha fica logo abaixo da barra superior
  useEffect(() => {
    const medir = () => {
      const nav = document.querySelector(".navbar");
      if (!nav) return;
      setTopo(Math.round(nav.getBoundingClientRect().bottom) + 10);
      const alvo = document.querySelector("[data-ia-btn]") || nav;
      setDir(Math.max(12, Math.round(window.innerWidth - alvo.getBoundingClientRect().right)));
      const rn = nav.getBoundingClientRect();
      const novo = { dir: Math.max(0, Math.round(window.innerWidth - rn.right)), larg: Math.round(rn.width) };
      setCaixaNav(c => (c.dir === novo.dir && c.larg === novo.larg ? c : novo));
    };
    medir();
    const id = setInterval(medir, 400);
    window.addEventListener("resize", medir);
    return () => { clearInterval(id); window.removeEventListener("resize", medir); };
  }, []);

  // tocar fora recolhe a ilha
  useEffect(() => {
    if (!aberto) return;
    const fora = (e) => {
      if (e.target.closest?.("[data-ia-btn]")) return; // o botão da barra faz o próprio toggle
      if (ilhaRef.current && !ilhaRef.current.contains(e.target)) setAberto(false);
    };
    document.addEventListener("pointerdown", fora);
    return () => document.removeEventListener("pointerdown", fora);
  }, [aberto]);

  function fechar() {
    setAberto(false);
  }

  function novaConversa() {
    abortRef.current?.abort();
    pendente?.resolve(false);
    setPendente(null);
    histRef.current = [];
    setMsgs([]);
    setSugestoes(sortearSugestoesIA());
  }

  async function rodarFerramenta(nome, args) {
    const c0 = ctxRef.current;
    if (!c0) return { erro: "Os dados ainda não foram carregados." };

    if (IA_ACOES_COM_CONFIRMACAO.has(nome)) {
      const ok = await new Promise(resolve =>
        setPendente({ texto: descreverAcaoIA(nome, args), resolve })
      );
      setPendente(null);
      if (!ok) {
        setMsgs(m => [...m, { role: "sys", texto: "Ação cancelada" }]);
        return { ok: false, mensagem: "O usuário cancelou a ação. Nada foi alterado." };
      }
      const r = ctxRef.current.executar(nome, args);
      if (!r.ok) setMsgs(m => [...m, { role: "sys", texto: `Não foi possível: ${r.erro}` }]);
      else if (!abertoRef.current) setAviso({ texto: r.mensagem });
      return r;
    }

    if (IA_ACOES_LIVRES.has(nome)) {
      const r = c0.executar(nome, args);
      if (r.ok && !abertoRef.current) setAviso({ texto: r.mensagem });
      return r;
    }

    return executarLeituraIA(nome, args, c0);
  }

  async function enviar(textoUsuario) {
    const pergunta = String(textoUsuario ?? "").trim();
    if (!pergunta || ocupado || !cfg.url) return;

    setTexto("");
    setMsgs(m => [...m, { role: "user", texto: pergunta }]);
    setOcupado(true);
    const historicoAntes = histRef.current;
    histRef.current = podarHistoricoIA([...historicoAntes, { role: "user", parts: [{ text: pergunta }] }]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      for (let passo = 0; passo < IA_MAX_PASSOS; passo++) {
        const sistema = IA_SISTEMA + (IA_ENVIAR_RESUMO ? montarResumoIA(ctxRef.current) : "");
        const data = await chamarGemini(cfg, histRef.current, ctrl.signal, sistema);
        const content = data?.candidates?.[0]?.content;

        if (!content?.parts?.length) {
          const motivo = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
          setMsgs(m => [...m, { role: "ia", texto: `A IA não retornou resposta${motivo ? ` (${motivo})` : ""}. Tente reformular.` }]);
          break;
        }

        histRef.current.push({ role: "model", parts: content.parts });

        const chamadas = content.parts.filter(p => p.functionCall);
        const resposta = content.parts.filter(p => p.text && !p.thought).map(p => p.text).join("").trim();

        if (!chamadas.length) {
          setMsgs(m => [...m, { role: "ia", texto: resposta || "Sem resposta." }]);
          break;
        }

        const respostas = [];
        for (const p of chamadas) {
          const { name, args } = p.functionCall;
          const resultado = await rodarFerramenta(name, args ?? {});
          respostas.push({ functionResponse: { name, response: resultado } });
        }
        histRef.current.push({ role: "user", parts: respostas });

        if (passo === IA_MAX_PASSOS - 1) {
          setMsgs(m => [...m, { role: "ia", texto: "Precisei de passos demais para responder. Tente dividir o pedido em partes menores." }]);
        }
      }
    } catch (e) {
      if (e?.name !== "AbortError") {
        setMsgs(m => [...m, { role: "erro", texto: mensagemErroIA(e) }]);
        // volta o histórico ao estado anterior à pergunta, para não deixar uma chamada de ferramenta sem resposta
        histRef.current = historicoAntes;
      }
    } finally {
      setOcupado(false);
      setPendente(null);
      if (!abertoRef.current && !ctrl.signal.aborted) setAviso({ texto: "Resposta pronta" });
    }
  }

  const bloqueado = ocupado || !!pendente;
  const modo = aberto ? "aberto" : pendente ? "confirmar" : aviso ? "aviso" : ocupado ? "pensando" : "ocioso";
  const compacto = modo === "aviso";

  function abrirIlha() { if (!aberto) setAberto(true); }

  return createPortal(
    <div
      ref={ilhaRef}
      className={`ia-ilha ia-ilha-${modo}`}
      style={{ "--ia-topo": `${topo}px`, "--ia-dir": `${dir}px`, "--ia-nav-dir": `${caixaNav.dir}px`, "--ia-nav-larg": caixaNav.larg ? `${caixaNav.larg}px` : "calc(100vw - 36px)" }}
      role={aberto ? "dialog" : "button"}
      aria-label={aberto ? "Assistente de IA" : "Abrir assistente de IA"}
      tabIndex={compacto ? 0 : undefined}
      onClick={compacto ? abrirIlha : undefined}
      onKeyDown={compacto ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrirIlha(); } }) : undefined}
    >
      <div className="ia-ilha-mini" aria-hidden={aberto}>
        <div className="ia-ilha-mini-in" key={modo}>
          {modo === "aviso" && (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3fd0c4" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              <span className="ia-ilha-aviso-txt">{aviso?.texto}</span>
            </>
          )}
          {modo === "confirmar" && pendente && (
            <div className="ia-ilha-conf">
              <div className="ia-ilha-conf-titulo"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#3fd0c4", flexShrink: 0 }}>
                <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
                <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
              </svg><span>Confirmar alteração?</span></div>
              <div className="ia-ilha-conf-texto">{pendente.texto}</div>
              <div className="ia-ilha-conf-acoes">
                <button className="ia-ilha-btn ia-ilha-btn-ok" onClick={() => pendente.resolve(true)}>Confirmar</button>
                <button className="ia-ilha-btn" onClick={() => pendente.resolve(false)}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="ia-ilha-cheio">
          <div className="ia-header">
            <div className="ia-header-titulo">
              <img src="/assets/icone_ia.png" alt="" width="24" height="24" className="ia-header-icone" draggable="false" />
              <span>Assistente</span>
            </div>
            <div className="ia-header-acoes">
              <button className="btn-tema ia-icone" onClick={novaConversa} aria-label="Nova conversa" title="Nova conversa">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />
                </svg>
              </button>
              <button className="btn-tema ia-icone" onClick={fechar} aria-label="Fechar" title="Fechar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 6l12 12" /><path d="M18 6L6 18" />
                </svg>
              </button>
            </div>
          </div>

            <div className="ia-corpo" ref={corpoRef}>
              {msgs.length === 0 && (
                <div className="ia-vazio">
                  <p className="ia-vazio-titulo">Pergunte qualquer coisa sobre seu patrimônio</p>
                  <p className="ia-vazio-sub">Também posso alterar metas, ativos, reserva e lançamentos — sempre com a sua confirmação.</p>
                  <div className="ia-chips">
                    {sugestoes.map(s => (
                      <button key={s} className="ia-chip" onClick={() => enviar(s)} disabled={bloqueado}>{s}</button>
                    ))}
                  </div>
                </div>
              )}

              {msgs.map((m, i) => (
                <div key={i} className={`ia-msg ia-msg-${m.role}`}>
                  {m.role === "ia" ? <TextoIA texto={m.texto} /> : m.texto}
                </div>
              ))}

              {ocupado && !pendente && (
                <div className="ia-msg ia-msg-ia ia-digitando" aria-label="Pensando">
                  <span /><span /><span />
                </div>
              )}

              {pendente && (
                <div className="ia-confirmar">
                  <div className="ia-confirmar-titulo">Confirmar alteração?</div>
                  <div className="ia-confirmar-texto">{pendente.texto}</div>
                  <div className="ia-confirmar-acoes">
                    <button className="form-botao" onClick={() => pendente.resolve(true)}>Confirmar</button>
                    <button className="form-botao form-botao-secundario" onClick={() => pendente.resolve(false)}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>
          <form
              className="ia-rodape"
              onSubmit={e => { e.preventDefault(); enviar(texto); }}
            >
              <div className="ia-caixa">
              <textarea
                ref={inputRef}
                className="ia-input"
                rows={1}
                placeholder={telaPequena ? "Pergunte algo..." : "Pergunte ou peça uma alteração..."}
                value={texto}
                onChange={e => setTexto(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(texto); }
                }}
                disabled={bloqueado}
              />
              <button type="submit" className="ia-enviar" disabled={bloqueado || !texto.trim()} aria-label="Enviar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5" /><path d="M5 12l7-7 7 7" />
                </svg>
              </button>
              </div>
            </form>
      </div>
    </div>,
    document.body
  );
}

export default function App() {
  const [dadosPlanilha, setDadosPlanilha] = useState(null);
  const [dadosLocais, setDadosLocais]     = useState(() => carregarDadosLocais());
  const [loading, setLoading]       = useState(true);
  const [erro, setErro]             = useState(null);
  const [scrolled, setScrolled]     = useState(false);
  const [tema, setTema] = useState(() => {
    if (typeof window === "undefined") return "dark";
    let salvo = "dark";
    try {
      salvo = localStorage.getItem("acumulei_tema") || "dark";
    } catch {}
    document.documentElement.setAttribute("data-theme", salvo);
    return salvo;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", tema);
    try {
      localStorage.setItem("acumulei_tema", tema);
    } catch {}
  }, [tema]);

  const alternarTema = useCallback(() => {
    setTema(t => (t === "dark" ? "light" : "dark"));
  }, []);
  const [searchCmd, setSearchCmd] = useState(null);
  const [pagina, setPagina]         = useState("patrimonio");
  const [lancamentos, setLancamentos] = useState([]);
  const [metaDespesa, setMetaDespesa] = useState(0);
  const scrollRef = useRef(null);
  const financasRef = useRef(null);
  const nuvemOkRef = useRef(false);
  const iaCtxRef = useRef(null);
  const [iaAberto, setIaAberto]   = useState(false);
  const [iaCfg, setIaCfg]          = useState(() => carregarCfgIA());
  const salvarIaCfg = (novo) => { salvarCfgIA(novo); setIaCfg(novo); };
  const [iaOcupado, setIaOcupado] = useState(false);

  const [ativoEditando, setAtivoEditando] = useState(null);
  const [formAtivo, setFormAtivo]         = useState({ ticker: "", nome: "", classe: "", quantidade: "", preco_medio: "", dolar_compra: "", porcentagem_meta: "", cotacao: "" });

  const [reservaModalAberto, setReservaModalAberto] = useState(false);
  const [formReserva, setFormReserva]                 = useState("");

  const [metasModalAberto, setMetasModalAberto] = useState(false);
  const [formMetas, setFormMetas]                 = useState({});

  const [proventosModalAberto, setProventosModalAberto] = useState(false);
  const [formProventos, setFormProventos]                 = useState([]);

  const [evolucaoModalAberto, setEvolucaoModalAberto] = useState(false);
  const [formEvolucao, setFormEvolucao]                 = useState([]);

  const [rentabilidadeModalAberto, setRentabilidadeModalAberto] = useState(false);
  const [formRentabilidade, setFormRentabilidade]                 = useState([]);

  const [metaModalAberto, setMetaModalAberto] = useState(false);
  const [metaInput, setMetaInput]               = useState("");

  const irParaPagina = useCallback((p) => {
    setPagina(p);
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  useEffect(() => {
    async function carregarSeed(url, campo, vazio) {
      if (!vazio(dadosLocais[campo])) return;
      try {
        const r = await fetch(url);
        if (!r.ok) return;
        const seed = await r.json();
        setDadosLocais(prev => (vazio(prev[campo]) ? { ...prev, [campo]: seed } : prev));
      } catch {

      }
    }
    carregarSeed(SEED_ATIVOS_URL,    "ativos",    v => Object.keys(v ?? {}).length === 0);
    carregarSeed(SEED_PROVENTOS_URL, "proventos", v => (v ?? []).length === 0);
    carregarSeed(SEED_EVOLUCAO_URL,  "evolucao",  v => (v ?? []).length === 0);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const [planilha, financas, dadosNuvem] = await Promise.all([
          carregarPlanilha(),
          carregarLancamentos(),
          carregarDadosLocaisNuvem(),
        ]);
        setDadosPlanilha(planilha);
        setLancamentos(financas.transactions);
        setMetaDespesa(financas.metaDespesa);

        if (dadosNuvem !== null)
          nuvemOkRef.current = true;
        if (dadosNuvem && Object.keys(dadosNuvem).length > 0) {
          setDadosLocais(normalizarDadosLocais(dadosNuvem));
        }
      } catch (e) {
        setErro(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (loading) return;
    salvarLancamentos(lancamentos, metaDespesa);
  }, [lancamentos, metaDespesa, loading]);

  useEffect(() => {
    salvarDadosLocais(dadosLocais);
    if (loading)
      return;
    if (!nuvemOkRef.current)
      return;
    salvarDadosLocaisNuvem(dadosLocais);
  }, [dadosLocais, loading]);

  useEffect(() => {
    let ocupado = false;
    async function sincronizar() {
      if (document.visibilityState !== "visible" || ocupado) return;
      ocupado = true;
      try {
        const [dadosNuvem, planilha] = await Promise.all([
          carregarDadosLocaisNuvem(),
          carregarPlanilha().catch(() => null),
        ]);
        if (planilha) setDadosPlanilha(planilha);
        if (dadosNuvem !== null) {
          nuvemOkRef.current = true;
          if (Object.keys(dadosNuvem).length > 0) {
            const novo = normalizarDadosLocais(dadosNuvem);
            setDadosLocais(prev => (JSON.stringify(prev) === JSON.stringify(novo) ? prev : novo));
          }
        }
      } finally {
        ocupado = false;
      }
    }
    document.addEventListener("visibilitychange", sincronizar);
    window.addEventListener("focus", sincronizar);
    window.addEventListener("online", sincronizar);
    return () => {
      document.removeEventListener("visibilitychange", sincronizar);
      window.removeEventListener("focus", sincronizar);
      window.removeEventListener("online", sincronizar);
    };
  }, []);

  const handleScroll = useCallback(() => {
    const scrollTop = scrollRef.current?.scrollTop || 0;
    setScrolled(scrollTop > 10);
  }, []);

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  function abrirEdicaoAtivo(ativo) {
    const extra = buscarExtraAtivo(dadosLocais.ativos, ativo.ticker);
    setFormAtivo({
      ticker: ativo.ticker,
      nome: extra.nome ?? "",
      classe: extra.classe ?? "",
      quantidade: numParaTexto(extra.quantidade),
      preco_medio: numParaMoedaInput(extra.preco_medio, extra.classe),
      dolar_compra: numParaBRLInput(extra.dolar_compra),
      porcentagem_meta: numParaTexto(extra.porcentagem_meta),
      cotacao: numParaTexto(extra.cotacao),
    });
    setAtivoEditando(ativo.ticker);
  }

  function abrirNovoAtivo(classePreSelecionada) {
    setFormAtivo({
      ticker: "",
      nome: "",
      classe: classePreSelecionada ?? "",
      quantidade: "",
      preco_medio: "",
      dolar_compra: "",
      porcentagem_meta: "",
      cotacao: "",
    });
    setAtivoEditando(NOVO_ATIVO_MARCADOR);
  }

  function salvarAtivo() {
    if (!ativoEditando) return;
    const isNovo = ativoEditando === NOVO_ATIVO_MARCADOR;
    const novoTicker = formAtivo.ticker.trim().toLowerCase() || (isNovo ? "" : String(ativoEditando).toLowerCase());
    if (!novoTicker)
      return;

    setDadosLocais(prev => {
      const ativos = { ...prev.ativos };
      if (!isNovo) {
        const chaveAntiga = Object.keys(ativos).find(
          k => k.toLowerCase() === String(ativoEditando).toLowerCase()
        );
        if (chaveAntiga && chaveAntiga !== novoTicker) {
          delete ativos[chaveAntiga];
        }
      }
      ativos[novoTicker] = {
        nome: formAtivo.nome.trim(),
        classe: formAtivo.classe,
        quantidade: toFloat(formAtivo.quantidade),
        preco_medio: parseMoedaInput(formAtivo.preco_medio, formAtivo.classe),
        dolar_compra: ehClasseEmDolar(formAtivo.classe) ? parseBRLInput(formAtivo.dolar_compra) : 0,
        porcentagem_meta: toFloat(formAtivo.porcentagem_meta),
        cotacao: toFloat(formAtivo.cotacao),
      };
      return { ...prev, ativos };
    });
    setAtivoEditando(null);
  }

  function limparAtivo() {
    if (!ativoEditando || ativoEditando === NOVO_ATIVO_MARCADOR) {
      setAtivoEditando(null);
      return;
    }
    setDadosLocais(prev => {
      const ativos = { ...prev.ativos };
      const chave = Object.keys(ativos).find(
        k => k.toLowerCase() === String(ativoEditando).toLowerCase()
      );
      if (chave) delete ativos[chave];
      return { ...prev, ativos };
    });
    setAtivoEditando(null);
  }

  function abrirEdicaoReserva() {
    setFormReserva(numParaBRLInput(dadosLocais.reserva_atual));
    setReservaModalAberto(true);
  }

  function salvarReserva() {
    setDadosLocais(prev => ({
      ...prev,
      reserva_atual: parseBRLInput(formReserva),
    }));
    setReservaModalAberto(false);
  }

  function abrirEdicaoMetas() {
    const form = {};
    ALOCACAO_CLASSES.forEach(c => { form[c.sufixo] = numParaTexto(dadosLocais.metas[c.sufixo]); });
    setFormMetas(form);
    setMetasModalAberto(true);
  }

  function salvarMetas() {
    const metas = {};
    ALOCACAO_CLASSES.forEach(c => { metas[c.sufixo] = toFloat(formMetas[c.sufixo]); });
    setDadosLocais(prev => ({ ...prev, metas }));
    setMetasModalAberto(false);
  }

  function abrirEdicaoProventos() {
    setFormProventos(
      (dadosLocais.proventos ?? []).map(r => ({ ano: String(r.ano ?? ""), total_ano: formatarBRLInput(String(Math.round(toFloat(r.total_ano) * 100))) }))
    );
    setProventosModalAberto(true);
  }

  function salvarProventos() {
    const proventos = formProventos
      .map(r => ({ ano: String(r.ano ?? "").trim(), total_ano: parseBRLInput(r.total_ano) }))
      .filter(r => r.ano);
    setDadosLocais(prev => ({ ...prev, proventos }));
    setProventosModalAberto(false);
  }

  function abrirEdicaoEvolucao() {
    const anoAtual = String(new Date().getFullYear());
    setFormEvolucao(
      (dadosLocais.evolucao ?? [])
        .filter(r => String(r.ano ?? "") !== anoAtual)
        .map(r => ({ ano: String(r.ano ?? ""), valor: formatarBRLInput(String(Math.round(toFloat(r.valor) * 100))) }))
    );
    setEvolucaoModalAberto(true);
  }

  function salvarEvolucao() {
    const anoAtual = String(new Date().getFullYear());
    const evolucao = formEvolucao
      .map(r => ({ ano: String(r.ano ?? "").trim(), valor: parseBRLInput(r.valor) }))
      .filter(r => r.ano && r.ano !== anoAtual)
      .sort((a, b) => parseInt(a.ano, 10) - parseInt(b.ano, 10));

    setDadosLocais(prev => ({ ...prev, evolucao }));
    setEvolucaoModalAberto(false);
  }

  function abrirEdicaoRentabilidade() {
    setFormRentabilidade(
      (dadosLocais.rentabilidade ?? [])
        .map(r => ({ ano: String(r.ano ?? ""), valor: formatarBRLInputSigned(String(Math.round(toFloat(r.valor) * 100))) }))
    );
    setRentabilidadeModalAberto(true);
  }

  function salvarRentabilidade() {
    const rentabilidade = formRentabilidade
      .map(r => ({ ano: String(r.ano ?? "").trim(), valor: parseBRLInputSigned(r.valor) }))
      .filter(r => r.ano)
      .sort((a, b) => parseInt(a.ano, 10) - parseInt(b.ano, 10));

    setDadosLocais(prev => ({ ...prev, rentabilidade }));
    setRentabilidadeModalAberto(false);
  }

  function abrirEdicaoMetaDespesa() {
    setMetaInput(numParaBRLInput(metaDespesa));
    setMetaModalAberto(true);
  }

  function salvarMetaDespesa() {
    setMetaDespesa(parseBRLInput(metaInput));
    setMetaModalAberto(false);
  }

  function limparMetaDespesa() {
    setMetaDespesa(0);
    setMetaModalAberto(false);
  }

  if (loading) return (
    <>
      <Style />
      <Loading tema={tema} />
    </>
  );

  if (erro) return (
    <>
      <Style />
      <div className="loading-page">
        <div className="loading-box card">
          <div style={{ color: COR_BAIXA, fontSize: 18, textAlign: "center" }}>
            Erro ao Carregar Dados:<br /><small>{erro}</small>
          </div>
        </div>
      </div>
    </>
  );

  const ativos    = montarAtivos(dadosPlanilha.ativos, dadosLocais);
  const taxaDolar = calcularTaxaDolar(dadosPlanilha.ativos);
  const totais    = calcularTotais(ativos, dadosLocais.reserva_atual, taxaDolar);
  const alocacao  = calcularAlocacao(totais, dadosLocais.reserva_atual, dadosLocais.metas);
  const reservas  = [{ reserva_atual: dadosLocais.reserva_atual }];

  const ativoAtual = ativos.find(a => a.ticker === ativoEditando) ?? null;
  const novoAtivoAberto = ativoEditando === NOVO_ATIVO_MARCADOR;
  const modalAtivoAberto = novoAtivoAberto || !!ativoAtual;

  iaCtxRef.current = {
    ativos, totais, alocacao, dadosLocais, lancamentos, metaDespesa, taxaDolar, pagina, tema,
    executar: criarExecutorIA({ ctxRef: iaCtxRef, setDadosLocais, setLancamentos, setMetaDespesa, setTema, irParaPagina }),
  };

  return (
    <>
      <Style />
      <div className="root" ref={scrollRef} onScroll={handleScroll}>
        <Navbar
          scrolled={scrolled}
          ativos={ativos}
          onSelectTicker={(ticker) => {
            if (pagina !== "investimentos") irParaPagina("investimentos");
            setSearchCmd({ ticker, v: Date.now() });
          }}
          pagina={pagina}
          onNavigate={irParaPagina}
          tema={tema}
          iaAberto={iaAberto}
          iaOcupado={iaOcupado}
          onToggleIA={() => setIaAberto(o => !o)}
        />
        <BotaoTopoFlutuante scrolled={scrolled} onTop={scrollToTop} />
        <AssistenteIA cfg={iaCfg} ctxRef={iaCtxRef} aberto={iaAberto} setAberto={setIaAberto} onOcupado={setIaOcupado} />
        <main className="main">

          {pagina === "patrimonio" && (
            <>
              <div id="sec-patrimonio"><CardPatrimonio totais={totais} evolucao={dadosLocais.evolucao} /></div>
              <div id="sec-classes-patrimonio"><CardClassesAtivos totais={totais} reservas={reservas} alocacao={alocacao} /></div>
            </>
          )}

          {pagina === "investimentos" && (
            <>
              <div id="sec-resumo-investimentos"><CardResumoInvestimentos totais={totais} /></div>
              <div id="sec-reserva"><CardReserva reservas={reservas} alocacao={alocacao} totais={totais} /></div>
              <div id="sec-alocacao"><CardAlocacao alocacao={alocacao} /></div>
              <div id="sec-rentabilidade"><CardRentabilidade rentabilidade={dadosLocais.rentabilidade} onEditarRentabilidade={abrirEdicaoRentabilidade} /></div>
              <div id="sec-proventos"><CardProventos proventos={dadosLocais.proventos} /></div>
              <div id="sec-brasil-exterior"><CardBrasilExterior alocacao={alocacao} totais={totais} /></div>
              <div id="sec-aporte"><CardAporte ativos={ativos} alocacao={alocacao} /></div>
              <div id="sec-heatmap">
                <CardHeatmap ativos={ativos} />
              </div>
              {CLASSES_ATIVOS.map(c => (
                <div id={`sec-${c.sufixo}`} key={c.classe}>
                  <CardClasse
                    titulo={c.titulo}
                    sufixo={c.sufixo}
                    classe={c.classe}
                    totais={totais}
                    ativos={ativos}
                    selectedTicker={searchCmd?.ticker}
                    searchVersion={searchCmd?.v}
                    scrollRef={scrollRef}
                    onEditarAtivo={abrirEdicaoAtivo}
                    onAdicionarAtivo={abrirNovoAtivo}
                  />
                </div>
              ))}
            </>
          )}

          {pagina === "financas" && (
            <PaginaFinancas
              ref={financasRef}
              lancamentos={lancamentos}
              setLancamentos={setLancamentos}
              metaDespesa={metaDespesa}
              setMetaDespesa={setMetaDespesa}
            />
          )}

          {pagina === "configuracoes" && (
            <PaginaConfiguracoes
              tema={tema}
              onAlternarTema={alternarTema}
              onEditarEvolucao={abrirEdicaoEvolucao}
              onEditarRentabilidade={abrirEdicaoRentabilidade}
              onEditarReserva={abrirEdicaoReserva}
              onEditarAlocacao={abrirEdicaoMetas}
              onEditarProventos={abrirEdicaoProventos}
              onEditarMetaDespesa={abrirEdicaoMetaDespesa}
              iaCfg={iaCfg}
              onSalvarIaCfg={salvarIaCfg}
            />
          )}

          <footer className="app-footer">
            <span className="app-footer-linha">Meu programa de acompanhamento de patrimônio, investimentos e finanças</span>
            <span className="app-footer-linha">Por Jakson Franceschini</span>
          </footer>
        </main>
      </div>

      {modalAtivoAberto && (
        <ModalAtivo
          ticker={novoAtivoAberto ? "" : ativoAtual.ticker}
          isNovo={novoAtivoAberto}
          form={formAtivo}
          onChange={setFormAtivo}
          onSalvar={salvarAtivo}
          onLimpar={limparAtivo}
          temDados={!novoAtivoAberto && Object.keys(dadosLocais.ativos ?? {}).some(k => k.toLowerCase() === String(ativoEditando).toLowerCase())}
          onFechar={() => setAtivoEditando(null)}
        />
      )}

      {reservaModalAberto && (
        <ModalReserva
          valor={formReserva}
          onChangeValor={v => setFormReserva(formatarBRLInput(v))}
          onSalvar={salvarReserva}
          onFechar={() => setReservaModalAberto(false)}
        />
      )}

      {metasModalAberto && (
        <ModalMetasAlocacao
          form={formMetas}
          onChange={setFormMetas}
          onSalvar={salvarMetas}
          onFechar={() => setMetasModalAberto(false)}
        />
      )}

      {proventosModalAberto && (
        <ModalListaAnos
          titulo="Editar proventos"
          campos={[{ key: "total_ano", label: "Total recebido no ano (R$)" }]}
          linhas={formProventos}
          onChange={setFormProventos}
          onSalvar={salvarProventos}
          onFechar={() => setProventosModalAberto(false)}
          className="modal-evolucao"
        />
      )}

      {evolucaoModalAberto && (
        <ModalListaAnos
          titulo="Editar evolução do patrimônio"
          campos={[
            { key: "valor", label: "Patrimônio no ano (R$)" },
          ]}
          linhas={formEvolucao}
          onChange={setFormEvolucao}
          onSalvar={salvarEvolucao}
          onFechar={() => setEvolucaoModalAberto(false)}
          className="modal-evolucao"
        />
      )}

      {rentabilidadeModalAberto && (
        <ModalListaAnos
          titulo="Editar rentabilidade"
          campos={[
            { key: "valor", label: "Rentabilidade no ano (%)", signed: true },
          ]}
          linhas={formRentabilidade}
          onChange={setFormRentabilidade}
          onSalvar={salvarRentabilidade}
          onFechar={() => setRentabilidadeModalAberto(false)}
          className="modal-evolucao"
        />
      )}

      {metaModalAberto && (
        <ModalMeta
          valor={metaInput}
          onChange={v => setMetaInput(formatarBRLInput(v))}
          onSalvar={salvarMetaDespesa}
          onLimpar={limparMetaDespesa}
          temMeta={metaDespesa > 0}
          onFechar={() => setMetaModalAberto(false)}
        />
      )}
    </>
  );
}

function Style() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');

      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      svg, svg *, .recharts-wrapper, .recharts-surface { outline: none !important; }
      svg:focus, svg *:focus { outline: none !important; }

            :root {
        --bg:             #0b0c0c;
        --bg2:            #1a1c1d;
        --bg3:            #1e2021;
        --bg4:            #292b2c;
        --border:         rgba(255, 255, 255, 0.07);
        --border2:        rgba(255, 255, 255, 0.065);
        --text:           #f3f2ee;
        --muted:          #8d908f;
        --accent:         #0a5550;
        --accent-h:       #0d6e68;
        --accent-p:       #13a097;
        --color-title:    #f3f2ee;
        --color-subtitle: #a3a5a3;
        --color-label:    #8d908f;
        --color-value:    #f3f2ee;
        --color-neutral:  #f3f2ee;
        --color-mono:     #ffffff;
        --navbar-bg:      rgba(26, 28, 29, 0.55);
        --navbar-border:  rgba(255, 255, 255, 0.07);
        --spinner-track:  rgba(10, 85, 80, 0.2);

        --radius-card:    24px;
        --radius-subcard: calc(var(--radius-card) - 6px);

                --space-1:  4px;
        --space-2:  8px;
        --space-3:  12px;
        --space-4:  16px;
        --space-5:  20px;
        --space-6:  24px;
        --space-7:  28px;
        --space-8:  32px;

                --radius-sm:   12px;
        --radius-md:   16px;
        --radius-pill: 99px;

                --bar-track:  rgba(255, 255, 255, 0.06);

        --shadow-card:    0 1px 0 rgba(255,255,255,0.05) inset, 0 24px 48px -18px rgba(0,0,0,0.6), 0 8px 20px -6px rgba(0,0,0,0.35);
        --shadow-subcard: 0 1px 0 rgba(255,255,255,0.03) inset, 0 12px 28px -10px rgba(0,0,0,0.4), 0 3px 10px rgba(0,0,0,0.22);
      }

      :root[data-theme="light"] {
        --bg:             #f4f6f5;
        --bg2:            #ffffff;
        --bg3:            #eef1f0;
        --bg4:            #e2e7e5;
        --border:         rgba(9, 30, 27, 0.09);
        --border2:        rgba(9, 30, 27, 0.08);
        --text:           #10201d;
        --muted:          #5c6663;
        --accent:         #0a5550;
        --accent-h:       #0d6e68;
        --accent-p:       #0e7971;
        --color-title:    #0d1a18;
        --color-subtitle: #4d5754;
        --color-label:    #626c69;
        --color-value:    #0d1a18;
        --color-neutral:  #0d1a18;
        --color-mono:     #000000;
        --navbar-bg:      rgba(255, 255, 255, 0.68);
        --navbar-border:  rgba(9, 30, 27, 0.08);
        --spinner-track:  rgba(10, 85, 80, 0.15);
        --bar-track:      rgba(9, 30, 27, 0.07);

        --shadow-card:    0 1px 0 rgba(255,255,255,0.7) inset, 0 24px 44px -20px rgba(16,32,29,0.18), 0 6px 14px -4px rgba(16,32,29,0.07);
        --shadow-subcard: 0 1px 0 rgba(255,255,255,0.6) inset, 0 10px 22px -8px rgba(16,32,29,0.1), 0 2px 8px rgba(16,32,29,0.05);
      }

      html, body, #root {
        height: 100%;
        background-color: var(--bg);
        background-image:
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.045 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"),
          radial-gradient(ellipse 900px 520px at 50% -12%, rgba(255,255,255,0.05), transparent 60%),
          radial-gradient(ellipse 700px 460px at 105% 18%, rgba(255,255,255,0.03), transparent 55%),
          radial-gradient(ellipse 800px 500px at -10% 90%, rgba(255,255,255,0.02), transparent 55%),
          linear-gradient(180deg, #131415 0%, #0e0f10 45%, #0b0c0c 100%);
        background-repeat: repeat, no-repeat, no-repeat, no-repeat, no-repeat;
        background-attachment: scroll, scroll, scroll, scroll, fixed;
        color: var(--text);
        font-family: "Manrope", -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
        transition: background-color 0.25s ease, color 0.25s ease;
      }

      :root[data-theme="light"] html,
      :root[data-theme="light"] body,
      :root[data-theme="light"] #root {
        background-image:
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.02 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"),
          radial-gradient(ellipse 900px 520px at 50% -12%, rgba(10,85,80,0.06), transparent 60%),
          radial-gradient(ellipse 700px 460px at 105% 18%, rgba(10,85,80,0.04), transparent 55%),
          radial-gradient(ellipse 800px 500px at -10% 90%, rgba(10,85,80,0.03), transparent 55%),
          linear-gradient(180deg, #fbfcfb 0%, #f6f8f7 45%, #f4f6f5 100%);
      }

            .root {
        height: 100vh;
        overflow-y: auto;
        overflow-x: hidden;
        position: relative;
        scrollbar-gutter: stable both-edges;
      }

      * {
        -webkit-tap-highlight-color: transparent;
        font-family: "Manrope", -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif !important;
      }

            .navbar {
        position: fixed;
        top: 6px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 100;
        width: calc(100% - 40px);
        max-width: 1160px;
        box-sizing: border-box;
        border-radius: 26px;
        padding: var(--space-5) var(--space-6);
        display: flex;
        flex-direction: column;
        background: var(--navbar-bg);
        border: 1px solid var(--navbar-border);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
        transition: all 0.5s ease;
      }
      .navbar-inner {
        display: grid;
        grid-template-columns: 1fr minmax(0, auto) 1fr;
        align-items: center;
        gap: var(--space-2);
        width: 100%;
      }
      .navbar-left { display: flex; align-items: center; gap: var(--space-2); min-width: 0; cursor: default; }
      .navbar-left img,
      .navbar-left .navbar-logo {
        transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .navbar-left:hover img,
      .navbar-left:hover .navbar-logo {
        transform: scale(1.08);
      }

      .navbar-right { display: flex; align-items: center; gap: var(--space-2); justify-self: end; min-width: 0; position: relative; }

            .btn-tema {
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: 50%;
        width: 38px;
        height: 38px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 17px;
        cursor: pointer;
        flex-shrink: 0;
        transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      }
      .btn-tema:hover {
        background: var(--bg4);
        box-shadow: 0 4px 16px rgba(10,85,80,0.25);
      }
      .btn-tema:active { transform: scale(0.96); }
      .btn-tema-subcard { background: var(--bg3); }
      .btn-tema-linha { width: 32px; height: 32px; font-size: 14px; margin-left: var(--space-2); }
      .btn-tema-ativo { background: var(--accent); border-color: var(--accent); color: #f5f5f7; }
      .btn-tema-ativo:hover { background: var(--accent); }

      .config-tema-toggle {
        display: flex;
        gap: 2px;
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: 999px;
        padding: 3px;
      }
      .config-tema-btn {
        border: none;
        background: transparent;
        padding: 7px 16px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-label);
        cursor: pointer;
        transition: background 0.2s ease, color 0.2s ease;
        font-family: inherit;
      }
      .config-tema-btn.is-ativo { background: var(--accent); color: #f5f5f7; }
      .config-tema-btn:not(.is-ativo):hover { color: var(--text); }

            .navbar-search-inline {
        width: 240px;
        min-width: 240px;
        max-width: 240px;
        display: flex;
        align-items: center;
        gap: var(--space-2);
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: 999px;
        padding: 10px var(--space-3);
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .navbar-search-icon { display: flex; align-items: center; opacity: 0.5; flex-shrink: 0; color: var(--color-value); }
      .navbar-search-inline-input {
        background: transparent;
        border: none;
        outline: none;
        color: var(--color-value);
        font-size: 13px;
        font-family: inherit;
        width: 160px;
        transition: width 0.2s ease;
      }
      .navbar-search-inline-input:focus { width: 200px; }
      .navbar-search-inline-input::placeholder { color: var(--color-label); }

            .navbar-search-box {
        position: absolute;
        top: calc(100% + 10px);
        right: 0;

        width: min(320px, calc(100vw - 24px));
        max-width: calc(100vw - 24px);

        background: var(--navbar-bg);
        border: 1px solid var(--navbar-border);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-radius: var(--radius-md);
        overflow: hidden;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
        z-index: 200;
      }
      .navbar-search-box-desktop {
        left: 0;
        right: auto;
        width: 240px;
        min-width: 240px;
        max-width: 240px;
      }
      .navbar-search-input {
        width: 100%;
        background: transparent;
        border: none;
        color: var(--color-value);
        font-size: 14px;
        padding: var(--space-3) var(--space-4);
        outline: none;
        font-family: inherit;
      }
      .navbar-search-input::placeholder { color: var(--color-label); }
      .navbar-search-box-desktop {
        right: auto;
        left: 0;
        width: 100%;
        min-width: 240px;
      }
      .navbar-search-results {
        display: flex;
        flex-direction: column;
        max-height: 240px;
        overflow-y: auto;
        border-top: none !important;
        padding: 0 6px 6px;
        gap: 2px;
      }
      @supports not selector(::-webkit-scrollbar) {
        .navbar-search-results { scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.18) transparent; }
        :root[data-theme="light"] .navbar-search-results { scrollbar-color: rgba(9, 30, 27, 0.22) transparent; }
      }
      .navbar-search-results::-webkit-scrollbar { width: 4px; }
      .navbar-search-results::-webkit-scrollbar-track { background: transparent; }
      .navbar-search-results::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.18);
        border-radius: 999px;
      }
      .navbar-search-results::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.32); }
      .navbar-search-results::-webkit-scrollbar-button,
      .navbar-search-results::-webkit-scrollbar-button:single-button { display: none; width: 0; height: 0; }
      :root[data-theme="light"] .navbar-search-results::-webkit-scrollbar-thumb { background: rgba(9, 30, 27, 0.22); }
      .navbar-search-results::before,
      .navbar-search-results::after {
        display: none !important;
      }
      .navbar-search-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: transparent;
        border: none;
        border-radius: 12px;
        cursor: pointer;
        transition: background 0.15s;
        font-family: inherit;
        text-align: left;
      }
      .navbar-search-item:hover,
      .navbar-search-item.is-ativo { background: rgba(255, 255, 255, 0.08); }
      :root[data-theme="light"] .navbar-search-item:hover,
      :root[data-theme="light"] .navbar-search-item.is-ativo { background: rgba(9, 30, 27, 0.07); }
      .btn-tema svg,
      .navbar-search-icon {
        color: var(--color-value);
      }

      .navbar-logo {
        width: 36px; height: 36px;
        background: var(--accent);
        border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        font-weight: 800; font-size: 18px; color: #f5f5f7; flex-shrink: 0;
      }
      .navbar-logo-img {
        height: 38px; width: auto; max-width: 130px;
        object-fit: contain; flex-shrink: 0;
      }

            .navbar-nav { display: flex; align-items: center; min-width: 0; }
      .navbar-tabs {
        display: flex;
        align-items: center;
        gap: 2px;
        min-width: 0;
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: var(--radius-pill);
        padding: 4px;
        overflow-x: auto;
        scrollbar-width: none;
      }
      .navbar-tabs::-webkit-scrollbar { display: none; }
      .navbar-tab {
        background: transparent;
        border: none;
        color: var(--color-label);
        font-size: 14px;
        font-weight: 600;
        font-family: inherit;
        white-space: nowrap;
        cursor: pointer;
        padding: 9px 18px;
        border-radius: var(--radius-pill);
        transition: color 0.2s ease, background 0.2s ease;
      }
      .navbar-tab { transition: color 0.2s ease, background 0.2s ease, box-shadow 0.3s ease, transform 0.35s cubic-bezier(0.22, 1, 0.36, 1); }
      @media (hover: hover) {
        .navbar-tab:not(.navbar-tab-ativo):hover {
          color: #13a097;
          background: transparent;
          box-shadow: none;
          transform: scale(1.04);
        }
      }
      .navbar-tab-ativo {
        background: var(--accent);
        color: #f5f5f7;
      }
      .navbar-tab-ativo:hover { color: #f5f5f7; }

            .navbar-hamburger-wrap { display: none; }

            .navbar-menu-backdrop {
        position: fixed;
        inset: 0;
        z-index: 499;
        background: transparent;
      }
      .navbar-menu-dropdown {
        position: fixed;
        left: 0;
        right: 0;
        margin-left: auto;
        margin-right: auto;
        z-index: 500;
        width: calc(100% - 40px);
        max-width: 1160px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 8px;
        border-radius: 26px;
        background: var(--navbar-bg);
        border: 1px solid var(--navbar-border);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
      }
      .navbar-menu-overlay-item {
        background: transparent;
        border: none;
        color: var(--color-label);
        font-family: inherit;
        font-size: 15px;
        font-weight: 600;
        text-align: center;
        padding: 13px var(--space-4);
        border-radius: 14px;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .navbar-menu-overlay-item:hover { color: var(--color-value); }
      .navbar-menu-overlay-item.is-ativo {
        background: rgba(19, 160, 151, 0.16);
        color: var(--color-value);
      }
      :root[data-theme="light"] .navbar-menu-overlay-item.is-ativo {
        background: rgba(19, 160, 151, 0.14);
      }

      @media (max-width: 1024px) {
        .navbar-tab { padding: 8px 14px; font-size: 13px; }
      }
      @media (max-width: 640px) {
        .navbar-tabs { display: none; }
        .navbar-hamburger-wrap { display: block; order: 99; } /* sempre o último, na extremidade direita */
        .navbar-config-btn { display: none; }
      }

            .btn-topo-flutuante {
        position: fixed;
        bottom: 30px;
        right: 30px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: #0a5550;
        color: #f5f5f7;
        border: 1px solid rgba(5, 120, 112, 0.3);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        opacity: 0;
        pointer-events: none;
        z-index: 99;
      }
      .btn-topo-flutuante-visible {
        opacity: 1;
        pointer-events: auto;
      }
      .btn-topo-flutuante:hover {
        background: #0d6e68;
        box-shadow: 0 6px 24px rgba(20, 168, 159, 0.55), inset 0 1px 0 rgba(255,255,255,0.2);
        transform: translateY(-2px);
      }
      .btn-topo-flutuante:active {
        transform: scale(0.96);
        box-shadow: 0 2px 8px rgba(20, 168, 159, 0.3);
      }

            .main {
        max-width: 1200px;
        margin: 0 auto;
        padding: 120px var(--space-5) 20px;
        display: flex;
        flex-direction: column;
        gap: var(--space-8);
      }

            .app-footer {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        text-align: center;
        padding: var(--space-4) 0 0;
        color: var(--color-label);
      }
      .app-footer-linha { font-size: 13px; }
      .app-footer-linha:first-child { opacity: 0.8; }
      .app-footer-linha:last-child { opacity: 0.55; font-size: 12px; }

            .card {
        background: var(--bg2);
        border-radius: var(--radius-card);
        border: 1px solid var(--border);
        padding: var(--space-5) !important;
        display: flex;
        flex-direction: column;
        gap: var(--space-4) !important;
        box-shadow: var(--shadow-card);
        backface-visibility: hidden;
        perspective: 1000px;
        transform: translate3d(0,0,0);
        will-change: transform;
        transition: background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
      }
      .card-titulo {
        font-size: 20px;
        font-weight: 700;
        letter-spacing: -0.015em;
        color: var(--color-title);
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }      .card-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }

            .subcard {
        background: var(--bg3);
        border-radius: var(--radius-subcard);
        border: 1px solid var(--border2);
        padding: var(--space-5) !important;
        display: flex;
        flex-direction: column;
        gap: var(--space-1) !important;
        box-shadow: var(--shadow-subcard);
        transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease, background 0.3s ease;
        position: relative;
        overflow: hidden;
      }
      .subcard-titulo {
        padding: var(--space-2) var(--space-4) !important;
        border-radius: var(--radius-subcard) !important;
      }

            .campo { display: flex; flex-direction: column; gap: var(--space-1); }
      .campo-titulo {
        font-size: 14px;
        font-weight: 500;
        color: var(--color-label);
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
      }
      .campo-valor {
        font-size: 31px;
        font-weight: 800;
        letter-spacing: -0.025em;
        line-height: 1.05;
        color: var(--color-value);
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
        font-variant-numeric: tabular-nums;
      }

            .divisor { margin-top: 15px; height: 0; border-top: 1px solid var(--border2); }

            .hero-valor { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
      .hero-valor-titulo { font-size: 14px; letter-spacing: 0.05em; }
      .hero-valor-valor { line-height: 1; }
            .dropdown-wrap { position: relative; }
      .dropdown-trigger {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        color: var(--text);
      }
      .dropdown-trigger-sub { font-size: 14px; opacity: 0.8; color: var(--text); }
      .dropdown-menu {
        position: absolute;
        top: calc(100% + var(--space-2));
        left: 0;
        z-index: 50;
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: var(--radius-md);
        padding: var(--space-2);
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        min-width: 130px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      }
      .dropdown-item {
        background: transparent;
        color: var(--text);
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        padding: var(--space-3) var(--space-3);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        text-align: left;
        display: flex;
        align-items: center;
        justify-content: space-between;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        font-family: inherit;
      }
      .dropdown-item:hover { background: var(--bg4); }
      .dropdown-item:focus-visible {
        outline: 2px solid var(--accent-p);
        outline-offset: 1px;
      }
      .dropdown-item.is-ativo {
        background: var(--accent);
        color: #f5f5f7;
        border-color: rgba(5, 120, 112, 0.4);
        font-weight: 600;
      }

            .dropdown-menu-flutuante {
        position: fixed !important;
        z-index: 9999;
      }

            .ativo-nome-ticker {
        font-size: 20px;
        font-weight: 500;
        color: var(--color-value);
        letter-spacing: 0.05em;
        line-height: 1.1;
      }
      .ativo-nome-texto {
        font-size: 13px;
        color: var(--color-label);
        margin-top: var(--space-1);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      @media (max-width: 640px) {
        .ativo-nome-ticker { font-size: 17px; }
        .ativo-nome-texto  { font-size: 12px; }
      }

      .list-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        --row-pad-x: var(--space-5);
        padding: var(--space-4) var(--row-pad-x);
        position: relative;
        transition: background 0.15s ease;
      }
      .list-row:not(:last-child)::after {
        content: "";
        position: absolute;
        left: var(--row-pad-x);
        right: var(--row-pad-x);
        bottom: 0;
        height: 0;
        border-bottom: 1px solid var(--border2);
        transition: opacity 0.15s ease;
      }
      .list-row-clickable {
        cursor: pointer;
        margin: 0 -10px;
        /* 9px + 1px de borda transparente = 10px, compensa exatamente a margem negativa */
        padding-left: calc(var(--row-pad-x) + 9px);
        padding-right: calc(var(--row-pad-x) + 9px);
        border-radius: var(--radius-subcard);
        border: 1px solid transparent;
        transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
      }
      /* divisória alinhada ao conteúdo (mesmo padding dos outros cards), sem vazar pela margem negativa do hover */
      .list-row-clickable:not(:last-child)::after {
        left: calc(var(--row-pad-x) + 9px);
        right: calc(var(--row-pad-x) + 9px);
      }
      .list-row-clickable:hover {
        background: rgba(255,255,255,0.05);
        border-color: rgba(255,255,255,0.09);
        transform: scale(1.015);
      }
      .list-row-clickable.sem-zoom:hover {
        transform: none;
      }
      :root[data-theme="light"] .list-row-clickable:hover {
        background: rgba(9, 30, 27, 0.035);
        border-color: rgba(9, 30, 27, 0.08);
      }
      .list-row-clickable:hover::after { opacity: 0; }
      .btn-mais-opcoes {
        background: transparent;
        border: none;
        box-shadow: none;
        color: var(--color-value);
        width: 36px;
        height: 36px;
        margin-right: -8px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        flex-shrink: 0;
        transition: opacity 0.15s ease, transform 0.15s ease;
      }
      .btn-mais-opcoes svg { width: 20px; height: 20px; }
      .btn-mais-opcoes { transition: transform 0.2s cubic-bezier(0.22,1,0.36,1); }
      @media (hover: hover) {
        .btn-mais-opcoes:hover { transform: scale(1.18); }
      }
      .btn-mais-opcoes[aria-expanded="true"] { transform: scale(1.18); }
      .btn-mais-opcoes:active { transform: scale(0.9); }
      .menu-lanc-overlay { position: fixed; inset: 0; z-index: 1100; }
      .menu-lanc {
        position: fixed;
        min-width: 150px;
        background: var(--bg2);
        border: 1px solid var(--border2);
        border-radius: 14px;
        padding: 6px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.45);
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .menu-lanc-item {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        width: 100%;
        background: transparent;
        border: none;
        border-radius: 9px;
        padding: 10px 12px;
        font: inherit;
        font-size: 14px;
        font-weight: 500;
        color: var(--color-value);
        cursor: pointer;
        text-align: left;
        transition: background 0.15s ease;
      }
      .menu-lanc-item:hover { background: var(--bg3); }
      .menu-lanc-item-perigo { color: #c0504a; }
      .list-row-left { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
      .list-row-label {
        font-size: 15px;
        font-weight: 500;
        color: var(--color-value);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .list-row-tag {
        font-size: 10px;
        font-weight: 500;
        color: var(--color-label);
        letter-spacing: 0.03em;
      }
      .card-titulo-contador {
        font-size: 12px;
        font-weight: 600;
        color: var(--color-label);
        background: var(--bg4);
        border-radius: var(--radius-pill);
        padding: 1px 9px;
        margin-left: var(--space-2);
      }
      .list-row-right { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }
      .list-row-values { display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-1); }
      .list-row-value {
        font-size: 15px;
        font-weight: 600;
        color: var(--color-value);
        text-align: right;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .list-row-sub {
        font-size: 11px;
        font-weight: 500;
        color: var(--color-label);
        text-align: right;
        white-space: nowrap;
      }
      .list-row-plain {
        --row-pad-x: 0px;
      }
            .list-row-filtrado {
        margin: 0 -10px;
        padding-left: 10px;
        padding-right: 10px;
        border-radius: var(--radius-subcard);
        background: var(--hl-bg, rgba(19, 160, 151, 0.08));
        box-shadow: inset 0 0 0 1px var(--hl-border, rgba(19, 160, 151, 0.5));
      }
      .list-row-filtrado::after {
        display: none !important;
      }
      .ativo-clicavel { cursor: pointer; -webkit-tap-highlight-color: transparent; user-select: none; will-change: transform; }
      @media (hover: hover) {
        .ativo-clicavel:hover {
          background: linear-gradient(135deg, rgba(19,160,151,0.12), rgba(19,160,151,0.03)), var(--bg3);
          box-shadow: 0 0 22px rgba(19,160,151,0.18) !important;
        }
      }
      .ativo-clicavel:active {
        transform: translateY(0) scale(0.97) !important;
        box-shadow: 0 0 12px rgba(19,160,151,0.25) !important;
        filter: brightness(0.94);
        transition-duration: 0.08s !important;
      }
      .ativo-clicavel:focus-visible { outline: 2px solid #13a097; outline-offset: 2px; }
      .ativo-cabecalho-filtrado {
        position: relative;
        margin: -10px;
        padding: 10px;
        border-radius: var(--radius-subcard);
        background: rgba(19, 160, 151, 0.08);
        box-shadow: inset 0 0 0 1px rgba(19, 160, 151, 0.5);
      }
      .list-row-chevron {
        color: var(--color-label);
        opacity: 0.55;
        flex-shrink: 0;
      }
      @media (max-width: 640px) {
                .list-row { gap: var(--space-2); --row-pad-x: var(--space-4); }
        .list-row-plain { --row-pad-x: 0px; }
        .list-row-label { font-size: 13px; }
        .list-row-value { font-size: 13px; }
        .list-row-sub { font-size: 10px; }
      }

      .btn-filtro-simples {
        background: var(--bg3);
        color: var(--color-value);
        border: 1px solid var(--border2);
        padding: var(--space-3);
        font-size: 14px;
        cursor: pointer;
        font-weight: 600;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        position: relative;
        border-radius: 999px;
        transition: color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease, transform 0.15s ease;
        gap: var(--space-2);
        min-width: 38px;
        min-height: 38px;
        width: auto;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        -webkit-tap-highlight-color: transparent;
      }
      .btn-texto {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .click-glow {
        animation: glowPulseTexto 0.55s ease-out;
      }
      @keyframes glowPulseTexto {
        0% {
          text-shadow: 0 0 0 rgba(10, 85, 80, 0);
          filter: brightness(1);
        }
        40% {
          text-shadow: 0 0 10px rgba(10, 85, 80, 0.85);
          filter: brightness(1.3);
        }
        100% {
          text-shadow: 0 0 0 rgba(10, 85, 80, 0);
          filter: brightness(1);
        }
      }
      .btn-ver-icon {
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        transform: rotate(0deg);
      }
      .btn-ver-icon.is-open {
        transform: rotate(180deg);
      }

      .btn-filtro-simples:hover {
        background: var(--bg4);
        box-shadow: 0 4px 16px rgba(10,85,80,0.25);
      }
      .btn-filtro-simples:active {
        transform: scale(0.96);
      }
      .btn-filtro-simples-ativo {
        color: #0a5550;
        border-color: #0a5550;
        background: rgba(10, 85, 80, 0.15);
      }

      @media (max-width: 640px) {
        .navbar-search-box {
          position: fixed !important;
          top: 90px;
          left: 12px;
          right: auto;
          transform: none;
          width: calc(100vw - 24px);
          max-width: none;
          margin: 0;
          box-sizing: border-box;
          z-index: 9999;
          border-color: var(--navbar-border);
        }
        .navbar-search-input {
          width: 100%;
          box-sizing: border-box;
        }
        
      }
      .filtros-row {
        display: flex;
        gap: var(--space-2);
        flex-wrap: wrap;
        padding-top: 6px;
        padding-bottom: 14px;
        margin-bottom: -10px;
      }
      .filtros-row .btn-filtro-simples {
        padding-left: 18px;
        padding-right: 18px;
      }
      .filtro-botao-mobile { display: none; }
      .filtro-botao-desktop { display: flex; }
      @media (max-width: 640px) {
        .filtro-botao-mobile { display: block; }
        .filtro-botao-desktop { display: none; }
      }

            .ativos-lista { display: flex; flex-direction: column; gap: var(--space-4); }
      @media (min-width: 1200px) {
        .ativos-lista { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start; }
      }

            .heatmap-grid {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: var(--space-3);
      }
      @media (max-width: 1024px) { .heatmap-grid { grid-template-columns: repeat(4, 1fr); } }
      @media (max-width: 640px)  { .heatmap-grid { grid-template-columns: repeat(3, 1fr); } }
      @media (max-width: 380px)  { .heatmap-grid { grid-template-columns: repeat(2, 1fr); } }

      .heatmap-cell {
        border-radius: 24px;
        padding: var(--space-3) var(--space-2);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        cursor: pointer;
        transition: filter 0.2s ease, transform 0.2s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s ease;
        min-height: 90px;
      }
      .heatmap-cell { position: relative; }
      .heatmap-cell > * { position: relative; }
      .heatmap-cell::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: radial-gradient(circle at 50% 0%, rgba(255,255,255,0.3), rgba(255,255,255,0) 70%);
        opacity: 0;
        transition: opacity 0.25s ease;
        pointer-events: none;
      }
      @media (hover: hover) {
        .heatmap-cell:hover {
          filter: brightness(1.12);
          transform: translateY(-2px);
          box-shadow: 0 0 26px 3px var(--hm-glow), inset 0 0 0 1px rgba(255,255,255,0.35);
        }
        .heatmap-cell:hover::before { opacity: 1; }
      }
      .heatmap-cell:active { transform: scale(0.97); }
      .hm-ticker { color: #f5f5f7; font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
      .hm-pct    { color: #f5f5f7; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
      .hm-brl    { color: rgba(255,255,255,0.8); font-size: 14px; font-variant-numeric: tabular-nums; }

      @media (min-width: 1024px) {
        .hm-pct {font-size: 14px !important;}
        .hm-brl {font-size: 16px !important;}
      }

      .grafico-rolavel { width: 100%; }
      .grafico-rolavel-inner { width: 100%; }
      @media (max-width: 640px) {
        .grafico-rolavel {
          overflow-x: auto;
          overflow-y: hidden;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior-x: contain;
          touch-action: pan-x pan-y;
          scrollbar-width: none;
        }
        .grafico-rolavel::-webkit-scrollbar { display: none; }
        .grafico-rolavel-inner { width: max(100%, calc(100% * var(--n-anos, 1) / 8)); } /* 8 anos cabem na tela; acima disso rola */
      }

            .barra-proventos { border-radius: 10px 10px 4px 4px; }
      .barra-proventos-glow { border-radius: 10px 10px 0 0; }

      @media (min-width: 1024px) {
        .barra-proventos { border-radius: 14px 14px 5px 5px; }
        .barra-proventos-glow { border-radius: 14px 14px 0 0; }
      }

      @media (min-width: 1440px) {
        .barra-proventos { border-radius: 18px 18px 6px 6px; }
        .barra-proventos-glow { border-radius: 18px 18px 0 0; }
      }

            .chart-tooltip {
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: 12px;
        padding: 10px 14px;
        font-size: 13px;
      }
      .tooltip-label { color: var(--muted); margin-bottom: var(--space-1); }
      .tooltip-val   { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
      .tooltip-sub   { font-size: 13px; margin-top: 2px; }

            .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.55);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        animation: modalFadeIn 0.2s ease;
        padding: var(--space-4);
      }
      @keyframes modalFadeIn { from { opacity: 0; } to { opacity: 1; } }

      /* ===== Animação padrão dos popups, menus e modais (mesma mola do assistente) ===== */
      :root { --pop-mola: cubic-bezier(0.32, 1.22, 0.42, 1); }
      @keyframes popEntrar { from { transform: scale(0.8) translateY(-8px); } to { transform: none; } }
      @keyframes popOpac   { from { opacity: 0; } to { opacity: 1; } }
      @keyframes popSair   { from { opacity: 1; transform: none; } to { opacity: 0; transform: scale(0.88) translateY(-6px); } }
      @keyframes popSairOpac { from { opacity: 1; } to { opacity: 0; } }

      .navbar-menu-dropdown,
      .navbar-search-box,
      .dropdown-menu,
      .menu-lanc,
      .modal-sheet {
        animation: popEntrar 0.5s var(--pop-mola) both, popOpac 0.2s ease both;
      }
      .navbar-menu-dropdown { transform-origin: top right; }
      .navbar-search-box { transform-origin: top left; }
      .dropdown-menu { transform-origin: top left; }
      .menu-lanc { transform-origin: top right; }
      .modal-sheet { transform-origin: center; animation-name: popEntrarModal, popOpac; }
      @keyframes popEntrarModal { from { transform: scale(0.88) translateY(14px); } to { transform: none; } }

      .navbar-menu-dropdown[data-saindo],
      .navbar-search-box[data-saindo],
      .dropdown-menu[data-saindo],
      .menu-lanc[data-saindo],
      .modal-sheet[data-saindo] {
        animation: popSair 0.2s ease-in forwards;
        pointer-events: none;
      }
      .modal-sheet[data-saindo] { animation-name: popSairModal; }
      @keyframes popSairModal { from { opacity: 1; transform: none; } to { opacity: 0; transform: scale(0.92) translateY(10px); } }
      .modal-overlay[data-saindo] { animation: popSairOpac 0.2s ease forwards; pointer-events: none; }
      .menu-lanc-overlay[data-saindo], .navbar-menu-backdrop[data-saindo] { pointer-events: none; }
      @media (prefers-reduced-motion: reduce) {
        .navbar-menu-dropdown, .navbar-search-box, .dropdown-menu, .menu-lanc, .modal-sheet { animation-duration: 0.01s; }
      }
      .modal-sheet {
        width: 100%;
        max-width: 420px;
        max-height: 80vh;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        -ms-overflow-style: none;
        background: var(--bg2);
        border: 1px solid var(--border2);
        border-radius: var(--radius-card);
        padding: var(--space-6);
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        box-shadow: 0 -10px 40px rgba(0,0,0,0.4);
      }
      .modal-sheet::-webkit-scrollbar { display: none; width: 0; height: 0; }
      @media (max-width: 480px) {
        .modal-sheet { padding: var(--space-4); }
      }
      @media (max-width: 640px) {
        .modal-sheet.modal-ativo-detalhe {
          max-width: none;
          height: auto;
          max-height: 100%;
          padding-bottom: var(--space-5);
        }
      }
      .modal-header { display: flex; align-items: center; justify-content: space-between; }
      .modal-sheet.modal-ativo-detalhe .modal-header { position: relative; z-index: 2; }
      .modal-titulo { font-size: 18px; font-weight: 600; color: var(--color-title); }
      .modal-fechar {
        background: var(--bg4);
        border: 1px solid var(--border2);
        color: var(--color-label);
        width: 30px; height: 30px;
        border-radius: 50%;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        font-size: 13px;
      }
      .modal-fechar:hover { color: var(--color-value); background: var(--bg3); }

      .meta-gauge { width: 100%; max-width: 340px; margin: 0 auto; padding: var(--space-2) 0; }
      .meta-gauge-pct { font-size: 34px; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
      .meta-gauge-sub { font-size: 10.5px; font-weight: 500; }
      .tipo-toggle { display: flex; gap: var(--space-2); }
      .tipo-opcao {
        flex: 1;
        background: var(--bg3);
        border: 1px solid var(--border2);
        color: var(--color-label);
        font-weight: 600;
        font-size: 14px;
        font-family: inherit;
        padding: var(--space-3);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
      }
      .tipo-opcao-ativa.income { background: rgba(10,85,80,0.2); border-color: #0a5550; color: #f5f5f7; }
      .tipo-opcao-ativa.expense { background: rgba(138,53,53,0.2); border-color: #8a3535; color: #f5f5f7; }

      .modal-sheet.tipo-despesa .form-input:focus,
      .modal-sheet.tipo-despesa .form-select:focus {
        border-color: #8a3535;
        box-shadow: 0 0 0 2px rgba(138,53,53,0.15);
      }
      .modal-sheet.tipo-despesa .form-select-aberto {
        border-color: #8a3535;
        box-shadow: 0 0 0 2px rgba(138,53,53,0.15);
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%238a3535' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
      }
      .modal-sheet.tipo-despesa .form-botao:not(.form-botao-perigo):not(.form-botao-secundario) {
        background: #8a3535;
      }
      .modal-sheet.tipo-despesa .form-botao:not(.form-botao-perigo):not(.form-botao-secundario):hover {
        background: #9c3d3d;
      }

      .form-grupo { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
      .input-meta-alocacao { width: 84px; text-align: center; }
      .form-input {
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: var(--radius-md);
        padding: var(--space-3) var(--space-4);
        font-size: 15px;
        color: var(--color-value);
        font-family: inherit;
        outline: none;
        width: 100%;
        min-width: 0;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .form-input:focus { border-color: #0a5550; box-shadow: 0 0 0 2px rgba(10,85,80,0.15); }
      .form-input::placeholder { color: var(--color-label); }

      .form-select {
        appearance: none;
        -webkit-appearance: none;
        -moz-appearance: none;
        cursor: pointer;
        padding-right: 40px;
        display: flex;
        align-items: center;
        text-align: left;
        font-size: 15px;
        font-family: inherit;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%238e8e93' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right var(--space-4) center;
        background-size: 16px;
        transition: border-color 0.15s, box-shadow 0.15s, background-image 0.15s;
      }
      .form-select-aberto,
      .form-select:focus {
        border-color: #0a5550;
        box-shadow: 0 0 0 2px rgba(10,85,80,0.15);
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%230d6e68' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
      }
      .form-select-aberto { background-position: right var(--space-4) center; transform: none; }
      .form-select option {
        background: var(--bg3);
        color: var(--color-value);
      }

            .dropdown-menu-select {
        padding: var(--space-2);
        max-height: 260px;
        overflow-y: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      .dropdown-menu-select::-webkit-scrollbar { display: none; width: 0; height: 0; }
      .dropdown-menu-select { min-width: 0; box-sizing: border-box; }
      .dropdown-menu-anos .dropdown-item { text-align: center; justify-content: center; }
      .dropdown-menu-select .dropdown-item {
        font-size: 15px;
        padding: var(--space-3) var(--space-3);
      }

      .form-botao {
        background: var(--accent);
        color: #f5f5f7;
        border: none;
        border-radius: var(--radius-md);
        padding: var(--space-4);
        font-size: 15px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.2s ease, transform 0.15s ease;
      }
      .form-botao:hover { background: var(--accent-h); }
      .form-botao:active { transform: scale(0.98); }
      .form-botao-perigo { background: transparent; border: 1px solid rgba(138,53,53,0.4); color: #c0504a; }
      .form-botao-perigo:hover { background: rgba(138,53,53,0.12); }
      .confirmar-exclusao-acoes { display: flex; gap: var(--space-3); }
      .confirmar-exclusao-acoes .form-botao { flex: 1; min-width: 0; }
      .form-botao-perigo.form-botao-confirmar-exclusao,
      .form-botao-perigo.form-botao-confirmar-exclusao:hover {
        background: rgba(138,53,53,0.2);
        border-color: #8a3535;
        color: #f5f5f7;
      }
      .form-botao-secundario { background: transparent; border: 1px solid var(--border2); color: var(--color-label); }
      .form-botao-secundario:hover { background: var(--bg3); color: var(--color-value); }

            .lista-anos-wrap {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
      .lista-anos-linha {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: var(--radius-md);
        padding: var(--space-4);
        transition: border-color 0.15s ease;
      }
      .lista-anos-linha:focus-within {
        border-color: rgba(10,85,80,0.5);
      }
      .lista-anos-linha-header {
        display: flex;
        align-items: flex-end;
        gap: var(--space-3);
      }
      .lista-anos-ano {
        flex: 0 0 auto;
        min-width: 0;
        max-width: 100px;
      }
      .lista-anos-valor {
        flex: 1;
        min-width: 0;
      }
      .bolhas-wrap {
        display: flex;
        justify-content: center;
        padding: var(--space-2) 0;
      }
      .treemap { position: relative; width: 100%; }
      .treemap-bloco {
        position: absolute;
        padding: 4px;
        box-sizing: border-box;
        cursor: pointer;
        animation: blocoEntrar 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards;
        transition: opacity 0.2s ease;
      }
      .treemap-bloco-in {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 6px;
        overflow: hidden;
        color: #f5f5f7;
        transition: filter 0.2s ease;
      }
      .treemap-bloco:hover .treemap-bloco-in { filter: brightness(1.18); }
      .treemap-titulo { font-weight: 700; line-height: 1.25; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.92; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
      .treemap-num { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .treemap-pct { font-weight: 800; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; white-space: nowrap; flex-shrink: 0; }
      .treemap-valor { font-size: 12px; font-weight: 600; opacity: 0.85; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .tt-card.treemap-tip { position: absolute; z-index: 10; pointer-events: none; white-space: nowrap; min-width: 236px; }
      .tt-card {
        --tt-pos: #3fd0c4; --tt-neg: #e0857d;
        min-width: 170px;
        padding: 14px 16px;
        border-radius: 16px;
        box-shadow: 0 12px 32px rgba(0,0,0,0.45);
        display: flex; flex-direction: column; gap: 10px;
        white-space: nowrap;
      }
      :root[data-theme="light"] .tt-card { --tt-pos: #0a5550; --tt-neg: #8a3535; box-shadow: 0 12px 28px rgba(16,32,29,0.16); }
      .tt-card .tt-pos { color: var(--tt-pos); }
      .tt-card .tt-neg { color: var(--tt-neg); }
      .tt-card .tt-neu { color: var(--color-label); }
      @media (max-width: 640px) {
        .tt-card.chart-tooltip { padding: 10px 12px; gap: 8px; border-radius: 14px; min-width: 140px; }
        .tt-card.treemap-tip { min-width: 200px; }
        .tt-card .tt-valor { font-size: 18px; }
        .tt-card .tt-linha { font-size: 11.5px; gap: 12px; }
        .tt-card .tt-titulo { font-size: 11px; }
      }
      .tt-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .tt-titulo { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-label); }
      .tt-pilula {
        font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px;
        background: rgba(var(--brilho, 255,255,255), 0.07);
        background: color-mix(in srgb, currentColor 14%, transparent);
        font-variant-numeric: tabular-nums;
      }
      .tt-valor { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; line-height: 1; color: var(--color-value); font-variant-numeric: tabular-nums; }
      .tt-bloco { display: flex; flex-direction: column; gap: 7px; padding-top: 10px; border-top: 1px solid var(--border2); }
      .tt-linha { display: flex; align-items: baseline; justify-content: space-between; gap: 18px; font-size: 12.5px; }
      .tt-rotulo { color: var(--color-label); font-weight: 500; }
      .tt-dado { color: var(--color-value); font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
      .tt-barra { position: relative; height: 5px; border-radius: 999px; background: var(--bar-track); margin-top: 3px; }
      .tt-barra-fill { height: 100%; border-radius: 999px; background: var(--tt-pos); transition: width 0.3s ease; }
      .tt-barra-meta { position: absolute; top: -3px; width: 2px; height: 11px; border-radius: 1px; background: var(--text); opacity: 0.55; transform: translateX(-1px); }
      @keyframes blocoEntrar { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
      @media (prefers-reduced-motion: reduce) { .treemap-bloco { animation: none; } }

      .alocacao-item-compacta {
        position: relative;
      }
      .alocacao-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
        display: inline-block;
      }
      .alocacao-meta-tag {
        white-space: nowrap;
        flex-shrink: 0;
      }
      .alocacao-item-compacta .list-row-right {
        flex-direction: column;
        align-items: flex-end;
        gap: var(--space-1);
      }
      .alocacao-item-compacta .list-row-values {
        flex-direction: row;
        align-items: baseline;
        justify-content: space-between;
        width: 240px;
        gap: var(--space-2);
      }
      .alocacao-item-compacta .list-row-sub {
        text-align: left;
      }
      .alocacao-label-col {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .alocacao-mini-barra {
        position: relative;
        display: block;
        width: 240px;
        flex-shrink: 0;
        height: 6px;
        border-radius: var(--radius-pill);
        background: var(--bar-track);
        overflow: hidden;
      }
      .alocacao-mini-barra-fill {
        display: block;
        height: 100%;
        border-radius: var(--radius-pill);
        transition: width 0.6s cubic-bezier(0.4,0,0.2,1);
      }
      .alocacao-meta-marcador {
        position: absolute;
        top: -2.5px;
        width: 2px;
        height: 11px;
        border-radius: 1px;
        background: var(--text);
        opacity: 0.45;
        transform: translateX(-1px);
      }
      .ativo-nome-ticker-linha {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
      }
      .ativo-posicao-classe {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        width: 100%;
        max-width: 180px;
        margin-top: 6px;
      }
      .ativo-posicao-classe-barra {
        flex: 1 1 auto;
        min-width: 0;
        width: auto;
        height: 4px;
      }
      .ativo-posicao-classe-pct {
        font-size: 11px;
        font-weight: 600;
        color: var(--color-label);
        flex-shrink: 0;
      }
      .btn-remover-linha {
        background: rgba(138,53,53,0.12);
        border: 1px solid rgba(138,53,53,0.3);
        color: #c0504a;
        width: 42px;
        height: 42px;
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        flex-shrink: 0;
        margin-left: auto;
        transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
        -webkit-tap-highlight-color: transparent;
      }
      .btn-remover-linha:hover { background: rgba(138,53,53,0.22); border-color: rgba(138,53,53,0.5); }
      .btn-remover-linha:active { transform: scale(0.92); }
      .lista-anos-vazio {
        color: var(--color-label);
        font-size: 14px;
        text-align: center;
        padding: var(--space-4) 0;
      }

            @media (min-width: 860px) {
        .modal-sheet.modal-evolucao {
          max-width: 960px;
        }
        .modal-sheet.modal-evolucao .lista-anos-wrap {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          align-items: stretch;
        }
        .modal-sheet.modal-evolucao .lista-anos-linha {
          height: 100%;
        }
        .modal-sheet.modal-evolucao .lista-anos-linha-header {
          flex-wrap: wrap;
        }
        .modal-sheet.modal-evolucao .lista-anos-ano {
          max-width: none;
          flex: 1 1 90px;
        }
        .modal-sheet.modal-evolucao .lista-anos-valor {
          flex: 1 1 100%;
        }
      }

            .loading-page {
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg);
      }
      .loading-box {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 36px;
        width: 300px;
      }
      .loading-box.card {
        background: var(--bg2);
        border: 1px solid var(--border2);
        border-radius: 24px;
        padding: var(--space-8);
      }
      .loading-logo {
        width: 72px; height: 72px;
        background: var(--accent);
        border-radius: 20px;
        display: flex; align-items: center; justify-content: center;
        font-size: 38px; font-weight: 900; color: #f5f5f7;
      }
      .loading-logo-img {
        height: 82px; width: auto; max-width: 224px;
        object-fit: contain;
      }
      .loading-logo-breathe {
        animation: logoBreathe 2.6s ease-in-out infinite;
      }
      @keyframes logoBreathe {
        0%, 100% { transform: scale(1);    filter: brightness(1)    drop-shadow(0 0 0px rgba(10,85,80,0)); }
        50%      { transform: scale(1.07); filter: brightness(1.08) drop-shadow(0 0 16px rgba(10,85,80,0.5)); }
      }
      .loading-texto { font-size: 16px; color: var(--color-subtitle); }

            .spinner-wrap { display: flex; justify-content: center; }
      .spinner {
        width: 34px; height: 34px;
        border: 3px solid var(--spinner-track);
        border-top-color: #0a5550;
        border-radius: 50%;
        animation: spin 0.8s linear infinite, spinnerGlow 1.6s ease-in-out infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes spinnerGlow {
        0%, 100% { box-shadow: 0 0 0px rgba(10,85,80,0); }
        50%       { box-shadow: 0 0 18px 6px rgba(10,85,80,0.55); }
      }

            .root::-webkit-scrollbar { width: 6px; }
      .root::-webkit-scrollbar-track { background: transparent; }
      .root::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }

            @media (max-width: 1024px) {
        .main { padding: 106px 18px 52px; gap: 22px; }
        .navbar { width: calc(100% - 36px); max-width: none; }
        .navbar-menu-dropdown { width: calc(100% - 36px); max-width: none; }
        .card { padding: var(--space-5) !important; gap: 14px; }
        .subcard { padding: 18px !important; gap: var(--space-3); }
        .list-row { --row-pad-x: 18px; }
        .list-row-plain { --row-pad-x: 0px; }
        .card-titulo { font-size: 18px; }
        .campo-valor { font-size: 28px; }
        .campo-titulo { font-size: 13px; }
      }

            @media (max-width: 640px) {
        .main { padding: 96px var(--space-3) 40px; gap: var(--space-4); }

                .alocacao-mini-barra { width: 130px; }
        .alocacao-item-compacta .list-row-values { width: 130px; }
        .alocacao-item-compacta .list-row-left { min-width: 0; }

                .navbar {
          transform: translateX(-50%);
          width: calc(100% - 24px);
          padding: 18px 14px;
          box-sizing: border-box;
          border-radius: 20px;
        }
        .navbar-menu-dropdown { width: calc(100% - 24px); border-radius: 20px; }
        
        .navbar-logo-img { height: 30px; max-width: 100px; }
        .loading-logo-img { height: 66px; }

                .btn-topo-flutuante { bottom: 18px; right: 14px; width: 50px; height: 50px; }

                .card        { padding: 16px !important; gap: var(--space-3); }
        .card-titulo { font-size: 16px; }
        .card-header { gap: var(--space-2); }

                .subcard { padding: var(--space-4) !important; gap: 10px; }
        .subcard-titulo { padding: var(--space-2) var(--space-3) !important; }

                .campo       { gap: var(--space-1); }
        .campo-valor { font-size: 22px; }
        .campo-titulo { font-size: 12px; }

        .btn-filtro-simples { font-size: 13px; }
        .filtros-row { gap: var(--space-3); }

                .logo-ativo-principal { width: 52px !important; height: 52px !important; }
        .ativo-posicao-classe { max-width: 110px; }
        .chart-tooltip { padding: var(--space-2) 10px; font-size: 11px; }
        .tooltip-val   { font-size: 13px; }
        .tooltip-sub   { font-size: 11px; }

                .heatmap-cell { min-height: 66px; padding: var(--space-2) var(--space-1); border-radius: var(--radius-md); }
        .hm-ticker { font-size: 12px; }
        .hm-pct    { font-size: 11px; }
        .hm-brl    { font-size: 14px; }
      }

            @media (max-width: 400px) {
        .main { padding: 105px 10px 34px; gap: var(--space-4); }
        .card        { padding: 13px !important; gap: var(--space-4); }
        .subcard     { padding: 12px !important; gap: var(--space-2); }
        .list-row    { --row-pad-x: 14px; }
        .list-row-plain { --row-pad-x: 0px; }
        .subcard-titulo { padding: var(--space-1) var(--space-3) !important; }
        .campo-valor  { font-size: 19px; }
        .campo-titulo { font-size: 11px; }
        .campo        { gap: var(--space-1); }
        .card-titulo  { font-size: 15px; }
        
        .btn-filtro-simples { font-size: 12px; }
        .heatmap-cell { min-height: 58px; padding: 6px 3px; }
        .logo-ativo-principal { width: 46px !important; height: 46px !important; }
        .chart-tooltip { padding: 6px var(--space-2); font-size: 10px; }
        .tooltip-val   { font-size: 12px; }
        .tooltip-sub   { font-size: 10px; }
        .ativo-posicao-classe { max-width: 88px; margin-top: 4px; }
        .ativo-posicao-classe-barra { height: 3px; }
        .ativo-posicao-classe-pct { font-size: 10px; }
      }

            @media (max-width: 340px) {
        .main    { padding: 78px var(--space-2) var(--space-7); gap: 10px; }
        .card    { padding: 11px !important; gap: var(--space-2); }
        .subcard { padding: 8px !important; gap: 6px; }
        .list-row { --row-pad-x: var(--space-3); }
        .list-row-plain { --row-pad-x: 0px; }
        .subcard-titulo { padding: var(--space-1) var(--space-2) !important; }
        .campo-valor  { font-size: 17px; }
        .card-titulo  { font-size: 14px; }
      }

      .config-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--space-3);
      }
      .config-grid .list-row-clickable {
        margin: 0;
        padding: var(--space-4) var(--space-4);
        border: 1px solid var(--border2);
      }
      .config-grid .list-row-clickable::after { display: none; }
      @media (max-width: 900px) { .config-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 560px) { .config-grid { grid-template-columns: minmax(0, 1fr); } }

      /* ===== Hover padrão dos botões: brilho suave, sem borda ===== */
      @media (hover: hover) {
        .btn-tema:not(.btn-tema-ativo):hover,
        .btn-filtro-simples:not(.btn-filtro-simples-ativo):hover,
        .modal-fechar:hover,
        .menu-lanc-item:not(.menu-lanc-item-perigo):hover,
        .dropdown-item:not(.is-ativo):hover,
        .config-tema-btn:not(.is-ativo):hover,
        .form-botao-secundario:hover,
        .tipo-opcao:not(.tipo-opcao-ativa):hover {
          background: linear-gradient(135deg, rgba(19,160,151,0.12), rgba(19,160,151,0.03)), var(--bg3);
          box-shadow: 0 0 22px rgba(19,160,151,0.18);
        }
        .tipo-opcao.tipo-opcao-despesa:not(.tipo-opcao-ativa):hover {
          background: linear-gradient(135deg, rgba(192,80,74,0.14), rgba(192,80,74,0.04)), var(--bg3);
          box-shadow: 0 0 22px rgba(192,80,74,0.22);
        }
        .list-row-clickable:hover,
        :root[data-theme="light"] .list-row-clickable:hover,
        .list-row-clickable.sem-zoom:hover {
          background: linear-gradient(135deg, rgba(19,160,151,0.12), rgba(19,160,151,0.03)), var(--bg3);
          border-color: transparent;
          box-shadow: 0 0 22px rgba(19,160,151,0.18);
          transform: none;
        }
        .form-botao:not(.form-botao-perigo):not(.form-botao-secundario):hover {
          box-shadow: 0 0 22px rgba(19,160,151,0.3);
        }
        .modal-sheet.tipo-despesa .form-botao:not(.form-botao-perigo):not(.form-botao-secundario):hover {
          box-shadow: 0 0 22px rgba(192,80,74,0.3);
        }
        .form-botao-perigo:hover,
        .menu-lanc-item-perigo:hover {
          box-shadow: 0 0 22px rgba(192,80,74,0.2);
        }
        .menu-lanc-item-perigo:hover { background: rgba(138,53,53,0.12); }
      }
      .list-row-clickable, .dropdown-item, .modal-fechar, .menu-lanc-item, .form-botao-secundario, .form-botao-perigo, .tipo-opcao, .config-tema-btn {
        transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease, box-shadow 0.3s ease, transform 0.15s ease;
      }

      /* ===== Navbar: pílula das abas, busca e botões transparentes (o glass da barra aparece por trás) ===== */
      @media all {
        .navbar {
          --navbar-ctrl-bg: rgba(255, 255, 255, 0.045);
          --navbar-ctrl-border: rgba(255, 255, 255, 0.09);
        }
        :root[data-theme="light"] .navbar {
          --navbar-ctrl-bg: rgba(255, 255, 255, 0.4);
          --navbar-ctrl-border: rgba(9, 30, 27, 0.09);
        }
        .navbar .navbar-tabs,
        .navbar .navbar-search-inline,
        .navbar .navbar-right .btn-tema:not(.btn-tema-ativo) {
          background: var(--navbar-ctrl-bg);
          border: 1px solid var(--navbar-ctrl-border);
          box-shadow: none;
        }
      }
      @media (hover: hover) {
        .navbar .navbar-right .btn-tema:not(.btn-tema-ativo):hover {
          background: linear-gradient(135deg, rgba(19,160,151,0.14), rgba(19,160,151,0.04)), var(--navbar-ctrl-bg);
          box-shadow: 0 0 22px rgba(19,160,151,0.18);
        }
      }

      /* ===== Navbar (telas grandes): logo e botões um pouco maiores, sem mudar a altura da barra =====
         A altura da barra é ditada pela pílula das abas (~45px), então 44px cabe sem crescer. */
      @media (min-width: 1025px) {
        .navbar-logo-img { height: 44px; max-width: 150px; }
        .navbar-logo { width: 42px; height: 42px; font-size: 20px; border-radius: 12px; }
        .navbar .navbar-right .btn-tema { width: 44px; height: 44px; }
        .navbar .navbar-right .navbar-ia-img { width: 29px; height: 29px; }
        .navbar .navbar-right .navbar-config-btn svg { width: 22px; height: 22px; }
        .navbar .navbar-right .btn-tema:not(.navbar-ia-btn):not(.navbar-config-btn) svg { width: 18px; height: 18px; }
        .navbar .navbar-ia-badge { top: 5px; right: 5px; }
      }

      /* ===== Assistente IA ===== */
      .ia-ilha {
        --ia-mola: cubic-bezier(0.32, 1.22, 0.42, 1);
        --ia-larg: min(480px, calc(100vw - var(--ia-dir, 30px) - 12px));
        position: fixed;
        top: var(--ia-topo, 90px);
        right: var(--ia-dir, 30px);
        transform-origin: top right;
        z-index: 960;
        box-sizing: border-box;
        overflow: hidden;
        width: 40px;
        height: 40px;
        border-radius: 20px;
        opacity: 0;
        pointer-events: none;
        background: #000;
        color: #f5f5f7;
        border: 1px solid rgba(255,255,255,0.1);
        box-shadow: 0 8px 28px rgba(0,0,0,0.4);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition:
          width 0.55s var(--ia-mola),
          height 0.55s var(--ia-mola),
          border-radius 0.55s var(--ia-mola),
          top 0.3s ease,
          right 0.4s var(--ia-mola),
          opacity 0.2s ease,
          background-color 0.35s ease,
          border-color 0.35s ease,
          box-shadow 0.35s ease;
      }
      .ia-ilha:focus-visible { outline: 2px solid #3fd0c4; outline-offset: 2px; }
      .ia-ilha-aviso, .ia-ilha-confirmar, .ia-ilha-aberto { opacity: 1; pointer-events: auto; }
      .ia-ilha-aviso:active { transform: scale(0.97); }
      .ia-ilha-aviso { width: min(340px, calc(100vw - var(--ia-dir, 30px) - 12px)); height: 44px; border-radius: 22px; }
      .ia-ilha-confirmar { width: min(380px, calc(100vw - var(--ia-dir, 30px) - 12px)); height: 164px; border-radius: 30px; cursor: default; }
      .ia-ilha-aberto {
        width: var(--ia-larg);
        height: min(640px, calc(100vh - var(--ia-topo, 90px) - 16px));
        height: min(640px, calc(100dvh - var(--ia-topo, 90px) - 16px));
        border-radius: var(--radius-card);
        background: var(--navbar-bg);
        -webkit-backdrop-filter: blur(20px);
        backdrop-filter: blur(20px);
        color: var(--color-value);
        border-color: var(--navbar-border);
        box-shadow: 0 4px 24px rgba(0,0,0,0.35);
        cursor: default;
      }

      .ia-ilha-mini {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: opacity 0.2s ease, visibility 0s linear 0s;
      }
      .ia-ilha-aberto .ia-ilha-mini { opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.15s ease, visibility 0s linear 0.15s; }
      .ia-ilha-mini-in {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        width: 100%;
        padding: 0 14px;
        box-sizing: border-box;
        animation: iaMiniIn 0.35s ease 0.12s both;
      }
      @keyframes iaMiniIn { from { opacity: 0; transform: scale(0.92); filter: blur(3px); } to { opacity: 1; transform: none; filter: none; } }
      .ia-ilha-aviso-txt { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
      .ia-ilha-conf { display: flex; flex-direction: column; gap: 10px; align-items: stretch; text-align: left; width: 100%; height: auto; padding: 4px 6px; background: none; border-radius: 0; cursor: default; }
      .ia-ilha-conf-titulo { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #3fd0c4; }
      .ia-ilha-conf-texto { font-size: 14px; line-height: 1.4; color: #f5f5f7; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
      .ia-ilha-conf-acoes { display: flex; gap: 8px; }
      .ia-ilha-btn { flex: 1; min-width: 0; padding: 10px; font-size: 14px; font-weight: 600; font-family: inherit; border-radius: 999px; cursor: pointer; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.08); color: #f5f5f7; transition: transform 0.15s ease, background 0.15s ease; }
      .ia-ilha-btn:active { transform: scale(0.96); }
      .ia-ilha-btn-ok { background: #0d6e68; border-color: #0d6e68; }

      .navbar-ia-btn { position: relative; }
      .navbar-ia-img { width: 25px; height: 25px; object-fit: contain; display: block; pointer-events: none; }
      .navbar-ia-badge {
        position: absolute; top: 4px; right: 4px;
        width: 8px; height: 8px; border-radius: 50%;
        background: #3fd0c4;
        animation: iaDot 1.2s ease-in-out infinite;
      }

      .ia-ilha-cheio {
        position: absolute;
        top: 0; left: 0;
        width: var(--ia-larg);
        height: 100%;
        display: flex;
        flex-direction: column;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transition: opacity 0.15s ease, visibility 0s linear 0.15s;
      }
      .ia-ilha-aberto .ia-ilha-cheio { opacity: 1; visibility: visible; pointer-events: auto; transition: opacity 0.3s ease 0.18s, visibility 0s; }

      @media (prefers-reduced-motion: reduce) {
        .ia-ilha, .ia-ilha-mini, .ia-ilha-cheio { transition-duration: 0.01s !important; transition-delay: 0s !important; }
        .ia-ilha-mini-in { animation: none; }
      }

      .ia-ilha-cheio { --brilho: 255, 255, 255; --ia-linha: rgba(255,255,255,0.07); }
      :root[data-theme="light"] .ia-ilha-cheio { --brilho: 9, 30, 27; --ia-linha: rgba(9,30,27,0.08); }

      .ia-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        padding: 12px 14px 12px 22px;
        border-bottom: 1px solid var(--ia-linha);
        flex-shrink: 0;
      }
      .ia-header-titulo { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; letter-spacing: 0.01em; color: var(--color-title); }
      .ia-header-icone { width: 24px; height: 24px; object-fit: contain; display: block; flex-shrink: 0; pointer-events: none; }
      .ia-header-acoes { display: flex; align-items: center; gap: 8px; }
      /* botões do cabeçalho usam o estilo .btn-tema, igual aos outros botões do programa */
      .ia-icone { color: var(--color-label); }
      .ia-icone:hover { color: var(--color-value); }
      .ia-icone.btn-tema-ativo, .ia-icone.btn-tema-ativo:hover { color: #f5f5f7; }
      /* mesmo fundo translúcido dos botões da barra superior (telas grandes) */
      @media (min-width: 641px) {
        .ia-ilha-cheio {
          --navbar-ctrl-bg: rgba(255, 255, 255, 0.045);
          --navbar-ctrl-border: rgba(255, 255, 255, 0.09);
        }
        :root[data-theme="light"] .ia-ilha-cheio {
          --navbar-ctrl-bg: rgba(255, 255, 255, 0.4);
          --navbar-ctrl-border: rgba(9, 30, 27, 0.09);
        }
        .ia-header-acoes .btn-tema:not(.btn-tema-ativo) {
          background: var(--navbar-ctrl-bg);
          border: 1px solid var(--navbar-ctrl-border);
          box-shadow: none;
        }
      }
      @media (min-width: 641px) and (hover: hover) {
        .ia-header-acoes .btn-tema:not(.btn-tema-ativo):hover {
          background: linear-gradient(135deg, rgba(19,160,151,0.14), rgba(19,160,151,0.04)), var(--navbar-ctrl-bg);
          box-shadow: 0 0 22px rgba(19,160,151,0.18);
        }
      }

      .ia-corpo {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 20px 22px;
        display: flex;
        flex-direction: column;
        gap: 18px;
        scrollbar-width: none;
      }
      .ia-corpo::-webkit-scrollbar { display: none; }

      .ia-msg {
        font-size: 14px;
        line-height: 1.6;
        word-break: break-word;
      }
      .ia-msg-user {
        align-self: flex-end;
        max-width: 85%;
        padding: 9px 14px;
        background: rgba(var(--brilho), 0.08);
        color: var(--color-title);
        border-radius: 16px 16px 4px 16px;
      }
      .ia-msg-ia {
        align-self: stretch;
        padding: 0;
        color: var(--color-value);
      }
      .ia-msg-sys {
        align-self: flex-start;
        font-size: 12px;
        color: var(--color-label);
      }
      .ia-msg-erro {
        align-self: stretch;
        padding: 10px 14px;
        background: rgba(217,119,111,0.1);
        color: #d9776f;
        border-radius: 12px;
        font-size: 13px;
      }
      .ia-li { position: relative; padding-left: 14px; }
      .ia-li::before { content: "•"; position: absolute; left: 2px; opacity: 0.7; }

      .ia-digitando { display: flex; align-items: center; gap: 5px; padding: 6px 0; }
      .ia-digitando span {
        width: 5px; height: 5px;
        border-radius: 50%;
        background: var(--color-label);
        animation: iaDot 1.2s ease-in-out infinite;
      }
      .ia-digitando span:nth-child(2) { animation-delay: 0.15s; }
      .ia-digitando span:nth-child(3) { animation-delay: 0.3s; }
      @keyframes iaDot { 0%, 80%, 100% { opacity: 0.25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }

      .ia-vazio { margin: auto 0; display: flex; flex-direction: column; align-items: stretch; gap: 6px; }
      .ia-vazio-titulo { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; color: var(--color-title); }
      .ia-vazio-sub { font-size: 13px; color: var(--color-label); line-height: 1.55; max-width: 320px; }
      .ia-chips { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; width: 100%; margin-top: 20px; }
      .ia-chip {
        background: var(--bg3);
        border: 1px solid var(--border2);
        color: var(--color-value);
        font-family: inherit;
        font-size: 13px;
        font-weight: 500;
        text-align: left;
        line-height: 1.3;
        padding: 10px 14px;
        border-radius: 16px;
        min-height: 54px;
        display: flex;
        align-items: center;
        cursor: pointer;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease, opacity 0.2s ease;
      }
      .ia-chip:active:not(:disabled) { transform: scale(0.97); }
      .ia-chip:disabled { opacity: 0.5; cursor: default; }
      @media (hover: hover) {
        .ia-chip:not(:disabled):hover {
          background: linear-gradient(135deg, rgba(19,160,151,0.12), rgba(19,160,151,0.03)), var(--bg3);
          box-shadow: 0 0 22px rgba(19,160,151,0.18);
        }
      }
      /* mesmo fundo translúcido dos botões da barra superior (telas grandes) */
      @media (min-width: 641px) {
        .ia-chip {
          background: var(--navbar-ctrl-bg);
          border: 1px solid var(--navbar-ctrl-border);
          box-shadow: none;
        }
      }
      @media (min-width: 641px) and (hover: hover) {
        .ia-chip:not(:disabled):hover {
          background: linear-gradient(135deg, rgba(19,160,151,0.14), rgba(19,160,151,0.04)), var(--navbar-ctrl-bg);
          box-shadow: 0 0 22px rgba(19,160,151,0.18);
        }
      }

      .ia-confirmar {
        align-self: stretch;
        background: rgba(var(--brilho), 0.05);
        border: 1px solid var(--ia-linha);
        border-radius: 14px;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .ia-confirmar-titulo { font-size: 13px; font-weight: 600; color: var(--color-title); }
      .ia-confirmar-texto { font-size: 14px; color: var(--color-value); line-height: 1.5; }
      .ia-confirmar-acoes { display: flex; gap: 8px; }
      .ia-confirmar-acoes .form-botao { flex: 1; min-width: 0; padding: 9px 12px; font-size: 13px; border-radius: 999px; }

      .ia-config { display: flex; flex-direction: column; gap: var(--space-4); }
      .ia-config-texto { font-size: 13px; line-height: 1.5; color: var(--color-label); }
      .ia-config-texto strong { color: var(--color-value); }
      /* telas grandes: caixas e botões mais compactos na página de configurações */
      @media (min-width: 901px) {
        .ia-config-pagina { max-width: 460px; gap: var(--space-3); }
        .ia-config-pagina .form-input { padding: 11px 14px; font-size: 14px; }
        .ia-config-pagina .confirmar-exclusao-acoes { gap: var(--space-2); }
        .ia-config-pagina .form-botao { flex: 0 0 auto; padding: 8px 18px; font-size: 13px; }
      }
      /* telas pequenas: botões mais baixos, texto menor e sem quebra de linha */
      @media (max-width: 900px) {
        .ia-config-pagina .confirmar-exclusao-acoes { gap: var(--space-2); flex-wrap: wrap; align-items: stretch; }
        .ia-config-pagina .form-botao {
          flex: 1 1 130px;
          padding: 10px 12px;
          font-size: 13px;
          line-height: 1.2;
          white-space: nowrap;
          min-height: 40px;
        }
      }
      @media (max-width: 640px) {
        .ia-config-pagina .form-input { padding: 11px 14px; font-size: 16px; }
        .ia-config-pagina .campo-titulo { font-size: 12px; line-height: 1.35; }
        .ia-config-texto { font-size: 12px; }
        .config-tema-btn { padding: 6px 14px; font-size: 13px; }
      }

      .ia-rodape {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        padding: 12px 16px 16px;
        flex-shrink: 0;
      }
      .ia-caixa {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: flex-end;
        gap: 8px;
        padding: 5px 5px 5px 18px;
        background: rgba(var(--brilho), 0.05);
        border: 1px solid var(--ia-linha);
        border-radius: 26px;
      }
      .ia-input {
        flex: 1;
        min-width: 0;
        resize: none;
        max-height: 120px;
        padding: 9px 0;
        background: transparent;
        border: none;
        outline: none;
        box-shadow: none;
        color: var(--color-value);
        font-family: inherit;
        font-size: 14px;
        line-height: 1.45;
      }
      .ia-input::placeholder { color: var(--color-label); }

      /* caixas de texto: sem borda verde, só um brilho suave ao passar o mouse e ao clicar */
      .navbar .navbar-search-inline { --brilho: 255, 255, 255; }
      :root[data-theme="light"] .navbar .navbar-search-inline { --brilho: 9, 30, 27; }
      .ia-caixa:hover,
      .navbar .navbar-search-inline:hover {
        box-shadow: 0 0 14px rgba(var(--brilho), 0.07);
      }
      .ia-caixa:focus-within,
      .navbar .navbar-search-inline:focus-within {
        box-shadow: 0 0 18px rgba(var(--brilho), 0.12);
      }
      .ia-caixa, .navbar .navbar-search-inline { transition: box-shadow 0.2s ease; }
      .ia-enviar {
        width: 38px; height: 38px;
        border-radius: 50%;
        background: var(--accent);
        color: #f5f5f7;
        border: none;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
        transition: background 0.2s ease, opacity 0.2s ease, transform 0.15s ease;
      }
      .ia-enviar:hover:not(:disabled) { background: var(--accent-h); }
      .ia-enviar:active:not(:disabled) { transform: scale(0.94); }
      .ia-enviar:disabled { opacity: 0.25; cursor: default; }

      @media (min-width: 641px) {
        /* telas grandes: o popup fica alinhado à borda direita do layout (mesma da barra superior e dos cards) */
        .ia-ilha-aviso, .ia-ilha-confirmar, .ia-ilha-aberto {
          right: var(--ia-nav-dir, 30px);
        }
      }

      @media (max-width: 640px) {
        /* telas pequenas: o chat ocupa a mesma largura da barra superior e dos cards */
        .ia-ilha-aviso, .ia-ilha-confirmar, .ia-ilha-aberto {
          right: var(--ia-nav-dir, 18px);
          --ia-larg: var(--ia-nav-larg);
          width: var(--ia-larg);
        }
        .ia-corpo { padding-left: 18px; padding-right: 18px; }
        .ia-header { padding-left: 18px; }
        .ia-input::placeholder { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ia-input { font-size: 16px; } /* 16px evita o zoom automático ao focar no celular */
      }
    `}</style>
  );
}