// ======================================================================
// direito.love — app.js  (SINALIZAÇÃO EM BLOCOS • 1 arquivo)
// Apenas COMENTÁRIOS. Código intacto.
// Tabela rápida de blocos (use CTRL+F):
//   [BLK00] BOOT (Service Worker, bootstrap)
//   [BLK01] DOM REFS (els, $, $$)
//   [BLK02] CONSTANTES & STATE (KEY, state)
//   [BLK03] TEXT (helpers, normalize, tokenize, query-mode)
//   [BLK04] NUM (artigos, janelas, correspondência numérica)
//   [BLK05] SCORE (ranking dos resultados)
//   [BLK06] PARSE (splitBlocks, parseBlock, forEachBlock)
//   [BLK07] DATA (catálogo, toRawGitHub, fetch+cache)
//   [BLK08] SEARCH (predicados, preview, expand, doSearch)
//   [BLK09] HIGHLIGHT (applyHighlights e afins)
//   [BLK10] RENDER • Cards
//   [BLK11] RENDER • Buckets & Results
//   [BLK12] UI • Seleção & Hub & Toasts
//   [BLK13] MODALS • Leitor
//   [BLK14] INIT • Autoexec, binds, ?q=, histórico
// ======================================================================

/* ==========================
   direito.love — app.js (2025-09 • estável + patches PRO)
   Regras:
   1) Cada card = bloco entre linhas "-----"
   2) Texto preservado como no .txt (parênteses incluídos)
   3) "Respiros" (linhas em branco) apenas na visualização do leitor
   ========================== */


//#region [BLK00] BOOT • Service Worker & bootstrap
/* Service Worker (opcional) */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}


//#region [BLK03] TEXT • Helpers/Normalize/Tokenize
/* ---------- helpers ---------- */
//#region [BLK01] DOM REFS • Seletores e elementos
const $ = (s) => document.querySelector(s);

const els = {
  /* topo/busca */
  form: $("#searchForm"),
  q: $("#searchInput"),
  spinner: $("#searchSpinner"),
  stack: $("#resultsStack"),
  brand: $("#brandBtn"),
  codeSelect: $("#codeSelect"),

  /* barra inferior */
  viewBtn: $("#viewBtn"),

  //#region [BLK13] MODALS • Leitor (abrir/fechar)
/* leitor */
  readerModal: $("#readerModal"),
  readerBody: $("#readerBody"),
  readerTitle: $("#readerTitle"),
  selCount: $("#selCount"),

  /* selecionados */
  //#region [BLK12] UI • Seleção, Hub, Toasts
selectedModal: $("#selectedModal"),
  selectedStack: $("#selectedStack"),

  /* toasts */
  toasts: $("#toasts"),
};

// ===== HIGHLIGHT HELPERS =====
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Gera tokens a partir do termo digitado (remove curtos e duplicados)
function buildTokens(q) {
  return (q || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(t => t && t.length >= 2)
    .filter((t, i, a) => a.indexOf(t) === i);
}

// NOVA VERSÃO — applyHighlights: suporta "frases exatas" e termos; evita links/botões; acento-insensível
function applyHighlights(rootEl, tokens) {
  if (!rootEl || !tokens || tokens.length === 0) return;

  // Backward-compat: tokens pode ser ["termo", ...] ou [{type:"phrase"|"term", value:"..."}, ...]
  const normToken = (t) => {
    if (!t) return null;
    if (typeof t === "string") return { type: t.trim().includes(" ") ? "phrase" : "term", value: t.trim() };
    if (typeof t.value === "string") return { type: (t.type === "phrase" ? "phrase" : "term"), value: t.value.trim() };
    return null;
  };

  const list = tokens.map(normToken).filter(Boolean);
  if (list.length === 0) return;

  // Constrói regex acento-insensível por caractere (NFD + \p{M}*)
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const toDia = (s) => esc(s).replace(/\p{L}/gu, (ch) => ch + "\\p{M}*");

  const phrases = list.filter(t => t.type === "phrase" && t.value.length > 1).map(t => toDia(t.value));
  const terms   = list.filter(t => t.type !== "phrase").map(t => toDia(t.value)).filter(Boolean);

  // Regex: frases primeiro (prioridade), depois termos por borda de palavra
  const rxPhrase = phrases.length ? new RegExp("(" + phrases.join("|") + ")", "giu") : null;
  const rxTerm   = terms.length   ? new RegExp("\\b(" + terms.join("|") + ")\\b", "giu") : null;

  // Evitar remarcar e pular elementos interativos
  const isSkippableParent = (el) => {
    if (!el) return false;
    if (el.closest("mark.hl, a, button, input, textarea, code, pre")) return true;
    if (el.closest("[contenteditable=true], [role=button], [role=link]")) return true;
    return false;
  };

  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const txt = node.nodeValue;
      if (!txt || !txt.trim()) return NodeFilter.FILTER_REJECT;
      if (isSkippableParent(node.parentElement)) return NodeFilter.FILTER_REJECT;
      const nfd = txt.normalize("NFD");
      if (rxPhrase && rxPhrase.test(nfd)) return NodeFilter.FILTER_ACCEPT;
      if (rxTerm   && rxTerm.test(nfd))   return NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_REJECT;
    }
  });

  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  nodes.forEach(node => {
    const nfd = node.nodeValue.normalize("NFD");
    let frag = document.createDocumentFragment();

    // 1) marca frases exatas
    const process = (sourceText, rx, className) => {
      if (!rx) return { parent: null, leftover: sourceText };
      const parts = sourceText.split(rx);
      const df = document.createDocumentFragment();
      for (let i = 0; i < parts.length; i++) {
        const piece = parts[i];
        if (!piece) continue;
        const out = piece.normalize("NFC");
        if (i % 2 === 1) {
          const mark = document.createElement("mark");
          mark.className = "hl " + className; // "hl hl-phrase" ou "hl hl-term"
          mark.textContent = out;
          df.appendChild(mark);
        } else {
          df.appendChild(document.createTextNode(out));
        }
      }
      return { parent: df, leftover: null };
    };

    // Aplica frases
    let tmp = nfd;
    if (rxPhrase) {
      const res = process(tmp, rxPhrase, "hl-phrase");
      if (res.parent) {
        frag = res.parent;
      } else {
        frag.appendChild(document.createTextNode(tmp.normalize("NFC")));
      }
    } else {
      frag.appendChild(document.createTextNode(tmp.normalize("NFC")));
    }

    // 2) passa termos nos nós de texto remanescentes
    if (rxTerm) {
      const secondPassNodes = Array.from(frag.childNodes);
      const newFrag = document.createDocumentFragment();

      secondPassNodes.forEach(n => {
        if (n.nodeType === Node.TEXT_NODE) {
          const n2 = n.nodeValue.normalize("NFD");
          const parts = n2.split(rxTerm);
          for (let i = 0; i < parts.length; i++) {
            const piece = parts[i];
            if (!piece) continue;
            const out = piece.normalize("NFC");
            if (i % 2 === 1) {
              const mark = document.createElement("mark");
              mark.className = "hl hl-term";
              mark.textContent = out;
              newFrag.appendChild(mark);
            } else {
              newFrag.appendChild(document.createTextNode(out));
            }
          }
        } else {
          newFrag.appendChild(n);
        }
      });

      frag = newFrag;
    }

    node.parentNode.replaceChild(frag, node);
  });
}


/* ---------- estado ---------- */
const MAX_SEL = 3;
const CARD_CHAR_LIMIT = 250;
const PREV_MAX = 60;

const state = {
  selected: new Map(),     // id -> item
  cacheTxt: new Map(),     // url -> string
  cacheParsed: new Map(),  // url -> items[]
  urlToLabel: new Map(),
};


