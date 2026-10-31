import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { createPortal } from "react-dom";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell, ReferenceLine } from "recharts";
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

const ABAS_ATIVOS = [
  ...CLASSES_ATIVOS.map(c => ({ id: c.classe, titulo: c.titulo })),
  { id: "reserva", titulo: "Reserva" },
];

const PAGINAS = [
  { id: "patrimonio",  titulo: "Patrimônio" },
  { id: "alocacao",    titulo: "Alocação"   },
  { id: "ativos",      titulo: "Ativos"     },
  { id: "retornos",    titulo: "Retornos"   },
  { id: "financas",    titulo: "Finanças"   },
];

const FILTROS = [
  { texto: "Nome",        curto: "Nome",    key: "nome"                },
  { texto: "Total atual", curto: "Total",   key: "total_atual"         },
  { texto: "Variação",    curto: "Var.",    key: "variacao_total"      },
  { texto: "Variação %",  curto: "Var. %",  key: "variacao_percentual" },
  { texto: "% Atual",     curto: "% Atual", key: "porcentagem_atual"   },
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

// ─── Cotações: Yahoo Finance (candles diários) via Worker próprio ───────────
// Publique o arquivo cotacoes-worker.js na Cloudflare (grátis) e cole a URL aqui.
// Enquanto estiver vazio, o app continua usando a planilha do Google como antes.
const COTACOES_API_URL = "https://still-grass-59cd.acumulei.workers.dev";
const COTACOES_LOTE = 20;

// Exceções de símbolo: ticker do app (minúsculo) → símbolo do Yahoo
const SIMBOLOS_YAHOO_EXCECOES = { dolar: "USDBRL=X" };

function simboloYahoo(ticker, classe) {
  const t = String(ticker ?? "").trim();
  if (SIMBOLOS_YAHOO_EXCECOES[t.toLowerCase()]) return SIMBOLOS_YAHOO_EXCECOES[t.toLowerCase()];
  const T = t.toUpperCase();
  if (classe === "acao" || classe === "fii") return `${T}.SA`;   // B3
  if (classe === "bitcoin") return `${T}-BRL`;                    // cripto cotada em reais
  return T.replace(/\./g, "-");                                    // stock / reit (BRK.B → BRK-B)
}

async function buscarLoteCotacoes(simbolos) {
  const r = await fetch(`${COTACOES_API_URL}?s=${encodeURIComponent(simbolos.join(","))}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`cotações: HTTP ${r.status}`);
  return (await r.json()).cotacoes ?? [];
}

// Devolve linhas no mesmo formato da planilha ({ ticker, cotacao, cotacao_ontem, cotacao_abertura, ... }).
// O que a API não trouxer (ou se ela falhar por inteiro) cai na planilha, ativo a ativo.
async function carregarCotacoes(ativosLocais, linhasPlanilha = []) {
  const planilha = linhasPlanilha ?? [];
  if (!COTACOES_API_URL) return planilha;

  const alvos = [
    { ticker: "dolar", simbolo: simboloYahoo("dolar") },
    ...Object.keys(ativosLocais ?? {}).map(ticker => ({
      ticker,
      simbolo: simboloYahoo(ticker, String(ativosLocais[ticker]?.classe ?? "").toLowerCase().trim()),
    })),
  ];
  const simbolos = [...new Set(alvos.map(a => a.simbolo))];
  const lotes = [];
  for (let i = 0; i < simbolos.length; i += COTACOES_LOTE) lotes.push(simbolos.slice(i, i + COTACOES_LOTE));

  const respostas = (await Promise.allSettled(lotes.map(buscarLoteCotacoes)))
    .flatMap(r => (r.status === "fulfilled" ? r.value : []));
  const porSimbolo = new Map(respostas.filter(c => c?.ok && c.cotacao > 0).map(c => [c.simbolo, c]));

  const daApi = alvos.filter(a => porSimbolo.has(a.simbolo)).map(a => {
    const c = porSimbolo.get(a.simbolo);
    return {
      ticker: a.ticker,
      cotacao: c.cotacao,
      cotacao_ontem: c.cotacao_ontem,
      cotacao_abertura: c.cotacao_abertura,
      pregao: c.pregao,
      hoje: c.hoje,
    };
  });
  const tickersApi = new Set(daApi.map(r => r.ticker.toLowerCase()));
  return [...daApi, ...planilha.filter(r => !tickersApi.has(String(r.ticker ?? "").trim().toLowerCase()))];
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

// Dólar do dia anterior (coluna cotacao_ontem da linha "dolar"); sem ele, usa o dólar atual
// para a variação do dia refletir só o movimento dos ativos.
function calcularTaxaDolarOntem(ativosPlanilha) {
  const linhaMoeda = (ativosPlanilha ?? []).find(
    row => String(row.ticker ?? "").trim().toLowerCase() === "dolar"
  );
  const ontem = linhaMoeda ? toFloat(linhaMoeda.cotacao_ontem) : 0;
  return ontem > 0 ? ontem : calcularTaxaDolar(ativosPlanilha);
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

// Variação diária e variação desde a abertura de um ativo.
//
// Com cotações vindas de candles diários (ver carregarCotacoes), `cotacao_ontem` já é o
// fechamento do pregão anterior ao da cotação e `cotacao_abertura` é a abertura do MESMO
// pregão. Fim de semana e feriado não geram candle, então não há caso especial:
//   Variação diária        = cotação / fechamento anterior - 1
//   Variação desde abertura = cotação / abertura - 1
// Sem valor válido (vazio, zero), o indicador não é calculado, sem substituir por outro número.
function calcularVariacaoDiaria({ cotacao, cotacao_ontem, cotacao_abertura }) {
  const tem_ontem = cotacao > 0 && cotacao_ontem > 0;
  const pct = tem_ontem ? (cotacao / cotacao_ontem - 1) * 100 : 0;
  const pct_abertura = cotacao > 0 && cotacao_abertura > 0 ? (cotacao / cotacao_abertura - 1) * 100 : null;
  return { tem_ontem, pct, pct_abertura };
}

function montarAtivos(ativosPlanilha, dadosLocais) {

  const taxaDolar = calcularTaxaDolar(ativosPlanilha);
  const taxaDolarOntem = calcularTaxaDolarOntem(ativosPlanilha);

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
        cotacao_ontem: toFloat(row.cotacao_ontem),
        cotacao_abertura: toFloat(row.cotacao_abertura),
        pregao: String(row.pregao ?? ""),
        hoje: String(row.hoje ?? ""),
      })),
    ...Object.keys(dadosLocais.ativos ?? {})
      .filter(ticker => !tickersDaPlanilha.has(String(ticker).toLowerCase()))
      .map(ticker => ({
        ticker: String(ticker).trim(),
        cotacao: toFloat(dadosLocais.ativos[ticker]?.cotacao),
        cotacao_ontem: 0,
        cotacao_abertura: 0,
        pregao: "",
        hoje: "",
      })),
  ];

  const semPercentuais = linhas.map(({ ticker, cotacao, cotacao_ontem, cotacao_abertura, pregao, hoje }) => {
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

    // Variação do dia (vs. fechamento anterior). Sem cotação de ontem, o ativo conta como "sem variação".
    // O % é a variação da cotação (na moeda do ativo); o valor em R$ inclui o efeito do dólar.
    const dia = calcularVariacaoDiaria({ cotacao, cotacao_ontem, cotacao_abertura });
    const tem_ontem = dia.tem_ontem;
    const taxaOntem = ehDolar ? taxaDolarOntem : 1;
    const total_ontem = tem_ontem ? quantidade * cotacao_ontem * taxaOntem : total_atual;
    const variacao_dia = total_atual - total_ontem;
    const variacao_dia_pct = dia.pct;

    // Variação desde a abertura do pregão da cotação (movimento intradiário).
    const tem_variacao_abertura = dia.pct_abertura !== null;
    const variacao_abertura_pct = tem_variacao_abertura ? dia.pct_abertura : 0;
    const variacao_abertura = tem_variacao_abertura ? quantidade * (cotacao - cotacao_abertura) * taxa : 0;

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
      cotacao_ontem,
      tem_ontem,
      total_ontem,
      variacao_dia,
      variacao_dia_pct,
      cotacao_abertura,
      pregao,
      hoje,
      tem_variacao_abertura,
      variacao_abertura,
      variacao_abertura_pct,
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

function AbasAtivos({ abas, valor, onChange }) {
  return (
    <div className="abas-ativos abas-classes">
      <div className="navbar-tabs" role="tablist" aria-label="Classes de ativos">
        {abas.map(a => (
          <button
            key={a.id}
            role="tab"
            aria-selected={valor === a.id}
            className={`navbar-tab${valor === a.id ? " navbar-tab-ativo" : ""}`}
            onClick={() => onChange(a.id)}
          >
            {a.titulo}
          </button>
        ))}
      </div>
    </div>
  );
}

// `fixo`: colunas de largura fixa (auto-fill); poucos itens ficam do tamanho normal, nas primeiras colunas
function StatGrid({ children, fixo = false }) {
  return <div className={`stat-grid${fixo ? " stat-grid-fixo" : ""}`}>{children}</div>;
}

function StatCard({ label, value, color, extra, extraColor, sub, logo, badge = true }) {
  const corExtra = extraColor ?? color;
  const conteudo = (
    <>
      <span className="campo-titulo">{label}</span>
      <div className="stat-linha" style={badge ? { alignItems: "center" } : undefined}>
        <span className="stat-valor" style={color ? { color } : undefined}>{value}</span>
        {extra && (badge
          ? <span className={`stat-badge${corExtra === COR_BAIXA ? " stat-badge-neg" : ""}`}>{extra}</span>
          : <span className="stat-sub" style={corExtra ? { color: corExtra } : undefined}>{extra}</span>)}
      </div>
      {sub && <span className="stat-sub" style={{ color: "var(--color-label)", fontWeight: 500 }}>{sub}</span>}
    </>
  );
  return (
    <SubCard className="stat-card">
      {logo ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", minWidth: 0 }}>{conteudo}</div>
          {logo}
        </div>
      ) : conteudo}
    </SubCard>
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

function Navbar({ scrolled, ativos, onSelectTicker, pagina, onNavigate, tema }) {
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
  const SEARCH_GAP      = 10; // px entre a barra superior e a caixa de busca

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

        {pagina === "ativos" && (
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

// Chama `aoClicarFora` quando o toque/clique começa fora do elemento de `ref`.
function useCliqueFora(ref, aoClicarFora) {
  const cb = useRef(aoClicarFora);
  cb.current = aoClicarFora;
  useEffect(() => {
    const h = (e) => {
      const el = ref.current;
      if (el && !el.contains(e.target)) cb.current(e);
    };
    document.addEventListener("pointerdown", h, true);
    return () => document.removeEventListener("pointerdown", h, true);
  }, [ref]);
}

// Conteúdo de tooltip do Recharts que some quando o gráfico foi fechado por clique fora.
function TooltipFechavel({ fechado, Comp, ...resto }) {
  return fechado ? null : <Comp {...resto} />;
}

// Área rolável na horizontal para gráficos anuais: em telas pequenas mostra
// os últimos 8 anos na tela e, havendo mais, o gráfico rola com o dedo;
// em telas grandes ocupa 100% da largura. Abre já rolado até o ano mais recente.
// Se `children` for uma função, recebe o centro horizontal da área visível
// (em px, dentro do gráfico) em telas pequenas, ou null em telas grandes.
// Serve para centralizar os tooltips na tela.
function GraficoRolavel({ qtd, children, style = {}, aoFechar }) {
  const ref = useRef(null);
  const wrapRef = useRef(null);
  const [centro, setCentro] = useState(null);
  const [tip, setTip] = useState(null);
  const [fechado, setFechado] = useState(false);

  // Toque/clique fora do gráfico fecha o tooltip. Em telas de toque o Recharts não
  // desativa o tooltip sozinho, então simulamos a saída do mouse nos gráficos dele.
  useCliqueFora(wrapRef, () => {
    wrapRef.current?.querySelectorAll(".recharts-wrapper").forEach(el =>
      el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, cancelable: true, relatedTarget: null }))
    );
    setFechado(true);
    aoFechar?.();
  });
  // voltou a interagir com o gráfico: tooltip liberado de novo
  const reabrir = () => setFechado(f => (f ? false : f));

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
    <div
      ref={wrapRef}
      style={{ position: "relative", width: "100%", ...style }}
      onPointerEnter={reabrir}
      onPointerDown={reabrir}
      onPointerMove={reabrir}
      onClick={reabrir}
    >
      <div ref={ref} className="grafico-rolavel">
        <div className="grafico-rolavel-inner" style={{ "--n-anos": qtd }}>
          {typeof children === "function" ? children(centro, setTip, fechado) : children}
        </div>
      </div>
      {centro != null && tip && !fechado && (
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

// Botão só com ícone que abre uma lista suspensa (usado nas telas pequenas no lugar das abas/filtros).
const ICONE_SELETOR = {
  classes: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
    </>
  ),
  filtro: (
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <circle cx="9" cy="6" r="2" fill="var(--bg3)" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="15" cy="12" r="2" fill="var(--bg3)" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="11" cy="18" r="2" fill="var(--bg3)" />
    </>
  ),
};

function SeletorIcone({ value, onChange, options, icone = "filtro", rotulo }) {
  const [open, setOpen] = useState(false);
  const visivel = usePresenca(open);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 190 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const atualizarPos = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const largura = Math.min(210, window.innerWidth - 24);
    const left = Math.min(Math.max(rect.left, 12), window.innerWidth - largura - 12);
    setPos({ top: rect.bottom + 8, left, width: largura });
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

  return (
    <div ref={triggerRef} style={{ display: "inline-flex" }}>
      <button
        type="button"
        className={`btn-tema${open ? " btn-tema-ativo" : ""}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={rotulo}
        title={rotulo}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {ICONE_SELETOR[icone]}
        </svg>
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
    <Card className="widget-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <h2 className="card-titulo">Patrimônio</h2>
        {onEditarEvolucao && (
          <button className="btn-tema" onClick={onEditarEvolucao} aria-label="Editar evolução do patrimônio" title="Editar evolução do patrimônio">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
            </svg>
          </button>
        )}
      </div>

      {temEvolucao && (
        <div className="sem-card-bloco">
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
              {sinal(mediaCrescimentoAnualReais)}{fmtBRL(mediaCrescimentoAnualReais)}
            </span>
          </div>
          <GraficoRolavel qtd={dataEvolucao.length} style={{ marginTop: "var(--space-3)" }}>
          {(centro, setTip, fechado) => (
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
                  : <TooltipFechavel fechado={fechado} Comp={CustomTooltipEvolucao} />}
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
        </div>
      )}

      <div className="stat-grid">
        <SubCard className="stat-card">
          <span className="campo-titulo">Aportado</span>
          <span className="stat-valor">{fmtBRL(aportado)}</span>
        </SubCard>

        {!!totalUSD && (
          <SubCard className="stat-card">
            <span className="campo-titulo">Atual em USD</span>
            <span className="stat-valor">{fmtUSD(totalUSD)}</span>
          </SubCard>
        )}

        <SubCard className="stat-card">
          <span className="campo-titulo">Variação</span>
          <div className="stat-linha" style={{ alignItems: "center" }}>
            <span className="stat-valor" style={{ color: corDiff }}>
              {`${sinal(diff)}${fmtBRL(diff)}`}
            </span>
            <span className={`stat-badge${corDiff === COR_BAIXA ? " stat-badge-neg" : ""}`}>{`${pctVariacao.toFixed(1)}%`}</span>
          </div>
        </SubCard>
      </div>
    </Card>
  );
}

const ANOS_PROJECAO = 10;

function TooltipProjecao({ active, payload, label, centrado = false }) {
  if (!active || !payload?.length) return null;
  const ponto = payload[0]?.payload;
  if (!ponto) return null;
  const linhas = [
    { rotulo: "Aportado", texto: fmtBRL(ponto.aportado) },
    { rotulo: "Juros", classe: classeTT(ponto.juros), texto: `${sinalCompleto(ponto.juros)}${fmtBRL(Math.abs(ponto.juros))}` },
  ];
  return <TooltipGrafico titulo={`${label} (projeção)`} valor={fmtBRL(ponto.total)} linhas={linhas} style={centrado ? ESTILO_TT_CENTRADO : undefined} />;
}

// Mesma "Média anual" exibida no card de Rentabilidade (página Retornos)
function calcularMediaRentabilidade(rentabilidade) {
  const dados = calcularRentabilidadeComDiferenca(rentabilidade);
  if (dados.length < 2) return 0;
  const acumulada = (dados.reduce((acc, d) => acc * (1 + d.valor / 100), 1) - 1) * 100;
  const anosDecorridos = parseInt(dados[dados.length - 1].ano, 10) - parseInt(dados[0].ano, 10);
  return anosDecorridos > 0 ? acumulada / anosDecorridos : 0;
}

function CardProjecaoPatrimonio({ totais, rentabilidade, evolucao }) {
  const [barraHover, setBarraHover] = useState(null);
  const total = toFloat(totais?.[0]?.total_patrimonio);
  const taxaPct = calcularMediaRentabilidade(rentabilidade);
  const taxa = taxaPct / 100;

  if (!total || taxaPct === 0) {
    return (
      <Card className="widget-card">
        <h2 className="card-titulo">Projeção</h2>
        <div className="lista-anos-vazio">
          Cadastre a rentabilidade de pelo menos dois anos (página Retornos) para ver a projeção.
        </div>
      </Card>
    );
  }

  const anoAtual = new Date().getFullYear();

  // Aporte médio anual = total aportado hoje ÷ anos de histórico
  // (do primeiro ano cadastrado na evolução do patrimônio até o ano atual, inclusive).
  const aportadoHoje = toFloat(totais?.[0]?.total_aportado);
  const anosCadastrados = (evolucao ?? [])
    .map(r => parseInt(r.ano, 10))
    .filter(n => !isNaN(n) && n <= anoAtual);
  const anosHistorico = anosCadastrados.length > 0 ? anoAtual - Math.min(...anosCadastrados) + 1 : 0;
  const aporteAnual = anosHistorico > 0 ? aportadoHoje / anosHistorico : 0;

  // Juros compostos com aporte ao fim de cada ano: v(n) = v(n-1) × (1 + rentabilidade) + aporte anual.
  // Aportado (acumulado) = aportado hoje + aporte anual × n.
  // Juros = tudo o que o patrimônio tem acima do aportado (ganhos já acumulados + projetados).
  let acumulado = total;
  const dataGrafico = Array.from({ length: ANOS_PROJECAO }, (_, i) => {
    const n = i + 1;
    acumulado = acumulado * (1 + taxa) + aporteAnual;
    const aportadoAno = aportadoHoje + aporteAnual * n;
    return {
      ano: String(anoAtual + n),
      aportado: aportadoAno,
      juros: acumulado - aportadoAno,
      total: acumulado,
      difHoje: acumulado - total,
      pctHoje: ((acumulado - total) / total) * 100,
    };
  });

  const patrimonioFinal = dataGrafico[dataGrafico.length - 1].total;
  const aportado = dataGrafico[dataGrafico.length - 1].aportado;
  const jurosFinal = patrimonioFinal - aportado;
  const pctJuros = patrimonioFinal > 0 ? (jurosFinal / patrimonioFinal) * 100 : 0;
  const ganhoTotal = patrimonioFinal - total;
  const pctTotal = total > 0 ? (ganhoTotal / total) * 100 : 0;
  const corGanho = corVar(ganhoTotal);

  return (
    <Card className="widget-card">
      <h2 className="card-titulo">Projeção</h2>

      <div className="sem-card-bloco">
        <HeroValor titulo={`Patrimônio aproximado em ${anoAtual + ANOS_PROJECAO}`} valor={fmtBRL(patrimonioFinal)} visible />
        <div
          className="campo-titulo"
          style={{ marginTop: "var(--space-2)", fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" }}
        >
          Rentabilidade média anual
          <span style={{ color: corVar(taxaPct), fontWeight: 600 }}>
            {sinal(taxaPct)}{taxaPct.toFixed(2)}%
          </span>
        </div>
        <div
          className="campo-titulo"
          style={{ fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" }}
        >
          Aporte médio anual
          <span style={{ color: "var(--color-mono)", fontWeight: 600 }}>
            {fmtBRL(aporteAnual)}
          </span>
        </div>

        <GraficoRolavel qtd={dataGrafico.length} style={{ marginTop: "var(--space-3)" }} aoFechar={() => setBarraHover(null)}>
          {(centro, setTip, fechado) => (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={dataGrafico}
              margin={{ top: 12, right: 12, left: 12, bottom: 4 }}
              barCategoryGap="18%"
              onMouseMove={(s) => {
                const i = s && s.isTooltipActive ? Number(s.activeTooltipIndex) : null;
                setBarraHover(Number.isFinite(i) ? i : null);
              }}
              onMouseLeave={() => setBarraHover(null)}
            >
              <XAxis dataKey="ano" tick={<EvolucaoXTick />} axisLine={false} tickLine={false} interval={0} />
              <YAxis hide />
              <Tooltip
                content={centro != null
                  ? <TooltipPonte onChange={setTip} Comp={TooltipProjecao} />
                  : <TooltipFechavel fechado={fechado} Comp={TooltipProjecao} />}
                cursor={false}
              />
              {/* aportado na base, juros por cima; a barra sob o mouse ganha um brilho leve */}
              <Bar dataKey="aportado" stackId="proj" fill={COR_ALTA} radius={[0, 0, 4, 4]} isAnimationActive={false}>
                {dataGrafico.map((d, i) => (
                  <Cell key={d.ano} style={{ filter: barraHover === i ? "brightness(1.2) drop-shadow(0 0 6px rgba(19,160,151,0.45))" : "none", transition: "filter 0.2s ease" }} />
                ))}
              </Bar>
              <Bar dataKey="juros" stackId="proj" fill="#13a097" radius={[8, 8, 0, 0]} isAnimationActive={false}>
                {dataGrafico.map((d, i) => (
                  <Cell key={d.ano} style={{ filter: barraHover === i ? "brightness(1.2) drop-shadow(0 0 6px rgba(19,160,151,0.45))" : "none", transition: "filter 0.2s ease" }} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          )}
        </GraficoRolavel>
      </div>

      <StatGrid>
        <StatCard
          label="Aportado"
          value={fmtBRL(aportado)}
        />
        <StatCard
          label="Juros"
          value={`${sinalCompleto(jurosFinal)}${fmtBRL(Math.abs(jurosFinal))}`}
          extra={`${pctJuros.toFixed(1)}%`}
          badge
          color={corVar(jurosFinal)}
        />
        <StatCard
          label="Aumento projetado"
          value={`${sinalCompleto(ganhoTotal)}${fmtBRL(Math.abs(ganhoTotal))}`}
          extra={`${sinal(pctTotal)}${pctTotal.toFixed(1)}%`}
          badge
          color={corGanho}
        />
      </StatGrid>
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
    <Card className="widget-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <h2 className="card-titulo">Rentabilidade</h2>
        {onEditarRentabilidade && (
          <button className="btn-tema" onClick={onEditarRentabilidade} aria-label="Editar rentabilidade" title="Editar rentabilidade">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
            </svg>
          </button>
        )}
      </div>

      {temRentabilidade ? (
        <>
          <div className="sem-card-bloco">
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
            {(centro, setTip, fechado) => (
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
                    : <TooltipFechavel fechado={fechado} Comp={CustomTooltipRentabilidade} />}
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
          </div>
        </>
      ) : (
        <div className="lista-anos-vazio">
          Nenhuma rentabilidade cadastrada ainda. Adicione em Configurações.
        </div>
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
    <Card className="widget-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <h2 className="card-titulo">Reserva</h2>
        {onEditar && (
          <button className="btn-tema" onClick={onEditar} aria-label="Editar reserva" title="Editar reserva">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
            </svg>
          </button>
        )}
      </div>

      <StatGrid>
        <StatCard label="Atual" value={fmtBRL(aktual)} />
        <StatCard
          label={textoSF}
          value={`${ssf}${fmtBRL(valorD)}`}
          extra={pctVariacao > 0 ? `${pctVariacao.toFixed(1)}%` : null}
          color={corDiferenca}
        />
        <StatCard label="Meta" value={fmtBRL(valorIdeal)} extra={`${pctIdeal.toFixed(1)}%`} />
      </StatGrid>
    </Card>
  );
}

// Treemap em linhas: as classes são divididas em linhas que ocupam toda a largura e alinham perfeitamente
// (sem blocos "aninhados"). A altura de cada linha e a largura de cada bloco são proporcionais ao peso,
// então a área de cada bloco continua proporcional ao seu peso no patrimônio.
// Testa todas as formas de quebrar a lista (já ordenada do maior para o menor) em linhas
// e escolhe a que deixa os blocos mais próximos de um quadrado.
function organizarBlocos(itens, W, H) {
  const total = itens.reduce((acc, i) => acc + i.peso, 0) || 1;
  const nos = [...itens].sort((a, b) => b.peso - a.peso).map(i => ({ ...i, a: (i.peso / total) * W * H }));
  const n = nos.length;
  if (n === 0) return [];

  const quebrar = (mask) => {
    const linhas = [];
    let atual = [];
    nos.forEach((no, i) => {
      atual.push(no);
      if (i === n - 1 || (mask >> i) & 1) { linhas.push(atual); atual = []; }
    });
    return linhas;
  };

  // pior proporção (largura/altura ou o inverso) entre todos os blocos
  const piorProporcao = (linhas) => {
    let pior = 0;
    linhas.forEach(l => {
      const rh = l.reduce((t, no) => t + no.a, 0) / W;
      l.forEach(no => {
        const w = no.a / rh;
        pior = Math.max(pior, w / rh, rh / w);
      });
    });
    return pior;
  };

  let melhor = null;
  for (let mask = 0; mask < (1 << (n - 1)); mask++) {
    const linhas = quebrar(mask);
    const pior = piorProporcao(linhas);
    if (!melhor || pior < melhor.pior - 1e-9) melhor = { linhas, pior };
  }

  const saida = [];
  let y = 0;
  melhor.linhas.forEach(l => {
    const rh = l.reduce((t, no) => t + no.a, 0) / W;
    let x = 0;
    l.forEach(no => {
      const w = no.a / rh;
      saida.push({ ...no, x, y, w, h: rh });
      x += w;
    });
    y += rh;
  });
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
  // tipo do último ponteiro (mouse/touch/pen): mouse usa hover, toque usa toque no bloco
  const tipoPonteiro = useRef("mouse");

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

  // toque/clique fora do gráfico fecha o tooltip
  useCliqueFora(wrapRef, () => setHov(null));

  return (
    <div ref={wrapRef} className="treemap" style={{ height: H }} role="img" aria-label="Gráfico em blocos da alocação do patrimônio">
      {blocos.map((b, i) => {
        const menor    = Math.min(b.w, b.h);
        const dim      = hov && hov !== b.sufixo;
        const pctTxt   = b.pct.toFixed(1).replace(".", ",");
        const L        = layoutBlocoTreemap(b, pctTxt, telaPequena);
        const estiloIn = { background: b.cor, borderRadius: `min(var(--radius-subcard), ${menor / 3.5}px)`, padding: `${L.padY}px ${L.padX}px` };
        if (L.modo === "linha")  Object.assign(estiloIn, { flexDirection: "row", alignItems: "center", gap: 8 });
        if (L.modo === "so-pct") Object.assign(estiloIn, { alignItems: "center", justifyContent: "center" });
        return (
          <div
            key={b.sufixo}
            className="treemap-bloco"
            style={{ left: b.x, top: b.y, width: b.w, height: b.h, opacity: dim ? 0.45 : 1, animationDelay: `${i * 60}ms` }}
            onPointerDown={e => { tipoPonteiro.current = e.pointerType; }}
            onPointerEnter={e => { if (e.pointerType === "mouse") aoMover(e, b.sufixo); }}
            onPointerMove={e => { if (e.pointerType === "mouse") aoMover(e, b.sufixo); }}
            onPointerLeave={e => { if (e.pointerType === "mouse") setHov(null); }}
            onClick={() => {
              // toque: abre o tooltip do bloco; tocar de novo no mesmo bloco fecha
              if (tipoPonteiro.current !== "mouse") setHov(h => (h === b.sufixo ? null : b.sufixo));
            }}
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
              top: "50%",
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
                  <div className="tt-titulo">{bHov.titulo}</div>

                  <div className="tt-valor">{pc(bHov.pct)}%</div>

                  <div className="tt-bloco">
                    <div className="tt-linha">
                      <span className="tt-rotulo">Meta</span>
                      <span className="tt-dado">{pc(bHov.ideal)}%</span>
                    </div>
                    <div className="tt-linha">
                      <span className="tt-rotulo">{statusTxt}</span>
                      <span className={`tt-dado ${cls(dif)}`}>{sinalCompleto(dif)}{pc(Math.abs(dif))}%</span>
                    </div>
                    {bHov.temAportado && (
                      <div className="tt-linha">
                        <span className="tt-rotulo">Variação</span>
                        <span className={`tt-dado ${cls(bHov.variacao)}`}>
                          {sinalCompleto(bHov.variacaoPct)}{pc(Math.abs(bHov.variacaoPct))}%
                        </span>
                      </div>
                    )}
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

function CardClassesAtivos({ totais, reservas, alocacao, onEditar }) {
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
    <Card className="widget-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <h2 className="card-titulo">Alocação</h2>
        {onEditar && (
          <button className="btn-tema" onClick={onEditar} aria-label="Editar metas de alocação" title="Editar metas de alocação">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
            </svg>
          </button>
        )}
      </div>

      <div className="bolhas-wrap">
        <GraficoTreemap dados={dados} />
      </div>

    </Card>
  );
}

const BRASIL_EXTERIOR_COR = { brasil: "#0a5550", exterior: "#16b8ae" };

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
    <Card className="widget-card">
      <h2 className="card-titulo">Brasil x Exterior</h2>

      {/* barra de proporção: dois segmentos separados por um respiro, cada um na sua cor */}
      <div style={{ display: "flex", gap: 4, width: "100%", height: 10 }}>
        {dados.filter(d => d.pct > 0).map(d => (
          <div
            key={d.titulo}
            style={{ flex: `${d.pct} 1 0`, minWidth: 0, borderRadius: 999, background: d.cor, transition: "flex-grow 0.3s ease" }}
            title={`${d.titulo}: ${d.pct.toFixed(1)}%`}
          />
        ))}
      </div>

      {/* um cartão por lado, com a mesma estrutura: cor, nome, valor e porcentagem */}
      <StatGrid>
        {dados.map(d => (
          <SubCard className="stat-card" key={d.titulo}>
            <span className="campo-titulo" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: d.cor, flexShrink: 0 }} />
              {d.titulo}
            </span>
            <div className="stat-linha" style={{ alignItems: "center" }}>
              <span className="stat-valor">{fmtBRL(d.valor)}</span>
              <span className="stat-badge">{d.pct.toFixed(1)}%</span>
            </div>
          </SubCard>
        ))}
      </StatGrid>
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
    <Card className="widget-card">
      <h2 className="card-titulo">Aporte</h2>

      {classePrio && (
        <StatGrid>
          <StatCard
            label="Classe prioritária"
            value={classePrio.nome}
            extra={`-${classePrio.diff.toFixed(1)}%`}
            extraColor={COR_BAIXA}
          />
          {[ativo1Obj, ativo2Obj].map((at, i) => {
            if (!at) return null;
            const m = montarMetricasAtivo(at, true).metricas;
            const falt = m[m.length - 1];
            return (
              <StatCard
                key={at.ticker}
                label={`Ativo prioritário ${i + 1}`}
                value={String(at.ticker).toUpperCase()}
                extra={falt.valor}
                extraColor={falt.cor || undefined}
                sub={at.nome}
                logo={<LogoAtivo ticker={at.ticker} size={40} />}
              />
            );
          })}
        </StatGrid>
      )}
    </Card>
  );
}

function GraficoProventos({ porAno, centro = null, setTip = null }) {
  const [hovIdx, setHovIdx] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);
  // tipo do último ponteiro (mouse/touch/pen): mouse usa hover, toque usa toque na barra
  const tipoPonteiro = useRef("mouse");
  // toque/clique fora do gráfico fecha o tooltip
  useCliqueFora(containerRef, () => setHovIdx(null));
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
              onPointerDown={e => { tipoPonteiro.current = e.pointerType; }}
              onPointerEnter={e => { if (e.pointerType === "mouse") setHovIdx(i); }}
              onPointerLeave={e => { if (e.pointerType === "mouse") setHovIdx(null); }}
              onClick={() => {
                // toque: abre o tooltip da barra; tocar de novo na mesma barra fecha
                if (tipoPonteiro.current !== "mouse") setHovIdx(h => (h === i ? null : i));
              }}
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

  if (!proventos?.length) {
    return (
      <Card className="widget-card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
          <h2 className="card-titulo">Proventos</h2>
          {onEditar && (
            <button className="btn-tema" onClick={onEditar} aria-label="Editar proventos" title="Editar proventos">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
              </svg>
            </button>
          )}
        </div>
      </Card>
    );
  }

  const totalRecebido = porAnoCompleto.reduce((s, r) => s + r.valor, 0);
  const anosDecorridosProventos = porAnoCompleto.length > 1
    ? parseInt(porAnoCompleto[porAnoCompleto.length - 1].ano, 10) - parseInt(porAnoCompleto[0].ano, 10)
    : 0;
  const mediaAnualProventos = anosDecorridosProventos > 0
    ? totalRecebido / anosDecorridosProventos
    : 0;
  const porAno = porAnoCompleto;

  return (
    <Card className="widget-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <h2 className="card-titulo">Proventos</h2>
        {onEditar && (
          <button className="btn-tema" onClick={onEditar} aria-label="Editar proventos" title="Editar proventos">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
            </svg>
          </button>
        )}
      </div>

      <div className="sem-card-bloco">
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
      </div>
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

function CardVariacaoDia({ ativos, totais }) {
  const [abaClasse, setAbaClasse] = useState(null);
  const totalHoje = toFloat(totais?.[0]?.total_patrimonio);
  const comOntem = (ativos ?? []).filter(a => a.tem_ontem && toFloat(a.total_atual) > 0);

  if (!comOntem.length) {
    return (
      <Card className="widget-card">
        <h2 className="card-titulo">Variação do dia</h2>
        <div className="lista-anos-vazio">
          Adicione a coluna cotacao_ontem na planilha de cotações para ver a variação do dia.
        </div>
      </Card>
    );
  }

  // variação do patrimônio = soma da variação dos ativos (a reserva não oscila no dia)
  const variacaoDia = (ativos ?? []).reduce((s, a) => s + toFloat(a.variacao_dia), 0);
  // ontem = hoje - valor atual dos ativos + valor de ontem dos mesmos ativos (reserva e ativos sem ontem não mudam)
  const totalOntem = totalHoje
    - (ativos ?? []).reduce((s, a) => s + toFloat(a.total_atual), 0)
    + (ativos ?? []).reduce((s, a) => s + toFloat(a.total_ontem), 0);
  const pctDia = totalOntem > 0 ? (variacaoDia / totalOntem) * 100 : 0;
  const cor = corVar(variacaoDia);
  const fmtPct = (v) => `${sinalCompleto(v)}${Math.abs(v).toFixed(2).replace(".", ",")}%`;

  // variação do dia de cada classe (ponderada pelo valor de ontem)
  const porClasse = CLASSES_ATIVOS
    .map(c => {
      const doClasse = comOntem.filter(a => a.classe === c.classe);
      if (!doClasse.length) return null;
      const varR = doClasse.reduce((sum, a) => sum + a.variacao_dia, 0);
      const ontemClasse = doClasse.reduce((sum, a) => sum + a.total_ontem, 0);
      return { titulo: c.titulo, varR, pct: ontemClasse > 0 ? (varR / ontemClasse) * 100 : 0 };
    })
    .filter(Boolean)
    .sort((a, b) => b.pct - a.pct);
  const melhorClasse = porClasse[0];
  const piorClasse = porClasse.length > 1 ? porClasse[porClasse.length - 1] : null;
  const cardClasse = (rotulo, c) => (
    <StatCard
      label={rotulo}
      value={c.titulo}
      extra={fmtPct(c.pct)}
      extraColor={corVar(c.pct)}
      sub={`${sinalCompleto(c.varR)}${fmtBRL(Math.abs(c.varR))}`}
    />
  );

  // abas por classe (só as que têm ativos com cotação de ontem)
  const abas = CLASSES_ATIVOS
    .filter(c => comOntem.some(a => a.classe === c.classe))
    .map(c => ({ id: c.classe, titulo: c.titulo }));
  const abaAtiva = abas.some(a => a.id === abaClasse) ? abaClasse : abas[0]?.id;

  // da maior valorização para a maior queda (em %)
  const lista = comOntem
    .filter(a => a.classe === abaAtiva)
    .sort((a, b) => b.variacao_dia_pct - a.variacao_dia_pct);

  return (
    <Card className="widget-card">
      <h2 className="card-titulo">Variação do dia</h2>

      <StatGrid>
        <StatCard
          label="Patrimônio hoje"
          value={`${sinalCompleto(variacaoDia)}${fmtBRL(Math.abs(variacaoDia))}`}
          color={cor}
          extra={fmtPct(pctDia)}
        />
        <StatCard label="Patrimônio ontem" value={fmtBRL(totalOntem)} />
        {melhorClasse && cardClasse("Classe que mais valorizou", melhorClasse)}
        {piorClasse && cardClasse("Classe que menos valorizou", piorClasse)}
      </StatGrid>

      {abas.length > 0 && (
        <div className="abas-ativos abas-classes">
          <div className="navbar-tabs" role="tablist" aria-label="Classes de ativos">
            {abas.map(a => (
              <button
                key={a.id}
                role="tab"
                aria-selected={abaAtiva === a.id}
                className={`navbar-tab${abaAtiva === a.id ? " navbar-tab-ativo" : ""}`}
                onClick={() => setAbaClasse(a.id)}
              >
                {a.titulo}
              </button>
            ))}
          </div>
        </div>
      )}

      <StatGrid fixo>
        {lista.map(a => (
          <StatCard
            key={a.ticker}
            label={String(a.ticker).toUpperCase()}
            value={`${sinalCompleto(a.variacao_dia)}${fmtBRL(Math.abs(a.variacao_dia))}`}
            color={corVar(a.variacao_dia_pct)}
            extra={fmtPct(a.variacao_dia_pct)}
            logo={<LogoAtivo ticker={a.ticker} size={40} />}
          />
        ))}
      </StatGrid>
    </Card>
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
    <Card className="widget-card">
      <div className="card-header">
        <h2 className="card-titulo">Mapa de ativos</h2>
        {temMais && (
          <BotaoVer onClick={() => setOpen(o => !o)} open={open} />
        )}
      </div>
      <div className="sem-card-bloco">
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
      </div>
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

  if (titulo) {
    return (
      <div className="sem-card-bloco" style={{ gap: "var(--space-3)" }}>
        <div className="list-row list-row-plain" style={{ padding: 0 }}>
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
        <StatGrid>
          {metricas.map((m) => (
            <StatCard key={m.titulo} label={m.titulo} value={m.valor} color={m.cor || undefined} />
          ))}
        </StatGrid>
      </div>
    );
  }

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
          <div className="ativo-cabecalho" style={{
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
  const [sortBy, setSortBy]           = useState("nome");
  const [sortDir, setSortDir]         = useState("asc");
  const [highlightTicker, setHighlightTicker] = useState(null);

  useEffect(() => {
    if (!selectedTicker || !searchVersion) return;
    const pertenceAessa = (ativos ?? []).some(a =>
      String(a.ticker) === selectedTicker &&
      String(a.classe).toLowerCase().trim() === classe
    );
    if (!pertenceAessa) { setHighlightTicker(null); return; }

    const jaAberto = true;
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
    <>
    <Card className="widget-card">
      <div className="card-header">
        <h2 className="card-titulo">{titulo}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <button className="btn-tema" onClick={() => onAdicionarAtivo(classe)} aria-label={`Adicionar ${titulo}`} title={`Adicionar ${titulo}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      <StatGrid>
        <StatCard label="Atual" value={fmtBRL(total)} />
        <StatCard label="Aportado" value={fmtBRL(aportado)} />
        <StatCard
          label="Variação"
          value={`${sinalCompleto(diff)}${fmtBRL(Math.abs(diff))}`}
          extra={`${pctVariacao.toFixed(1)}%`}
          color={corDiff}
        />
      </StatGrid>
    </Card>

    <Card className="widget-card">
      <div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>

          <div className="abas-ativos abas-classes">
            <div className="navbar-tabs" role="group" aria-label="Ordenar ativos">
              {FILTROS.map(f => (
                <button
                  key={f.key}
                  className={`navbar-tab${sortBy === f.key ? " navbar-tab-ativo" : ""}`}
                  aria-pressed={sortBy === f.key}
                  onClick={() => handleSort(f.key)}
                >
                  <span className="lbl-full">{f.texto}</span>
                  <span className="lbl-curto">{f.curto}</span>
                  {sortBy === f.key && <span className="sort-seta" aria-hidden="true">{sortDir === "asc" ? "↑" : "↓"}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="ativos-lista">
            {df.map((at, i) => <CardAtivo key={i} ativo={at} highlight={at.ticker === highlightTicker} sortBy={sortBy} onEditar={onEditarAtivo} />)}
          </div>
        </div>
      </div>
    </Card>
    </>
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
    <Card className="widget-card">
      <h2 className="card-titulo">Finanças</h2>

      <StatGrid>
        <StatCard label="Total líquido" value={`${sinalCompleto(totais.net)}${fmtBRL(Math.abs(totais.net))}`} color={corNet} />
        <StatCard label="Receitas totais" value={`+${fmtBRL(totais.income)}`} color={COR_ALTA} />
        <StatCard label="Despesas totais" value={`-${fmtBRL(totais.expense)}`} color={COR_BAIXA} />
      </StatGrid>

    </Card>
  );
}

function GraficoMetaGastos({ pct, cor }) {
  const [anim, setAnim] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnim(Math.min(Math.max(pct, 0), 100)), 60);
    return () => clearTimeout(t);
  }, [pct]);
  return (
    <div className="meta-linha" role="img" aria-label={`${pct.toFixed(0)}% da meta de gastos utilizada`}>
      <div className="meta-linha-topo">
        <span className="meta-linha-pct">{pct.toFixed(0)}%</span>
        <span className="meta-linha-sub">da meta utilizada</span>
      </div>
      <div className="meta-linha-trilho">
        <div
          className="meta-linha-fill"
          style={{ width: `${anim}%`, background: cor, boxShadow: `0 0 8px ${cor}66` }}
        />
      </div>
    </div>
  );
}

function CardMetaGastos({ meta, gasto, onEditar }) {
  const restante = meta - gasto;
  const excedeu  = meta > 0 && gasto > meta;
  const pct      = meta > 0 ? (gasto / meta) * 100 : 0;
  const corGauge = excedeu ? "#c0504a" : pct >= 80 ? "#d9a441" : "#13a097";

  return (
    <Card className="widget-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <h2 className="card-titulo">Meta de gastos</h2>
        {onEditar && (
          <button className="btn-tema" onClick={onEditar} aria-label="Editar meta de gastos" title="Editar meta de gastos">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
            </svg>
          </button>
        )}
      </div>

      {meta > 0 ? (
        <>
          <GraficoMetaGastos pct={pct} cor={corGauge} />

          <StatGrid>
            <StatCard label="Meta" value={fmtBRL(meta)} />
            <StatCard label="Já gasto esse mês" value={`-${fmtBRL(gasto)}`} color={excedeu ? COR_BAIXA : undefined} />
            <StatCard
              label={excedeu ? "Ultrapassou em" : "Ainda pode gastar"}
              value={`${sinalCompleto(restante)}${fmtBRL(Math.abs(restante))}`}
              color={excedeu ? COR_BAIXA : COR_ALTA}
            />
          </StatGrid>
        </>
      ) : (
        <div className="sem-card-bloco" style={{ gap: "var(--space-2)" }}>
          <div className="campo-titulo">Nenhuma meta definida</div>
          <div className="campo-titulo">
            Defina um limite mensal no botão de editar para acompanhar seus gastos.
          </div>
        </div>
      )}
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
    <Card className="widget-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <h2 className="card-titulo">Receitas</h2>
        <button className="btn-tema" onClick={() => onAdicionar("income")} aria-label="Adicionar receita" title="Adicionar receita">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {receitas.length === 0 ? (
        <div className="campo-titulo">Nenhuma receita cadastrada ainda.</div>
      ) : (
        <div className="sem-card-bloco">
          <div className="lista-lancamentos">
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
        </div>
      )}
    </Card>
  );
}

function CardFinancasMeta({ lancamentos, onEditarLancamento, onExcluirLancamento, onAdicionar }) {
  const despesas = lancamentos.filter(t => t.type === "expense");

  return (
    <Card className="widget-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <h2 className="card-titulo">Despesas</h2>
        <button className="btn-tema" onClick={() => onAdicionar("expense")} aria-label="Adicionar despesa" title="Adicionar despesa">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {despesas.length === 0 ? (
        <div className="campo-titulo">Nenhuma despesa cadastrada ainda.</div>
      ) : (
        <div className="sem-card-bloco">
          <div className="lista-lancamentos">
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
        </div>
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

function PaginaFinancas({ lancamentos, setLancamentos, metaDespesa, setMetaDespesa, onEditarMetaDespesa }, ref) {
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
        <CardMetaGastos meta={metaDespesa} gasto={totais.expense} onEditar={onEditarMetaDespesa} />
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

function PaginaConfiguracoes({ tema, onAlternarTema }) {
  return (
    <>
      <div id="sec-configuracoes-aparencia">
      <Card className="widget-card">
        <h2 className="card-titulo">Aparência</h2>

        <div className="sem-card-bloco">
          <div className="list-row list-row-plain">
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
        </div>
      </Card>
      </div>
    </>
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
  const [abaAtivos, setAbaAtivos] = useState(ABAS_ATIVOS[0].id);
  const [pagina, setPagina]         = useState("patrimonio");
  const [lancamentos, setLancamentos] = useState([]);
  const [metaDespesa, setMetaDespesa] = useState(0);
  const scrollRef = useRef(null);
  const financasRef = useRef(null);
  const nuvemOkRef = useRef(false);

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
          carregarPlanilha().catch(() => ({ ativos: [] })),
          carregarLancamentos(),
          carregarDadosLocaisNuvem(),
        ]);
        const baseLocal = normalizarDadosLocais(
          dadosNuvem && Object.keys(dadosNuvem).length > 0 ? dadosNuvem : carregarDadosLocais()
        );
        const linhasCotacao = await carregarCotacoes(baseLocal.ativos, planilha.ativos);
        if (linhasCotacao.length === 0) throw new Error("Não foi possível carregar as cotações.");
        setDadosPlanilha({ ...planilha, ativos: linhasCotacao });
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
        const baseLocal = normalizarDadosLocais(
          dadosNuvem && Object.keys(dadosNuvem).length > 0 ? dadosNuvem : carregarDadosLocais()
        );
        const linhasCotacao = await carregarCotacoes(baseLocal.ativos, planilha?.ativos ?? []).catch(() => []);
        if (linhasCotacao.length > 0) setDadosPlanilha({ ...(planilha ?? {}), ativos: linhasCotacao });
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

  return (
    <>
      <Style />
      <div className="root" ref={scrollRef} onScroll={handleScroll}>
        <Navbar
          scrolled={scrolled}
          ativos={ativos}
          onSelectTicker={(ticker) => {
            if (pagina !== "ativos") irParaPagina("ativos");
            const classeDoAtivo = String(ativos.find(a => String(a.ticker) === String(ticker))?.classe ?? "").toLowerCase().trim();
            if (ABAS_ATIVOS.some(a => a.id === classeDoAtivo)) setAbaAtivos(classeDoAtivo);
            setSearchCmd({ ticker, v: Date.now() });
          }}
          pagina={pagina}
          onNavigate={irParaPagina}
          tema={tema}
        />
        <BotaoTopoFlutuante scrolled={scrolled} onTop={scrollToTop} />
        <main className="main">

          {pagina === "patrimonio" && (
            <>
              <div id="sec-patrimonio"><CardPatrimonio totais={totais} evolucao={dadosLocais.evolucao} onEditarEvolucao={abrirEdicaoEvolucao} /></div>
              <div id="sec-projecao"><CardProjecaoPatrimonio totais={totais} rentabilidade={dadosLocais.rentabilidade} evolucao={dadosLocais.evolucao} /></div>
            </>
          )}

          {pagina === "alocacao" && (
            <>
              <div id="sec-alocacao"><CardClassesAtivos totais={totais} reservas={reservas} alocacao={alocacao} onEditar={abrirEdicaoMetas} /></div>
              <div id="sec-brasil-exterior"><CardBrasilExterior alocacao={alocacao} totais={totais} /></div>
              <div id="sec-aporte"><CardAporte ativos={ativos} alocacao={alocacao} /></div>
            </>
          )}

          {pagina === "ativos" && (
            <>
              <AbasAtivos abas={ABAS_ATIVOS} valor={abaAtivos} onChange={(id) => { setAbaAtivos(id); setSearchCmd(null); }} />
              <div className="ativos-deck">
              {abaAtivos === "reserva" ? (
                <div id="sec-reserva"><CardReserva reservas={reservas} alocacao={alocacao} totais={totais} onEditar={abrirEdicaoReserva} /></div>
              ) : (
                CLASSES_ATIVOS.filter(c => c.classe === abaAtivos).map(c => (
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
                ))
              )}
              </div>
            </>
          )}

          {pagina === "retornos" && (
            <>
              <div id="sec-variacao-dia"><CardVariacaoDia ativos={ativos} totais={totais} /></div>
              <div id="sec-rentabilidade"><CardRentabilidade rentabilidade={dadosLocais.rentabilidade} onEditarRentabilidade={abrirEdicaoRentabilidade} /></div>
              <div id="sec-proventos"><CardProventos proventos={dadosLocais.proventos} onEditar={abrirEdicaoProventos} /></div>
              <div id="sec-heatmap">
                <CardHeatmap ativos={ativos} />
              </div>
            </>
          )}

          {pagina === "financas" && (
            <PaginaFinancas
              ref={financasRef}
              lancamentos={lancamentos}
              setLancamentos={setLancamentos}
              metaDespesa={metaDespesa}
              setMetaDespesa={setMetaDespesa}
              onEditarMetaDespesa={abrirEdicaoMetaDespesa}
            />
          )}

          {pagina === "configuracoes" && (
            <PaginaConfiguracoes
              tema={tema}
              onAlternarTema={alternarTema}
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

            .abas-ativos-mobile { display: none; width: 100%; }
            .abas-ativos { display: flex; max-width: 100%; }
      .abas-ativos .navbar-tabs { max-width: 100%; }
      .lbl-curto, .sort-seta { display: none; }
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
        .navbar .navbar-tabs { display: none; } /* só as abas de páginas da barra viram menu; as abas dos ativos continuam */
        /* abas das classes de ativos e ordenação: seletor suspenso no lugar das abas */
        .abas-ativos-desktop { display: none; }
        .abas-ativos-mobile { display: flex; }
        /* abas das classes (Variação do dia): ocupam a largura toda e dividem o espaço igualmente, sem rolagem */
        .abas-classes { width: 100%; }
        .abas-classes .navbar-tabs { width: 100%; overflow: hidden; gap: 2px; padding: 4px; box-sizing: border-box; }
        /* largura proporcional ao texto: palavras longas (Bitcoins, Reserva) ganham mais espaço, e a aba ativa não "aperta" as vizinhas */
        .abas-classes .navbar-tab { flex: 1 1 auto; min-width: 0; padding: 9px clamp(5px, 1.8vw, 10px); font-size: clamp(11.5px, 3.3vw, 13.5px); text-align: center; letter-spacing: -0.01em; }
        .abas-classes .navbar-tab:active { transform: scale(0.96); }
        .abas-classes .lbl-full { display: none; }
        .abas-classes .lbl-curto { display: inline; }
        .abas-classes .sort-seta { margin-left: 3px; font-size: 0.9em; }
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
        --gap-main: var(--space-8);
        gap: var(--gap-main);
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

      .meta-linha { width: 100%; display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-2) 0; }
      .meta-linha-topo { display: flex; align-items: baseline; justify-content: flex-start; gap: var(--space-2); }
      .meta-linha-pct { font-size: 34px; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--color-value); line-height: 1; }
      .meta-linha-sub { font-size: 14px; font-weight: 500; color: var(--color-value); }
      .meta-linha-trilho { width: 100%; height: 8px; border-radius: 999px; background: var(--bar-track); overflow: hidden; }
      .meta-linha-fill { height: 100%; border-radius: 999px; transition: width 0.8s cubic-bezier(0.4,0,0.2,1), background 0.3s ease; }
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
        /* sem padding inferior: o respiro de baixo vem só do card (igual aos lados) */
        padding: var(--space-2) 0 0;
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
      @media (hover: hover) { .treemap-bloco:hover .treemap-bloco-in { filter: brightness(1.18); } }
      .treemap-titulo { font-weight: 700; line-height: 1.25; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.92; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
      .treemap-num { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .treemap-pct { font-weight: 800; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; white-space: nowrap; flex-shrink: 0; }
      .treemap-valor { font-size: 12px; font-weight: 600; opacity: 0.85; white-space: nowrap; font-variant-numeric: tabular-nums; }
      /* ===== Tooltips dos gráficos: minimalistas ===== */
      .tt-card.treemap-tip { position: absolute; z-index: 10; pointer-events: none; white-space: nowrap; min-width: 190px; }
      .tt-card {
        --tt-pos: #16b8ae; --tt-neg: #e0857d;
        min-width: 150px;
        padding: 10px 13px;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.35);
        display: flex; flex-direction: column; gap: 6px;
        white-space: nowrap;
      }
      :root[data-theme="light"] .tt-card { --tt-pos: #063d3a; --tt-neg: #4f1f1f; box-shadow: 0 8px 22px rgba(16,32,29,0.13); }
      .tt-card .tt-pos { color: var(--tt-pos); font-weight: 700; }
      .tt-card .tt-neg { color: var(--tt-neg); font-weight: 700; }
      .tt-card .tt-neu { color: var(--color-label); }
      .tt-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
      .tt-titulo { font-size: 11px; font-weight: 500; color: var(--color-label); }
      .tt-pilula { font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
      .tt-valor { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.15; color: var(--color-value); font-variant-numeric: tabular-nums; }
      .tt-bloco { display: flex; flex-direction: column; gap: 2px; }
      .tt-linha { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; font-size: 11px; }
      .tt-rotulo { color: var(--color-label); font-weight: 400; }
      .tt-dado { color: var(--color-value); font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
      .tt-barra { position: relative; height: 3px; border-radius: 999px; background: var(--bar-track); margin-top: 4px; }
      .tt-barra-fill { height: 100%; border-radius: 999px; background: var(--tt-pos); transition: width 0.3s ease; }
      .tt-barra-meta { position: absolute; top: -2px; width: 2px; height: 7px; border-radius: 1px; background: var(--text); opacity: 0.55; transform: translateX(-1px); }
      @media (max-width: 640px) {
        .tt-card.chart-tooltip { padding: 8px 10px; gap: 5px; border-radius: 10px; min-width: 124px; }
        .tt-card.treemap-tip { min-width: 164px; }
        .tt-card .tt-valor { font-size: 15px; }
        .tt-card .tt-linha { font-size: 10px; gap: 10px; }
        .tt-card .tt-titulo, .tt-card .tt-pilula { font-size: 10px; }
      }
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
        .main { padding: 106px 18px 52px; --gap-main: 22px; gap: var(--gap-main); }
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
        .main { padding: 96px var(--space-3) 40px; --gap-main: var(--space-4); gap: var(--gap-main); }

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
        .main { padding: 105px 10px 34px; --gap-main: var(--space-4); gap: var(--gap-main); }
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
        .main    { padding: 78px var(--space-2) var(--space-7); --gap-main: 10px; gap: var(--gap-main); }
        .card    { padding: 11px !important; gap: var(--space-2); }
        .subcard { padding: 8px !important; gap: 6px; }
        .list-row { --row-pad-x: var(--space-3); }
        .list-row-plain { --row-pad-x: 0px; }
        .subcard-titulo { padding: var(--space-1) var(--space-2) !important; }
        .campo-valor  { font-size: 17px; }
        .card-titulo  { font-size: 14px; }
      }

      /* ===== Conteúdo da classe de ativos selecionada ===== */
      .ativos-deck, .ativos-deck > div { display: flex; flex-direction: column; gap: var(--gap-main, var(--space-8)); }

      .card.widget-card { gap: var(--space-4) !important; }
      .sem-card-bloco { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
      /* última linha sem padding inferior: o respiro de baixo vem só do padding do card */
      .lista-lancamentos > .list-row:last-child { padding-bottom: 0; }
      .stat-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        gap: var(--space-4) var(--space-3);
      }
      .stat-grid.stat-grid-fixo { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
      .stat-card { gap: var(--space-2) !important; min-width: 0; justify-content: center; }
      .stat-linha { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--space-2); min-width: 0; }
      .stat-item { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
      .stat-valor {
        font-size: 22px;
        font-weight: 800;
        letter-spacing: -0.02em;
        line-height: 1.1;
        color: var(--color-value);
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
      }
      .stat-sub { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
      .stat-badge {
        padding: 3px 9px;
        border-radius: var(--radius-pill);
        font-size: 12px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        background: rgba(19, 160, 151, 0.16);
        color: #16b8ae;
      }
      .stat-badge-neg { background: rgba(192, 80, 74, 0.16); color: #e0857d; }
      :root[data-theme="light"] .stat-badge { background: rgba(10, 85, 80, 0.12); color: #0a5550; }
      :root[data-theme="light"] .stat-badge-neg { background: rgba(138, 53, 53, 0.12); color: #8a3535; }
      @media (max-width: 640px) {
        .stat-grid, .stat-grid.stat-grid-fixo { grid-template-columns: minmax(0, 1fr); grid-auto-rows: 1fr; }
        .subcard.stat-card { padding-top: 22px !important; padding-bottom: 22px !important; }
        .stat-valor { font-size: 20px; }
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
        .navbar .navbar-right .navbar-config-btn svg { width: 22px; height: 22px; }
        .navbar .navbar-right .btn-tema:not(.navbar-config-btn) svg { width: 18px; height: 18px; }
      }
      @media (max-width: 640px) {
        .config-tema-btn { padding: 6px 14px; font-size: 13px; }
      }

      /* caixas de texto: sem borda verde, só um brilho suave ao passar o mouse e ao clicar */
      .navbar .navbar-search-inline { --brilho: 255, 255, 255; }
      :root[data-theme="light"] .navbar .navbar-search-inline { --brilho: 9, 30, 27; }
      .navbar .navbar-search-inline:hover{
        box-shadow: 0 0 14px rgba(var(--brilho), 0.07);
      }
      .navbar .navbar-search-inline:focus-within{
        box-shadow: 0 0 18px rgba(var(--brilho), 0.12);
      }
      .navbar .navbar-search-inline{ transition: box-shadow 0.2s ease; }

      @media (max-width: 640px) { /* 16px evita o zoom automático ao focar no celular */
      }
    `}</style>
  );
}