/* ---------- util ---------- */
function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  els.toasts.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}
function updateBottom() {
  const n = state.selected.size;
  if (els.viewBtn) {
    els.viewBtn.textContent = `${n}/${MAX_SEL}`;
    els.viewBtn.setAttribute("aria-label", `Selecionados: ${n} de ${MAX_SEL}`);
    els.viewBtn.style.pointerEvents = "none"; // não abre modal
  }
  if (els.selCount) els.selCount.textContent = `${n}/${MAX_SEL}`;
}
function norm(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ç/g, "c")
    .toLowerCase();
}
function escHTML(s) {
  return (s || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[m]));
}
function openExternal(url) {
  try {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (_) {
    location.href = url;
  }
}


/* ============================================================
   BUSCA — abreviações & regras
   ============================================================ */

/* Remove pontos de milhar entre dígitos (1.000 → 1000) */
function stripThousandDots(s) {
  return String(s).replace(/(?<=\d)\.(?=\d)/g, "");
}

/* ---------- CÓDIGOS: abreviações/sinônimos → rótulo do <select> ---------- */
const CODE_ABBREVS = new Map(Object.entries({
  // CF/88
  "cf": "Constituição Federal de 1988",
  "cf88": "Constituição Federal de 1988",
  "cf/88": "Constituição Federal de 1988",
  "crfb": "Constituição Federal de 1988",
  "cr/88": "Constituição Federal de 1988",
  "constituicao federal": "Constituição Federal de 1988",
  "constituicao de 1988": "Constituição Federal de 1988",

  // Código Civil
  "cc": "Código Civil",
  "codigo civil": "Código Civil",
  "cod civil": "Código Civil",

  // CPC
  "cpc": "Código de Processo Civil",
  "codigo de processo civil": "Código de Processo Civil",
  "cod proc civil": "Código de Processo Civil",
  "proc civil": "Código de Processo Civil",

  // CP
  "cp": "Código Penal",
  "codigo penal": "Código Penal",
  "cod penal": "Código Penal",

  // CPP
  "cpp": "Código de Processo Penal",
  "codigo de processo penal": "Código de Processo Penal",
  "cod proc penal": "Código de Processo Penal",
  "proc penal": "Código de Processo Penal",

  // CDC
  "cdc": "Código de Defesa do Consumidor (CDC)",
  "codigo de defesa do consumidor": "Código de Defesa do Consumidor (CDC)",
  "defesa do consumidor": "Código de Defesa do Consumidor (CDC)",

  // Código Eleitoral
  "ce": "Código Eleitoral",
  "codigo eleitoral": "Código Eleitoral",
  "cod eleitoral": "Código Eleitoral",

  // CLT
  "clt": "CLT",
  "consolidacao das leis do trabalho": "CLT",

  // CTN
  "ctn": "Código Tributário Nacional (CTN)",
  "codigo tributario nacional": "Código Tributário Nacional (CTN)",

  // CTB
  "ctb": "Código de Trânsito Brasileiro (CTB)",
  "codigo de transito brasileiro": "Código de Trânsito Brasileiro (CTB)",

  // Código Florestal
  "codigo florestal": "Código Florestal",
  "cod florestal": "Código Florestal",

  // Militares
  "cpm": "Código Penal Militar",
  "codigo penal militar": "Código Penal Militar",
  "cppm": "Código de Processo Penal Militar",
  "codigo de processo penal militar": "Código de Processo Penal Militar",

  // ECA / OAB
  "eca": "ECA",
  "estatuto da crianca e do adolescente": "ECA",
  "estatuto da oab": "Estatuto da OAB",
  "oab": "Estatuto da OAB",

  // Leis (principais)
  "lei maria da penha": "Lei Maria da Penha",
  "lmp": "Lei Maria da Penha",
  "lei da improbidade administrativa": "Lei da Improbidade Administrativa",
  "lia": "Lei da Improbidade Administrativa",
  "lei de execucao penal": "Lei de Execução Penal",
  "lep": "Lei de Execução Penal",
  "lei de drogas": "Lei de Drogas",
  "mandado de seguranca": "Mandado de Segurança",
  "lei do mandado de seguranca": "Mandado de Segurança",
}));


/* Detecta se a query contém uma dica de código (abreviação/sinônimo) */
function detectCodeFromQuery(rawQuery) {
  const q = ` ${norm(rawQuery)} `; // acolchoado para evitar falsos positivos
  for (const [abbr, label] of CODE_ABBREVS.entries()) {
    const needle = ` ${abbr} `;
    if (q.includes(needle) || q.trim() === abbr) {
      const keyWords = new Set(abbr.split(/\s+/).filter(Boolean));
      return { label, keyWords };
    }
  }
  return null;
}

/* ---------- tokenize (compatível + frases e curingas) ---------- */
// mantém retorno como array de strings
function tokenize(query) {
  const src = String(query || "");
  const q = norm(src);

  // 1) capturar frases "..." para highlight (não entram como tokens)
  const phraseRe = /"([^"]+)"/g;
  const phrases = [];
  let m;
  while ((m = phraseRe.exec(src)) !== null) {
    const p = m[1].trim();
    if (p.length >= 2) phrases.push(p);
  }
  window.__phrases = phrases; // usado no highlight via applyHighlights

  // 2) tokens básicos (números 1–4 e palavras 3+), removendo genéricos e '*' (curinga)
  const raw = q.split(/\s+/).filter(Boolean);
  const out = [];
  for (let w of raw) {
    if (/^art(?:\.|igo)?$/.test(w)) continue;
    if (/^s[uú]mula$/.test(w)) continue;
    w = w.replace(/\*/g, "");
    if (/^\d{1,4}$/.test(w)) out.push(w);
    else if (/^\p{L}{3,}$/u.test(w)) out.push(w);
  }
  return Array.from(new Set(out));
}

function splitTokens(tokens) {
  const wordTokens = [];
  const numTokens  = [];
  for (const t of tokens) (/^\d{1,4}$/.test(t) ? numTokens : wordTokens).push(t);
  return { wordTokens, numTokens };
}

/* número "exato" dentro de um texto normalizado (1 não casa 10/100; 11 ≠ 1)
   Trata pontos de milhar: "1.000" ≡ "1000" */
//#region [BLK04] NUM • Regras numéricas (artigos, janelas)
function hasExactNumber(bag, n) {
  const bagNum = stripThousandDots(bag);
  const rx = new RegExp(`(?:^|\\D)${n}(?:\\D|$)`, "g");
  return rx.test(bagNum);
}

/* keyword proximity (≤12 chars) e regra "linha começa com" (≤15 chars) */
const KW_RX = /\b(art\.?|artigo|s[uú]mula)\b/iu;
const KW_ART_RX = /^\s*(art\.?|artigo)\b/i;
const KW_SUM_RX = /^\s*s[uú]mula\b/i;

function numberRespectsWindows(text, n, queryMode /* "art"|"sumula"|null */) {
  const raw = String(text);

  // (a) janela curta ≤12 chars
  const nearRx = new RegExp(String.raw`\b(art\.?|artigo|s[uú]mula)\b[^0-9a-zA-Z]{0,12}(${n})(?:\b|[^0-9])`, "i");
  const nearOK = nearRx.test(stripThousandDots(raw));
  if (!nearOK) return false;

  // (b) se query começa com o marcador → precisa estar nos 15 primeiros chars da linha
  if (!queryMode) return true;

  const lines = raw.split(/\r?\n/);
  const wantStart = queryMode === "art" ? KW_ART_RX : KW_SUM_RX;

  for (const line of lines) {
    if (!wantStart.test(line)) continue;
    const clean = stripThousandDots(norm(line));
    const after = clean.replace(queryMode === "art" ? KW_ART_RX : KW_SUM_RX, "").trimStart();
    const idx = after.indexOf(n);
    if (idx !== -1 && idx <= 15) return true;
  }
  return false;
}

function extractLegalRefsToSet(text) {
  const rx = /\b(art\.?|artigo|s[uú]mula)\b[^0-9a-zA-Z]{0,12}(\d{1,4}[a-zA-Z\-]?)/giu;
  const out = new Set();
  let m;
  while ((m = rx.exec(text)) !== null) {
    const puro = (m[2] || "").toLowerCase().match(/^\d{1,4}/)?.[0];
    if (puro) out.add(puro);
  }
  return out;
}

function getBagWords(bag) {
  return bag.match(/\b[a-z0-9]{3,}\b/g) || [];
}
function escapeRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function pluralVariants(t) {
  const v = new Set([t]);
  if (!t.endsWith("s")) { v.add(t + "s"); v.add(t + "es"); }
  else { v.add(t.slice(0, -1)); }
  if (t.endsWith("m")) v.add(t.slice(0, -1) + "ns");
  if (t.endsWith("ao")) {
    const base = t.slice(0, -2);
    v.add(base + "oes"); v.add(base + "aos"); v.add(base + "aes");
  }
  return [...v];
}
function withinOneSubstitutionStrict(a, b) {
  if (a.length !== b.length) return false;
  if (a.length < 4) return a === b;
  if (a[0] !== b[0] || a[a.length - 1] !== b[a.length - 1]) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && ++diff > 1) return false;
  }
  return diff === 1;
}
function bagHasTokenWord(bag, token) {
  const words = getBagWords(bag);
  const vars = pluralVariants(token);
  const rx = new RegExp(`\\b(${vars.map(escapeRx).join("|")})\\b`, "i");
  if (rx.test(bag)) return true;
  for (const w of words) {
    for (const v of vars) {
      if (withinOneSubstitutionStrict(v, w)) return true;
    }
  }
  return false;
}

/* ---------- catálogo (select) ---------- */
function toRawGitHub(url){
  if(!url) return url;
  const m = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^]+)$/);
  if(m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  return url;
}
(() => {
  els.codeSelect?.querySelectorAll("option").forEach((opt) => {
    let url = (opt.value || "").trim();
    const label = (opt.textContent || "").trim();
    if (!url) return;
    url = encodeURI(toRawGitHub(url));
    opt.value = url;
    state.urlToLabel.set(label, url);
  });
})();

/* ---------- fetch/parse ---------- */
// Split incremental: varre linha a linha e emite blocos quando encontra "-----"
function forEachBlockIncremental(txt, cb) {
  const RX_SPLIT = /^\s*-{5,}\s*$/m;
  const lines = String(txt).replace(/\r\n?/g, "\n").split("\n");
  let buf = [];
  let idx = 0;
  for (const ln of lines) {
    if (RX_SPLIT.test(ln)) {
      const block = buf.join("\n").trim();
      if (block) cb(block, idx++);
      buf = [];
    } else {
      buf.push(ln);
    }
  }
  const tail = buf.join("\n").trim();
  if (tail) cb(tail, idx++);
}

// Primeiro match de um arquivo (para carregar preview rápido)
async function firstMatchInFile(url, label, predicate) {
  if (state.cacheParsed.has(url)) {
    const items = state.cacheParsed.get(url);
    for (const it of items) if (predicate(it)) return it || null;
    return null;
  }
  const txt = await fetchText(url);
  let found = null;
  forEachBlockIncremental(txt, (block, idx) => {
    if (found) return;
    const it = parseBlock(block, idx, url, label);
    if (predicate(it)) found = it;
  });
  return found;
}

function sanitize(s) {
  return String(s)
    .replace(/\uFEFF/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n");
}
async function fetchText(url) {
  if (state.cacheTxt.has(url)) return state.cacheTxt.get(url);
  let r;
  try {
    r = await fetch(url, { cache: "force-cache" });
    if (!r.ok) throw new Error("cache-miss");
  } catch {
    r = await fetch(url, { cache: "default" });
  }
  if (!r.ok) throw new Error(`fetch-fail ${r.status} ${url}`);
  const t = sanitize(await r.text());
  state.cacheTxt.set(url, t);
  return t;
}
function splitBlocks(txt) {
  return sanitize(txt)
    .split(/^\s*-{5,}\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}
function parseBlock(block, idx, fileUrl, sourceLabel) {
  const lines = block.split("\n");
  const firstIdx = lines.findIndex((l) => l.trim().length > 0);
  const first = firstIdx >= 0 ? lines[firstIdx].trim() : `Bloco ${idx + 1}`;
  const bodyLines = lines.slice(firstIdx + 1);

  // Captura o link (se existir) e remove do corpo
  let videoLink = null;
  const filteredBody = bodyLines.filter((line) => {
    const trimmed = line.trim();
    if (/^(?:https:\/\/www\.youtube\.com\/watch\?v=|https:\/\/youtu\.be\/)/.test(trimmed)) {
      videoLink = trimmed;
      return false;
    }
    return true;
  });

  const body = filteredBody.join("\n").trim();
  const full = [first, body].filter(Boolean).join("\n");
  const _bag = norm(stripThousandDots(full));

  return {
    id: `${fileUrl}::art-${idx}`,
    htmlId: `art-${idx}`,
    source: sourceLabel,
    title: first,
    body,
    text: full,         // texto sem o link
    _bag,
    fileUrl,
    videoUrl: videoLink || null
  };
}

async function parseFile(url, sourceLabel) {
  if (state.cacheParsed.has(url)) return state.cacheParsed.get(url);
  const txt = await fetchText(url);
  const blocks = splitBlocks(txt);
  const items = blocks.map((b, i) => parseBlock(b, i, url, sourceLabel));
  state.cacheParsed.set(url, items);
  return items;
}

/* ---------- "Respiros" (só no leitor) ---------- */
function addRespirationsForDisplay(s) {
  if (!s) return "";
  const RX_INCISO  = /^(?:[IVXLCDM]{1,8})(?:\s*(?:\)|\.|[-–—]))(?:\s+|$)/;
  const RX_PARAGR  = /^(?:§+\s*\d+\s*[ºo]?|Par[aá]grafo\s+(?:[Uu]nico|\d+)\s*[ºo]?)(?:\s*[:.\-–—])?(?:\s+|$)/i;
  const RX_ALINEA  = /^[a-z](?:\s*(?:\)|\.|[-–—]))(?:\s+|$)/;
  const RX_TITULO  = /^(?:T[ÍI]TULO|CAP[ÍI]TULO|SEÇÃO|SUBSEÇÃO|LIVRO)\b/i;

  const lines = String(s).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    const isMarker =
      RX_PARAGR.test(ln) ||
      RX_INCISO.test(ln) ||
      RX_ALINEA.test(ln) ||
      RX_TITULO.test(ln);

    if (isMarker && out.length && out[out.length - 1] !== "") out.push("");
    if (ln === "" && out.length && out[out.length - 1] === "") continue;

    out.push(ln);
  }
  return out.join("\n");
}
/* ---------- prioridade de pastas na busca ---------- */
// Ordem pedida: estatutos, sumulas, enunciados, teses, leis, temas_repetitivos,
//               codigos, julgados, videos, artigos_e_noticias
const SEARCH_ORDER = [
  "data/estatutos/",
  "data/sumulas/",
  "data/enunciados/",
  "data/teses/",
  "data/leis/",
  "data/temas_repetitivos/",
  "data/codigos/",
  "data/julgados/",
  "data/videos/",
  "data/artigos_e_noticias/"
];

// Retorna o índice de prioridade com base no caminho da URL (quanto menor, mais cedo busca)
function pathPriority(url) {
  const u = String(url || "").toLowerCase();
  for (let i = 0; i < SEARCH_ORDER.length; i++) {
    if (u.includes(SEARCH_ORDER[i])) return i;
  }
  return SEARCH_ORDER.length; // não mapeados vão pro fim
}

/* ---------- busca ---------- */
els.form?.addEventListener("submit", (e) => { e.preventDefault(); doSearch(); });
els.q?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } });

function detectQueryMode(normQuery) {
  const trimmed = normQuery.trim();
  if (/^(art\.?\b|artigo\b)/i.test(trimmed)) return "art";
  if (/^s[uú]mula\b/i.test(trimmed)) return "sumula";
  return null;
}

/* Palavras: TODAS; Números: exatos; Proximidade: ≤12; Se começa com Art/Súmula: ≤15 no início da linha */
function hasAllWordTokens(bag, wordTokens) {
  return wordTokens.every((w) => bagHasTokenWord(bag, w));
}
function matchesNumbers(item, numTokens, queryHasLegalKeyword, queryMode) {
  if (!numTokens.length) return true;

  const bag = item._bag || norm(stripThousandDots(item.text));
  if (!queryHasLegalKeyword) {
    return numTokens.every((n) => hasExactNumber(bag, n));
  }
  return numTokens.every((n) => numberRespectsWindows(item.text, n, queryMode));
}

let __searchAbort;

async function doSearch() {
  // cancel previous search if any
  if (__searchAbort) { try { __searchAbort.abort(); } catch(_){} }
  __searchAbort = new AbortController();
  const { signal } = __searchAbort;
  const termRaw = (els.q.value || "").trim();
  if (!termRaw) return;

  saveToHistory(termRaw); // histórico

  // trata 1.000 → 1000 na query
  const term = stripThousandDots(termRaw);

  els.stack.innerHTML = "";
  els.stack.setAttribute("aria-busy", "true");
  const skel = document.createElement("section");
  skel.className = "block";
  const t = document.createElement("div");
  t.className = "block-title";
  t.textContent = `Busca: ‘${termRaw}’ (…)`;
  skel.appendChild(t);
  for (let i = 0; i < 2; i++) {
    const s = document.createElement("div"); s.className = "skel block"; skel.appendChild(s);
  }
  els.stack.append(skel);
  els.spinner?.classList.add("show");

  try {
    const normQuery = norm(term);
    const queryMode = detectQueryMode(normQuery); // "art" | "sumula" | null

    // dica de código (cc, cp, cpc, "codigo civil", etc.)
    const codeInfo = detectCodeFromQuery(normQuery);

    // tokens válidos (palavras 3+ e números 1–4)
    let tokens = tokenize(normQuery);
    if (!tokens.length && (!window.__phrases || window.__phrases.length === 0)) {
      skel.remove();
      window.renderBlock(termRaw, [], []); // usa override bucketizado
      toast("Use palavras com 3+ letras ou números (1–4 dígitos).");
      return;
    }

    // se houve codeInfo, remove do conjunto de palavras os termos que só serviram p/ identificar o código
    if (codeInfo) {
      tokens = tokens.filter((tk) => !codeInfo.keyWords.has(tk));
    }
    // FIX: não tratar "artigo"/"art"/"art." como palavra obrigatória
    if (queryMode === "art") {
      tokens = tokens.filter(t => !/^art(?:\.|igo)?$/i.test(t));
    }
    // idem para súmula
    if (queryMode === "sumula") {
      tokens = tokens.filter(t => !/^s[uú]mula$/i.test(t));
    }

    // salva tokens globais p/ highlight (strings) + frases "..."
    const phrases = Array.isArray(window.__phrases) ? window.__phrases : [];
    window.searchTokens = (Array.isArray(tokens) && tokens.length ? tokens : buildTokens(els.q?.value)).concat(phrases);

    const queryHasLegalKeyword = KW_RX.test(normQuery);
    const { wordTokens, numTokens } = splitTokens(tokens);

    // monta a lista de arquivos; se codeInfo → filtra pelo rótulo do <select>
    let allOptions = Array.from(els.codeSelect?.querySelectorAll("option") || [])
      .map((o) => ({ url: (o.value || "").trim(), label: (o.textContent || "").trim() }))
      .filter((o) => o.url);

    if (codeInfo) {
      allOptions = allOptions.filter((o) => o.label === codeInfo.label);
      if (!allOptions.length) {
        toast(`Não achei o arquivo para “${codeInfo.label}”. Confira o rótulo do catálogo.`);
      }
    }
// Ordena os arquivos pela prioridade de pastas + tie-break por label/url
allOptions.sort((a, b) => {
  const pa = pathPriority(a.url);
  const pb = pathPriority(b.url);
  if (pa !== pb) return pa - pb;
  if (a.label !== b.label) return a.label.localeCompare(b.label);
  return a.url.localeCompare(b.url);
});

    // estrutura "lazy": guardamos só o primeiro match e um loader para o resto
    const lazyGroups = []; // [{ label, url, items:[first], partial:true }]

   for (const { url, label } of allOptions) {
  try {
    const predicate = (it) => {
      const bag = it._bag || norm(stripThousandDots(it.text));
      const okWords = hasAllWordTokens(bag, wordTokens);
      const okNums  = matchesNumbers(it, numTokens, queryHasLegalKeyword, queryMode);
      return okWords && okNums;
    };

    const first = await firstMatchInFile(url, label, predicate);
    if (first) {
      lazyGroups.push({ label, url, items: [first], partial: true });

      //#region [BLK11] RENDER • Buckets & Results
      window.renderLazyResults(termRaw, lazyGroups, tokens);
      //#endregion
    }
    if (signal.aborted) return;
  } catch (e) {
    toast(`⚠️ Não carreguei: ${label}`);
    console.warn("Falha ao buscar:", e);
  }
}


    // fim da busca inicial (só previews)
    skel.remove();
    toast(`${lazyGroups.length} fonte(s) com resultado.`);

  } finally {
    els.stack.setAttribute("aria-busy", "false");
    els.spinner?.classList.remove("show");

    if (!window._skipFocus) {
      els.q?.select();
    }
    window._skipFocus = false;
  }
}

/* ---------- cards ---------- */
function highlight(text, tokens) {
  if (!tokens?.length) return escHTML(text || "");
  const srcEsc = escHTML(text || "");
  const srcNFD = srcEsc.normalize("NFD");
  const toDiacriticRx = (t) =>
    t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
     .replace(/\p{L}/gu, (ch) => ch + "\\p{M}*");
  const parts = tokens.filter(Boolean).map(toDiacriticRx);
  if (!parts.length) return srcEsc;
  const rx = new RegExp(`\\b(${parts.join("|")})\\b`, "giu");
  const markedNFD = srcNFD.replace(rx, `<mark class="hl">$1</mark>`);
  return markedNFD.normalize("NFC");
}

function truncatedHTML(fullText, tokens) {
  const base = fullText || "";
  let out = base.slice(0, CARD_CHAR_LIMIT);
  const cut = out.lastIndexOf(" ");
  if (base.length > CARD_CHAR_LIMIT && cut > CARD_CHAR_LIMIT * 0.7) {
    out = out.slice(0, cut) + "…";
  } else if (base.length > CARD_CHAR_LIMIT) {
    out = out.trim() + "…";
  }
  return highlight(out, tokens);
}

/* ===== Prompts únicos (sem categorização) ===== */
const PROMPT_GEMINI = "Você é professor de Direito e escritor de apostilas universitarias. Tranforme o tema abaixo em uma breve apostila didatica e exemplificativa capaz de qualificar universitários sobre o tema:";
const PROMPT_QUESTOES = "Voce é um professor de direito, crie 10 questões objetivas (A–D) sobre todo o tema abaixo para estudantes universitario testarem seu conhecimento, traga gabarito comentado curto.";

/* Builder único para ambos os botões */
function buildPromptQueryFromItem(item, tipo) {
  if (!item) return "";
  const prefix = (tipo === "gemini") ? PROMPT_GEMINI : PROMPT_QUESTOES;
  const header = `### ${item.title || ""}${item.source ? ` — [${item.source}]` : ""}`;
  const body   = `${item.text || ""}`;
  const raw    = `${prefix}\n\n${header}\n\n${body}`.replace(/\s+/g, " ").trim();

  // Limite de segurança para URL (iOS/Google)
  const MAX = 1800;
  const clipped = raw.length > MAX ? raw.slice(0, MAX) : raw;
  return encodeURIComponent(clipped);
}

/* util para abrir nova aba com segurança */
function openExternal(url) {
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (_) {
    location.href = url;
  }
}

//#region [BLK10] RENDER • Cards
function renderCard(item, tokens = [], ctx = { context: "results" }) {
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.id = item.id;
  if (item.source) card.setAttribute("data-source", item.source);

  const left = document.createElement("div");

  // chip do código (não no modal leitor)
  if (item.source && ctx.context !== "reader") {
    const pill = document.createElement("a");
    pill.href = "#";
    pill.className = "pill";
    pill.textContent = `📘 ${item.source} (abrir)`;
    pill.addEventListener("click", (e) => {
      e.preventDefault();
      openReader(item);
    });
    left.append(pill);
  }

  const body = document.createElement("div");
  body.className = "body";
  if (ctx.context === "reader") {
    body.innerHTML = highlight(
      item.text,
      (window.searchTokens && window.searchTokens.length) ? window.searchTokens : tokens
    );
  } else {
    body.classList.add("is-collapsed");
    const tokensForHL = (window.searchTokens && window.searchTokens.length)
      ? window.searchTokens
      : (Array.isArray(tokens) ? tokens : []);
    body.innerHTML = truncatedHTML(item.text || "", tokensForHL);
  }
  body.style.cursor = "pointer";
  body.addEventListener("click", () => openReader(item));

  const actions = document.createElement("div");
  actions.className = "actions";

  /* TOGGLE (seta) alinhado à esquerda */
  if ((item.text || "").length > CARD_CHAR_LIMIT) {
    const toggle = document.createElement("button");
    toggle.className = "toggle toggle-left";
    toggle.textContent = "▼";
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", expanded ? "false" : "true");
      toggle.textContent = expanded ? "▼" : "▲";
      if (expanded) {
        body.classList.add("is-collapsed");
        const tokensForHL = (window.searchTokens && window.searchTokens.length)
          ? window.searchTokens
          : (Array.isArray(tokens) ? tokens : []);
        body.innerHTML = truncatedHTML(item.text || "", tokensForHL);
      } else {
        body.classList.remove("is-collapsed");
        body.innerHTML = highlight(
          item.text,
          (window.searchTokens && window.searchTokens.length) ? window.searchTokens : tokens
        );
        applyHighlights(
          body,
          (window.searchTokens && window.searchTokens.length) ? window.searchTokens : tokens
        );
      }
    });
    actions.append(toggle);
  }

  // — Gemini (prompt único)
  const geminiBtn = document.createElement("button");
  geminiBtn.type = "button";
  geminiBtn.className = "round-btn";
  geminiBtn.setAttribute("aria-label", "Estudar com Gemini");
  geminiBtn.title = "Estudar";
  geminiBtn.innerHTML = '<img src="icons/ai-gemini4.png" alt="Gemini">';
  geminiBtn.addEventListener("click", () => {
    const q = buildPromptQueryFromItem(item, "gemini");
    openExternal(`https://www.google.com/search?q=${q}&udm=50`);
  });

  // — Questões (prompt único)
  const questoesBtn = document.createElement("button");
  questoesBtn.type = "button";
  questoesBtn.className = "round-btn";
  questoesBtn.setAttribute("aria-label", "Gerar questões");
  questoesBtn.title = "Questões";
  questoesBtn.innerHTML = '<img src="icons/ai-questoes.png" alt="Questões">';
  questoesBtn.addEventListener("click", () => {
    const q = buildPromptQueryFromItem(item, "questoes");
    openExternal(`https://www.google.com/search?q=${q}&udm=50`);
  });

  // adiciona os dois botões lado a lado
  actions.append(geminiBtn, questoesBtn);

  const right = document.createElement("div");
  right.className = "right";
  right.append(actions);

  card.append(left, body, right);
  return card;
 }
}


  // — YouTube (apenas data/videos/, com mapa de canais e fix iOS)
  if (item.fileUrl?.includes("data/videos/")) {
    const CHANNEL_NAMES = {
      "supremo.txt": "tv supremo",
      "instante_juridico.txt": "instante juridico",
      "me_julga.txt": "me julga",
      "seus_direitos.txt": "seus direitos",
      "direito_desenhado.txt": "direito desenhado",
      "diego_pureza.txt": "prof diego pureza",
      "estrategia_carreiras_juridicas.txt": "estrategia carreiras juridicas",
      "ana_carolina_aidar.txt": "ana carolina aidar",
      "cebrian.txt": "cebrian",
      "fonte_juridica_oficial.txt": "fonte juridica oficial",
      "paulo_henrique_helene.txt": "paulo henrique helene",
      "profnidal.txt": "professor nidal",
      "monicarieger.txt": "monica rieger",
      "rodrigo_castello.txt": "rodrigo castello",
      "prof_alan_gestao.txt": "prof alan gestao",
      "simplificando_direito_penal.txt": "simplificando direito penal",
      "geofre_saraiva.txt": "geofre saraiva",
      "ricardo_torques.txt": "ricardo torques",
      "prof_eduardo_tanaka.txt": "prof eduardo tanaka",
      "trilhante.txt": "trilhante",
      "qconcurso.txt": "qconcurso",
      "paulo_rodrigues_direito_para_a_vida.txt": "paulo rodrigues direito para a vida"
    };
    const fileName = item.fileUrl.split("/").pop().toLowerCase();
    const canalNome = CHANNEL_NAMES[fileName];
    if (canalNome) {
      const title = (item.title || "").trim();
      const rawQuery = `${canalNome} ${title}`;
      const q = encodeURIComponent(rawQuery); // iOS: m.youtube.com e sem +
      const urlFinal = `https://m.youtube.com/results?search_query=${q}`;
      const ytBtn = document.createElement("button");
      ytBtn.className = "round-btn";
      ytBtn.setAttribute("aria-label", "Ver no YouTube");
      ytBtn.innerHTML = '<img src="icons/youtube.png" alt="YouTube">';
      ytBtn.addEventListener("click", () => openExternal(urlFinal));
      actions.append(ytBtn);
    }
  }

  // — Fontes “Artigos e Notícias”
  if (item.fileUrl?.includes("data/artigos_e_noticias/")) {
    const fontes = {
      "jusbrasil.txt": { base: "https://www.jusbrasil.com.br/artigos-noticias/busca?q=", icon: "jusbrasil.png" },
      "conjur.txt":    { base: "https://www.conjur.com.br/pesquisa/?q=",                 icon: "conjur.png"    },
      "migalhas.txt":  { base: "https://www.migalhas.com.br/busca?q=",                   icon: "migalhas.png"  }
    };
    const fileName = item.fileUrl.split("/").pop().toLowerCase();
    const fonte = fontes[fileName];
    if (fonte?.base) {
      const query = encodeURIComponent((item.title || "").trim());
      const urlFinal = `${fonte.base}${query}`;
      const btn = document.createElement("button");
      btn.className = "round-btn";
      btn.setAttribute("aria-label", "Ver fonte original");
      btn.innerHTML = `<img src="icons/${fonte.icon}" alt="Fonte">`;
      btn.addEventListener("click", () => window.open(urlFinal, "_blank", "noopener"));
      actions.append(btn);
    }
  }

  /* Check (pilha) */
  const chk = document.createElement("button");
  chk.className = "chk";
  chk.setAttribute("aria-label", "Selecionar bloco");
  chk.innerHTML = `
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"/>
    </svg>
  `;
  const sync = () => { chk.dataset.checked = state.selected.has(item.id) ? "true" : "false"; };
  sync();
  chk.addEventListener("click", () => {
    if (state.selected.has(item.id)) {
      state.selected.delete(item.id);
      toast(`Removido (${state.selected.size}/${MAX_SEL}).`);
      if (ctx.context === "selected") card.remove();
    } else {
      if (state.selected.size >= MAX_SEL) { toast(`⚠️ Limite de ${MAX_SEL} blocos.`); return; }
      state.selected.set(item.id, { ...item });
      toast(`Adicionado (${state.selected.size}/${MAX_SEL}).`);
    }
    sync();
    updateBottom();
  });

  // não mostrar o "Selecionar" dentro do modal (reader)
  if (ctx.context !== "reader") {
    actions.append(chk);
  }

  left.append(body, actions);
  card.append(left);
  return card;
}


/* === Publica helpers no window (fora de funções) === */
Object.assign(window, {
  els,
  parseFile,
  norm,
  stripThousandDots,
  hasAllWordTokens,
  matchesNumbers,
  KW_RX,
  detectQueryMode,
  renderCard,
  toast,
});
/* ---------- Modal incremental: config + helpers ---------- */
// Pré-carga inicial ao abrir o modal
const READER_PRELOAD_PREV = 20;  // carregar imediatamente 20 anteriores
const READER_PRELOAD_NEXT = 20;  // e 20 posteriores

// Lote por clique nos botões “Carregar anteriores/próximos”
const READER_BATCH_SIZE   = 100; // cada clique carrega +100

// Lotes pequenos para pintar listas (ex.: ranking em grupos)
const LIST_BATCH_SIZE     = 10;  // usado nas listas (não confundir com o de 100)

const READER_IDLE_MS      = 16;  // respiro entre lotes (aprox. 1 frame)



function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function idle(fn, delay = READER_IDLE_MS) {
  if (typeof requestIdleCallback === "function") {
    return requestIdleCallback(() => fn());
  }
  return setTimeout(fn, delay);
}

// Prefetch parser silencioso (uso: assim que a prévia aparece)
async function prefetchFile(url, label) {
  try { await parseFile(url, label); } catch (_) { /* ignora */ }
}

/* ---------- Leitor (modal) ---------- */
async function openReader(item, tokens = []) {
  if (els.readerTitle) els.readerTitle.textContent = item.source || "";
  if (els.selCount) els.selCount.textContent = `${state.selected.size}/${MAX_SEL}`;
  if (els.readerBody) els.readerBody.innerHTML = "";
  showModal(els.readerModal);

  // Skeleton imediato
  for (let i = 0; i < 3; i++) {
    const s = document.createElement("div");
    s.className = "skel block";
    s.style.margin = "10px 0";
    els.readerBody.appendChild(s);
  }

  try {
    // Pega todos os itens (parse com cache)
    const items = await parseFile(item.fileUrl, item.source);
    els.readerBody.innerHTML = "";

    // Descobre índice da âncora (o bloco clicado)
    const anchorIdx = items.findIndex(it => it.id === item.id || it.htmlId === item.htmlId);
    const idx = anchorIdx >= 0 ? anchorIdx : 0;

    // 1) Render “relâmpago”: âncora + 20 anteriores e 20 posteriores
const start = Math.max(0, idx - READER_PRELOAD_PREV);
const end   = Math.min(items.length, idx + READER_PRELOAD_NEXT + 1);
for (let i = start; i < end; i++) {
  const card = renderCard(items[i], tokens, { context: "reader" });
  card.id = items[i].htmlId;
  els.readerBody.appendChild(card);
}


    // Grifa após primeira pintura
    const phrases = Array.isArray(window.__phrases) ? window.__phrases : [];
    const searchTokens = (window.searchTokens && window.searchTokens.length) ? window.searchTokens : tokens;
    idle(() => applyHighlights(els.readerBody, searchTokens.concat(phrases)));

    // 2) Navegação incremental (anteriores e próximos)
const restTop    = items.slice(0, start);      // anteriores à âncora
const restBottom = items.slice(end);           // depois da âncora

// container central para os cards do leitor
const list = document.createElement("div");
list.id = "readerList";
els.readerBody.appendChild(list);

// move os 3+3 vizinhos (já renderizados) para dentro do container
const tmpNodes = Array.from(els.readerBody.querySelectorAll(".card"));
tmpNodes.forEach(n => list.appendChild(n));

// barras de carregamento (topo e rodapé)
const mkBar = (pos /* 'top' | 'bottom' */, label, onClick) => {
  const bar = document.createElement("div");
  bar.className = "reader-loadbar";
  bar.style.cssText = "display:flex;gap:10px;align-items:center;justify-content:center;margin:12px 0;";
  bar.setAttribute("aria-live", "polite"); // acessibilidade

  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = label;

  const small = document.createElement("small");
  small.textContent = "Conteúdo grande — carregamento em lotes.";
  small.id = (pos === "top") ? "readerTopHint" : "readerBottomHint"; // id único
  btn.setAttribute("aria-describedby", small.id); // acessibilidade

  btn.addEventListener("click", () => { btn.disabled = true; onClick(btn); });

  bar.append(btn, small);
  if (pos === "top") els.readerBody.insertBefore(bar, list);
  else els.readerBody.appendChild(bar);
  return { bar, btn };
};


// loaders (anteriores = prepend; próximos = append)
const BATCH = READER_BATCH_SIZE; // 100 por clique
const loadPrevIncremental = (btn) => {
  // carrega do fim para o começo para manter ordem ascendente ao dar prepend
  const chunk = restTop.splice(Math.max(0, restTop.length - BATCH), BATCH);
  if (!chunk.length) { btn.closest(".reader-loadbar")?.remove(); return; }
  const frag = document.createDocumentFragment();
  chunk.forEach(it => {
    const card = renderCard(it, [], { context: "reader" });
    card.id = it.htmlId;
    frag.appendChild(card);
  });
  // prepend
  list.insertBefore(frag, list.firstChild);
  idle(() => applyHighlights(els.readerBody, (window.searchTokens || []).concat(window.__phrases || [])));
  if (restTop.length) {
    btn.textContent = `Carregar anteriores (${restTop.length})`;
    btn.disabled = false;
  } else {
    btn.closest(".reader-loadbar")?.remove();
  }
};

const loadNextIncremental = (btn) => {
  const chunk = restBottom.splice(0, BATCH);
  if (!chunk.length) { btn.closest(".reader-loadbar")?.remove(); return; }
  const frag = document.createDocumentFragment();
  chunk.forEach(it => {
    const card = renderCard(it, [], { context: "reader" });
    card.id = it.htmlId;
    frag.appendChild(card);
  });
  // append
  list.appendChild(frag);
  idle(() => applyHighlights(els.readerBody, (window.searchTokens || []).concat(window.__phrases || [])));
  if (restBottom.length) {
    btn.textContent = `Carregar próximos (${restBottom.length})`;
    btn.disabled = false;
  } else {
    btn.closest(".reader-loadbar")?.remove();
  }
};

// cria as barras (só se houver o que carregar)
let topUI, bottomUI;
if (restTop.length)   topUI    = mkBar("top",    `Carregar anteriores (${restTop.length})`,   loadPrevIncremental);
if (restBottom.length) bottomUI = mkBar("bottom", `Carregar próximos (${restBottom.length})`, loadNextIncremental);

// Sem autoload: só carrega ao clicar (previsível e leve)
// (se quiser reativar no futuro, use IntersectionObserver aqui)


// 3) Scroll suave até a âncora
const anchor = els.readerBody.querySelector(`#${CSS.escape(item.htmlId)}`);
if (anchor) {
  anchor.scrollIntoView({ block: "center", behavior: "instant" });
  anchor.classList.add("highlight");
  setTimeout(() => anchor.classList.remove("highlight"), 1800);
}
els.readerBody.focus();


  } catch (e) {
    toast("Erro ao abrir o arquivo. Veja o console.");
    console.warn(e);
    hideModal(els.readerModal);
  }
}

/* ---------- MODAIS ---------- */
function showModal(el) { if (el) { el.hidden = false; document.body.style.overflow = "hidden"; } }
function hideModal(el) { if (el) { el.hidden = true; document.body.style.overflow = ""; } }

document.addEventListener("click", (e) => {
  if (e.target.matches("[data-close-modal]")) hideModal(els.readerModal);
  if (e.target.matches("[data-close-sel]")) hideModal(els.selectedModal);

  if (els.readerModal && e.target === els.readerModal.querySelector(".modal-backdrop")) hideModal(els.readerModal);
  if (els.selectedModal && e.target === els.selectedModal.querySelector(".modal-backdrop")) hideModal(els.selectedModal);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (els.readerModal && !els.readerModal.hidden) hideModal(els.readerModal);
    if (els.selectedModal && !els.selectedModal.hidden) hideModal(els.selectedModal);
  }
});

/* ---------- VER SELECIONADOS (visor) ---------- */
/* Sem clique no visor; modal selecionados permanece se aberto por outro caminho */

/* ---------- HUB da BASE + Lixeira + Visor ---------- */
function ensureClearSelectedBtn() {
  const parent = els.viewBtn?.parentElement;
  if (!parent) return;
  if (!document.getElementById("clearSelectedBtn")) {
    const clearBtn = document.createElement("button");
    clearBtn.id = "clearSelectedBtn";
    clearBtn.className = "btn icon-only";
    clearBtn.innerHTML = "🗑️";
    clearBtn.setAttribute("aria-label", "Limpar seleção");
    clearBtn.addEventListener("click", () => {
      state.selected.clear();
      updateBottom();
      toast("Seleção limpa.");
      document.querySelectorAll(".card .chk[data-checked='true']")
        .forEach((b) => b.removeAttribute("data-checked"));
    });
    parent.appendChild(clearBtn);
  }
}
function ensureBaseSpacer() {
  const parent = els.viewBtn?.parentElement;
  if (!parent) return;
  if (!document.getElementById("baseHubSpacer")) {
    const spacer = document.createElement("div");
    spacer.id = "baseHubSpacer";
    spacer.style.flex = "0 0 160px";
    spacer.style.height = "1px";
    parent.appendChild(spacer);
  }
}
function ensureBaseHub() {
  const parent = els.viewBtn?.parentElement;
  if (!parent) return;
  if (!document.getElementById("baseHubWrap")) {
    const hubWrap = document.createElement("div");
    hubWrap.id = "baseHubWrap";
    hubWrap.className = "hub-wrap";

    const hubMenu = document.createElement("div");
    hubMenu.className = "hub-menu";

    const PREFIX = "Ensine o tema abaixo para um estudante de Direito exigente: explique com didática de alto nível, incluindo conceito jurídico, exemplos práticos, visão doutrinária, jurisprudência majoritária, prática jurídica, aplicação em provas e erros comuns.  ";

    const makeAggregateQuery = () => {
      if (!state.selected.size) { toast("Selecione blocos para usar no HUB."); return null; }
      const parts = [];
      let i = 1;
      for (const it of state.selected.values()) {
        parts.push(`### ${i}. ${it.title} — [${it.source}]`, it.text);
        if (i++ >= MAX_SEL) break;
      }
      const rawBody = `${PREFIX}\n\n` + parts.join("\n\n");
      const raw = rawBody.replace(/\s+/g, " ").trim();
      const maxLen = 4800;
      return encodeURIComponent(raw.length > maxLen ? raw.slice(0, maxLen) : raw);
    };

    const hubBtn1 = document.createElement("button");
    hubBtn1.className = "round-btn";
    hubBtn1.setAttribute("aria-label", "perplexity");
    hubBtn1.innerHTML = '<img src="icons/ai-perplexity.png" alt="">';
    hubBtn1.addEventListener("click", () => {
      const q = makeAggregateQuery(); if (!q) return;
      window.open(`https://www.perplexity.ai/search?q=${q}`, "_blank", "noopener");
    });

    const hubBtn2 = document.createElement("button");
    hubBtn2.className = "round-btn";
    hubBtn2.setAttribute("aria-label", "copilot");
    hubBtn2.innerHTML = '<img src="icons/ai-copilot.png" alt="">';
    hubBtn2.addEventListener("click", () => {
      const q = makeAggregateQuery(); if (!q) return;
      window.open(`https://www.bing.com/copilotsearch?q=${q}`, "_blank", "noopener");
    });

    const hubBtn3 = document.createElement("button");
    hubBtn3.className = "round-btn";
    hubBtn3.setAttribute("aria-label", "google-ai");
    hubBtn3.innerHTML = '<img src="icons/ai-gemini3.png" alt="">';
    hubBtn3.addEventListener("click", () => {
      const q = makeAggregateQuery(); if (!q) return;
      window.open(`https://www.google.com/search?q=${q}&udm=50`, "_blank", "noopener");
    });

    hubMenu.append(hubBtn1, hubBtn2, hubBtn3);

    const hubMain = document.createElement("button");
    hubMain.className = "round-btn hub-main";
    hubMain.setAttribute("aria-label", "Abrir atalhos");
    hubMain.innerHTML = '<img src="icons/ai-hub.png" alt="">';
    hubMain.addEventListener("click", (e) => {
      e.stopPropagation();
      hubMenu.classList.toggle("open");
    });

    document.addEventListener("click", (ev) => {
      if (!hubWrap.contains(ev.target)) hubMenu.classList.remove("open");
    });

    hubWrap.append(hubMenu, hubMain);
    parent.appendChild(hubWrap);
  }
}
function reorderBaseControlsAndCenter() {
  const parent = els.viewBtn?.parentElement;
  if (!parent || !els.viewBtn) return;

  const clearBtn = document.getElementById("clearSelectedBtn");
  const hubWrap  = document.getElementById("baseHubWrap");
  const spacer   = document.getElementById("baseHubSpacer");

  parent.style.display = "flex";
  parent.style.alignItems = "center";
  parent.style.justifyContent = "center";
  parent.style.gap = (window.innerWidth <= 420 ? "6px" : "8px");
  parent.style.flexWrap = (window.innerWidth <= 480 ? "wrap" : "nowrap");
  parent.style.width = "";
  parent.style.maxWidth = "";
  parent.style.margin = "";

  if (spacer) {
    let basis = 140;
    if (window.innerWidth <= 480) basis = 56;
    if (window.innerWidth <= 360) basis = 48;
    spacer.style.flex = `0 0 ${basis}px`;
    spacer.style.height = "1px";
  }

  [clearBtn, els.viewBtn, hubWrap, spacer].forEach(el => {
    if (el) { el.style.flexShrink = "0"; el.style.flexGrow = "0"; }
  });

  if (clearBtn) parent.appendChild(clearBtn);
  parent.appendChild(els.viewBtn);
  if (spacer) parent.appendChild(spacer);
  if (hubWrap) parent.appendChild(hubWrap);
}

/* ---------- init ---------- */
updateBottom();
document.getElementById("studyBtn")?.remove();
document.getElementById("questionsBtn")?.remove();
if (els.viewBtn && els.viewBtn.parentElement) {
  ensureBaseHub();
  ensureClearSelectedBtn();
  ensureBaseSpacer();
  reorderBaseControlsAndCenter();
  window.addEventListener("resize", reorderBaseControlsAndCenter);
}

document.getElementById("resetBtn")?.addEventListener("click", () => {
  window._skipFocus = true; // evita foco no input
  collapseAllGroupsAndScrollTop();
});

// Executa a busca automaticamente se vier com ?q=...
document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const q = params.get("q");
  if (q) {
    const input = document.getElementById("searchInput");
    if (input) input.value = q;
    doSearch(); // já executa a busca
  }
});

/* ---------- Reset: fecha grupos e sobe ---------- */
function collapseAllGroupsAndScrollTop() {
  document.querySelectorAll(".group-head[aria-expanded='true']").forEach((btn) => {
    btn.setAttribute("aria-expanded", "false");
    const groupBody = btn.nextElementSibling;
    if (groupBody?.classList.contains("group-body")) {
      groupBody.hidden = true;
    }
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* === Histórico de buscas === */
const MAX_HISTORY = 20;
const HISTORY_KEY = "searchHistory";
function saveToHistory(query) {
  const trimmed = query.trim();
  if (!trimmed) return;
  let history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  history = history.filter(q => q !== trimmed);
  history.unshift(trimmed);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}
function loadHistoryDropdown() {
  const menu = document.getElementById("historyDropdown");
  if (!menu) return;
  const history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  menu.innerHTML = "";

  if (history.length === 0) {
    const li = document.createElement("li");
    li.textContent = "Nenhuma busca recente.";
    li.style.color = "#888";
    li.style.fontStyle = "italic";
    li.style.cursor = "default";
    menu.appendChild(li);
    return;
  }

  history.forEach((q) => {
    const li = document.createElement("li");
    li.textContent = q;
    li.addEventListener("click", () => {
      els.q.value = q;
      menu.classList.remove("open");
      doSearch(); // refaz busca
    });
    menu.appendChild(li);
  });
}
document.getElementById("historyBtn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const menu = document.getElementById("historyDropdown");
  if (!menu) return;
  loadHistoryDropdown();
  menu.classList.toggle("open");
});
document.addEventListener("click", (e) => {
  const menu = document.getElementById("historyDropdown");
  if (!menu) return;
  if (!document.getElementById("historyBtn")?.contains(e.target)) {
    menu.classList.remove("open");
  }
});

/* ==========================
   direito.love — ui_buckets_patch.js (embutido)
   Adiciona categorias na UI e sobrescreve renderLazyResults/renderBlock
   ========================== */

(function(){
  if (typeof window === "undefined") return;

  // ===== Categorização só de UI (1 nível) =====
  const UI_BUCKETS = {
    "Códigos": ["data/codigos/"],
    "Leis": ["data/leis/"],
    "Estatutos": ["data/estatutos/"],
    "Súmulas": ["data/sumulas/"],
    "Enunciados": ["data/enunciados/"],
    "Temas Repetitivos e Teses": ["data/temas_repetitivos/", "data/teses/"],
    "Julgados": ["data/julgados/"],
    "Vídeos": ["data/videos/"],
    "Artigos e Notícias": ["data/artigos_e_noticias/"]
  };
  window.UI_BUCKETS = UI_BUCKETS;

  function resolveBucket(url = "") {
    const u = String(url).toLowerCase();
    for (const [main, paths] of Object.entries(UI_BUCKETS)) {
      if (paths.some(p => u.includes(p))) return { main };
    }
    return { main: "Outros" };
  }
  window.resolveBucket = resolveBucket;

  // tema azul-escuro e regras de colapso
  function ensureBucketStyles() {
    if (document.getElementById("bucket-darkblue-styles")) return;
    const css = `
  .bucket.group > .group-head{background:#0d2847;color:#fff;border-color:#0b2140}
  .bucket.group > .group-head:hover{background:#0b2140;color:#fff}
  .bucket .bucket-caret{filter:brightness(2)}
  .group > .group-head[aria-expanded="false"] + .group-body{display:none !important}
  .bucket .bucket-subhead[aria-expanded="false"] + .subcat-body{display:none !important}
  .bucket .subcat{margin:8px 0}
  .bucket .bucket-subhead{background:#173a6a;color:#fff;border:1px solid #102a4a;border-radius:10px;padding:10px 14px;width:100%;display:flex;align-items:center;justify-content:space-between;cursor:pointer}
  .bucket .bucket-subhead:hover{background:#133764}
  .bucket .subcat-title{font-weight:600}
  .bucket .subcat-body{padding:6px 10px 10px}
`;
    const style = document.createElement("style");
    style.id = "bucket-darkblue-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function renderBucket(mainTitle, nodes /* Array<HTMLElement> */) {
    ensureBucketStyles();

    const bucket = document.createElement("section");
    bucket.className = "bucket group";

    const head = document.createElement("button");
    head.className = "group-head";
    head.setAttribute("aria-expanded", "false");
    head.innerHTML = `
      <span class="group-title">${mainTitle}</span>
      <span class="bucket-caret" aria-hidden="true">▾</span>
    `;

    const body = document.createElement("div");
    body.className = "group-body bucket-body";
    body.hidden = true;

    nodes.forEach(n => body.appendChild(n));

    head.addEventListener("click", () => {
      const open = head.getAttribute("aria-expanded") === "true";
      head.setAttribute("aria-expanded", open ? "false" : "true");
      body.hidden = open;
    });

    bucket.appendChild(head);
    bucket.appendChild(body);
    return bucket;
  }
  window.renderBucket = renderBucket;

  // ===== Scoring leve (ranking por arquivo) =====
  //#region [BLK05] SCORE • Ranking
function scoreItem(it, words, nums, termNorm, queryMode) {
    // pesos
    const W_TITLE = 7.0;
    const W_BODY  = 2.2;
    const W_NUM_NEAR = 4.0;   // número perto de Art./Súmula
    const W_EXACT_PHRASE = 6.5;
    const W_SRC_BONUS = 0.8;  // leve: códigos/CF88 ganham pouco

    // normalizações
    const len = Math.max(50, it.text.length);
    const normLen = 1 / Math.sqrt(len / 400); // penaliza textos muito longos

    const bag = it._bag;
    let score = 0;

    // palavras: conta no título e no corpo
    const titleBag = (it.title || "").toLowerCase();
    const bodyBag  = (it.body  || "").toLowerCase();

    for (const w of words) {
      if (w.length < 3) continue;
      if (new RegExp(`\\b${escapeRegExp(w)}\\b`, "i").test(titleBag)) score += W_TITLE;
      if (bagHasTokenWord(bag, w)) score += W_BODY;
    }

    // números: proximidade com Art./Súmula
    for (const n of nums) {
      if (numberRespectsWindows(it.text, n, queryMode)) score += W_NUM_NEAR;
    }

    // frases entre aspas (window.__phrases)
    const phrases = Array.isArray(window.__phrases) ? window.__phrases : [];
    for (const p of phrases) {
      if (!p || p.length < 2) continue;
      // busca acento-insensível
      const rx = new RegExp(escapeRegExp(p.normalize("NFD")).replace(/\p{L}/gu, (ch)=>ch+"\\p{M}*"), "iu");
      if (rx.test(it.text.normalize("NFD"))) score += W_EXACT_PHRASE;
    }

    // bônus suave por fonte (ex.: CF88/códigos)
    if (it.fileUrl && /\/(CF88|codigos)\//i.test(it.fileUrl)) score += W_SRC_BONUS;

    return score * normLen;
  }

  // ---- LAZY group section (preview 1 card; carrega o resto ao abrir, com ranking top-N)
  function renderLazyGroupSection(entry, tokens, term) {
  const { label, url, items, partial } = entry;

  const sec = document.createElement("section");
  sec.className = "group";

  const head = document.createElement("button");
  head.className = "group-head";
  head.setAttribute("aria-expanded", "false");
  head.innerHTML = `
    <span class="group-title">${label}</span>
    <span class="group-caret" aria-hidden="true">▾</span>
  `;
  sec.appendChild(head);

  const body = document.createElement("div");
  body.className = "group-body";
  body.hidden = true;
  body.appendChild(window.renderCard(items[0], tokens));
  sec.appendChild(body);

  const foot = document.createElement("div");
  foot.className = "group-foot";
  foot.hidden = true;
  const info = document.createElement("small");
  info.textContent = partial ? "Prévia: 1 resultado" : `Exibindo ${items.length}`;
  foot.appendChild(info);
  sec.appendChild(foot);

  let loadedAll = !partial;

  // Prefetch silencioso logo após montar a prévia
  idle(() => prefetchFile(url, label));

  head.addEventListener("click", async () => {
    const open = head.getAttribute("aria-expanded") === "true";
    head.setAttribute("aria-expanded", open ? "false" : "true");
    body.hidden = open;
    foot.hidden = open;

    if (!open && !loadedAll) {
      const sk = document.createElement("div");
      sk.className = "skel block";
      sk.style.margin = "10px 12px";
      body.appendChild(sk);

      try {
        const fullItems = await window.parseFile(url, label);

        // split tokens em palavras/números (strings)
        const words = (tokens || []).filter(t => !/^\d{1,4}$/.test(t));
        const nums  = (tokens || []).filter(t =>  /^\d{1,4}$/.test(t));
        const termNorm = window.norm(window.stripThousandDots(term));
        const qMode = window.detectQueryMode(termNorm);

        // filtra matches como antes
        const candidates = [];
        for (const it of fullItems) {
          const bag = it._bag || window.norm(window.stripThousandDots(it.text));
          const okWords = window.hasAllWordTokens(bag, words);
          const okNums  = window.matchesNumbers(it, nums, window.KW_RX.test(termNorm), qMode);
          if (okWords && okNums) candidates.push(it);
        }

        // rank (leve) e render incremental para não travar
        const TOP_N = 20;
        candidates.sort((a,b) => {
          const sa = scoreItem(a, words, nums, termNorm, qMode);
          const sb = scoreItem(b, words, nums, termNorm, qMode);
          return sb - sa;
        });

        loadedAll = true;
        body.innerHTML = "";

        const ranked = candidates.slice(0, TOP_N);
        const batches = chunkArray(ranked, LIST_BATCH_SIZE); // lotes menores e estáveis
        const renderBatch = () => {
          const lot = batches.shift();
          if (!lot) return;
          const frag = document.createDocumentFragment();
          lot.forEach((it) => frag.appendChild(window.renderCard(it, tokens)));
          body.appendChild(frag);
          idle(renderBatch);
        };
        renderBatch();

        info.textContent = `Exibindo ${ranked.length}${candidates.length > ranked.length ? ` de ${candidates.length}` : ""}`;
        const count = document.createElement("span");
        count.className = "group-count";
        count.textContent = candidates.length;
        head.insertBefore(count, head.querySelector(".group-caret"));

      } catch (e) {
        console.warn(e);
        if (window.toast) window.toast("Falha ao carregar o grupo.");
      }
    }
  });

  return sec;
}

  window.renderLazyGroupSection = renderLazyGroupSection;

  // Override: renderLazyResults com buckets
  window.renderLazyResults = function renderLazyResults(term, groups, tokens) {
    const { els } = window;
    els.stack.innerHTML = "";

    const block = document.createElement("section");
    block.className = "block";

    const title = document.createElement("div");
    title.className = "block-title";
    title.textContent = `Busca: ‘${term}’`;
    block.appendChild(title);

    const byMain = new Map(); // main => [nodes]

    [...groups].sort((a,b)=> a.label.localeCompare(b.label)).forEach((entry) => {
      const { main } = resolveBucket(entry.url);
      const node = renderLazyGroupSection(entry, tokens, term);
      if (!byMain.has(main)) byMain.set(main, []);
      byMain.get(main).push(node);
    });

    for (const [main, nodes] of byMain.entries()) {
      block.appendChild(renderBucket(main, nodes));
    }

    els.stack.append(block);
  };

  // Override: renderBlock (não-lazy) — mantém agrupamento por arquivo e buckets
  window.renderBlock = function renderBlock(term, items, tokens) {
    const { els } = window;

    const block = document.createElement("section");
    block.className = "block";

    const title = document.createElement("div");
    title.className = "block-title";
    title.textContent = `Busca: ‘${term}’ (${items.length} resultados)`;
    block.appendChild(title);

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "block-empty";
      empty.textContent = `Nada por aqui com ‘${term}’. Tente outra palavra.`;
      block.appendChild(empty);
      els.stack.append(block);
      return;
    }

    // agrupa por arquivo (label+url)
    const groupsMap = new Map(); // key -> {label,url,items[]}
    for (const it of items) {
      const key = `${it.source}::${it.fileUrl}`;
      if (!groupsMap.has(key)) groupsMap.set(key, { label: it.source || "Outros", url: it.fileUrl, items: [] });
      groupsMap.get(key).items.push(it);
    }

    // monta sections (accordions de arquivo)
    const sections = [];
    for (const g of groupsMap.values()) {
      const sec = document.createElement("section");
      sec.className = "group";

      const head = document.createElement("button");
      head.className = "group-head";
      head.setAttribute("aria-expanded","false");
      head.innerHTML = `
        <span class="group-title">${g.label}</span>
        <span class="group-count">${g.items.length}</span>
        <span class="group-caret" aria-hidden="true">▾</span>
      `;
      sec.appendChild(head);

      const body = document.createElement("div");
      body.className = "group-body";
      body.hidden = true;

      // ranking simples também no modo não-lazy
      const words = (tokens || []).filter(t => !/^\d{1,4}$/.test(t));
      const nums  = (tokens || []).filter(t =>  /^\d{1,4}$/.test(t));
      const termNorm = window.norm(window.stripThousandDots(term));
      const qMode = window.detectQueryMode(termNorm);

      const ranked = [...g.items].sort((a,b)=>{
        const sa = scoreItem(a, words, nums, termNorm, qMode);
        const sb = scoreItem(b, words, nums, termNorm, qMode);
        return sb - sa;
      });

      ranked.forEach((it)=> body.appendChild(window.renderCard(it, tokens)));
      sec.appendChild(body);

      head.addEventListener("click", ()=>{
        const open = head.getAttribute("aria-expanded")==="true";
        head.setAttribute("aria-expanded", open ? "false" : "true");
        body.hidden = open;
      });

      const { main } = resolveBucket(g.url);
      sections.push({ main, node: sec });
    }

    // agrupa por bucket principal
    const byMain = new Map();
    sections.forEach(({main, node}) => {
      if (!byMain.has(main)) byMain.set(main, []);
      byMain.get(main).push(node);
    });

    for (const [main, nodes] of byMain.entries()) {
      block.appendChild(renderBucket(main, nodes));
    }

    els.stack.append(block);
  };

})();


//#endregion /* EOF: app.js */
