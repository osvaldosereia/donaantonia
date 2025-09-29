/* ==========================
   direito.love — app.js (2025-09 • estável + patches)
   Regras:
   1) Cada card = bloco entre linhas "-----"
   2) Texto preservado como no .txt (parênteses incluídos)
   3) "Respiros" (linhas em branco) apenas na visualização do leitor
   ========================== */


/* Service Worker (opcional) */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

/* ---------- helpers ---------- */
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
  // Removidos: studyBtn, questionsBtn (não existem mais)
  // O visor usa o antigo viewBtn como contador estático (sem click)
  viewBtn: $("#viewBtn"),

  /* leitor */
  readerModal: $("#readerModal"),
  readerBody: $("#readerBody"),
  readerTitle: $("#readerTitle"),
  selCount: $("#selCount"),

  /* selecionados */
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

// Aplica highlight em NÓS DE TEXTO (acento-insensível; não mexe em tags/links)
function applyHighlights(rootEl, tokens) {
  if (!rootEl || !tokens?.length) return;

  // transforma cada token em um padrão que aceita acentos: letra -> letra + \p{M}*
  const toDiacriticRx = (t) =>
    String(t)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\p{L}/gu, (ch) => ch + "\\p{M}*");

  const parts = tokens.filter(Boolean).map(toDiacriticRx);
  if (!parts.length) return;

  // usa \b para borda de palavra; flags g i u
  const re = new RegExp(`\\b(${parts.join("|")})\\b`, "giu");

  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const txt = node.nodeValue;
      if (!txt || !txt.trim()) return NodeFilter.FILTER_REJECT;
      if (node.parentElement && node.parentElement.closest(".hl")) {
        return NodeFilter.FILTER_REJECT; // evita remarcar
      }
      re.lastIndex = 0; return re.test(txt.normalize("NFD")) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });

  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach(node => {
    const nfd = node.nodeValue.normalize("NFD");
    const pieces = nfd.split(re);
    const frag = document.createDocumentFragment();

    for (let i = 0; i < pieces.length; i++) {
      const chunk = pieces[i];
      if (!chunk) continue;
      const out = chunk.normalize("NFC"); // volta cada pedaço pra NFC

      if (i % 2 === 1) {
        const mark = document.createElement("mark");
        mark.className = "hl";
        mark.textContent = out;
        frag.appendChild(mark);
      } else {
        frag.appendChild(document.createTextNode(out));
      }
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
  // Removidos: promptTpl, promptQTpl, pendingObs, studyIncluded, questionsIncluded
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
  // visor como contador estático (n/MAX_SEL)
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
    // precisa estar no DOM em alguns webviews móveis
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (_) {
    // fallback: abre na mesma aba
    location.href = url;
  }

/* ============================================================
   MERGE de fontes por categoria (ex.: "Julgados")
   ============================================================ */

/* Quais conjuntos devem se comportar como UM só no front */
const MERGE_GROUPS = [
  {
    label: "Julgados",                    // nome único exibido no chip/pílula e no leitor
    test: (o) => o.url.includes("data/julgados/") // regra: todo arquivo dentro de /data/julgados/
  },
];

/* Dado o catálogo completo (options), devolve grupos fundidos + não-grupados */
function buildMergedSources(allOptions) {
  const out = [];
  const used = new Set();

  // 1) varre grupos definidos
  for (const grp of MERGE_GROUPS) {
    const members = allOptions.filter(o => !used.has(o.url) && grp.test(o));
    if (members.length) {
      members.forEach(m => used.add(m.url));
      out.push({
        type: "group",
        label: grp.label,
        urls: members.map(m => m.url),
        originLabels: members.map(m => m.label)
      });
    }
  }

  // 2) adiciona o resto (arquivos “soltos”)
  for (const o of allOptions) {
    if (!used.has(o.url)) {
      out.push({ type: "single", label: o.label, url: o.url });
    }
  }

  return out;
}

/* Primeiro match dentro de um GRUPO (varre arquivos até achar o 1º bloco que casa) */
async function firstMatchInGroup(group, predicate) {
  for (const url of group.urls) {
    const txt = await fetchText(url);
    let found = null;
    forEachBlockIncremental(txt, (block, idx) => {
      if (found) return;
      const it = parseBlock(block, idx, url, group.label /* força rótulo "Julgados" */);
      it.__group = { label: group.label, urls: group.urls.slice() };
      if (predicate(it)) found = it;
    });
    if (found) return found;
  }
  return null;
}

/* Abre TODOS os arquivos de um grupo no leitor (mesclado) */
async function parseAllFromGroup(group) {
  const all = [];
  for (const url of group.urls) {
    const items = await parseFile(url, group.label);
    items.forEach(it => it.__group = { label: group.label, urls: group.urls.slice() });
    all.push(...items);
  }
  return all;
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

/* Palavras 3+ letras e números 1–4 dígitos */
function tokenize(query) {
  const q = norm(query);
  const raw = q.split(/\s+/).filter(Boolean);
  const tokens = [];
  for (const w of raw) {
    if (/^\d{1,4}$/.test(w)) tokens.push(w);          // número exato (1–4 dígitos)
    else if (/^\p{L}{3,}$/u.test(w)) tokens.push(w);  // palavra 3+ letras
  }
  return Array.from(new Set(tokens));
}

function splitTokens(tokens) {
  const wordTokens = [];
  const numTokens  = [];
  for (const t of tokens) (/^\d{1,4}$/.test(t) ? numTokens : wordTokens).push(t);
  return { wordTokens, numTokens };
}

/* número "exato" dentro de um texto normalizado (1 não casa 10/100; 11 ≠ 1)
   Trata pontos de milhar: "1.000" ≡ "1000" */
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
// ===== Split incremental: varre linha a linha e emite blocos quando encontra "-----" =====
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

// ===== Primeiro match de um arquivo (para carregar preview rápido) =====
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
    if (!tokens.length) {
      skel.remove();
      window.renderBlock(termRaw, [], []); // usa override bucketizado
      toast("Use palavras com 3+ letras ou números (1–4 dígitos).");
      return;
    }

        // se houve codeInfo, remove do conjunto de palavras os termos que só serviram p/ identificar o código
    if (codeInfo) {
      tokens = tokens.filter((tk) => !codeInfo.keyWords.has(tk));
    }

    // salva tokens globais para highlight on-demand (abrir card)
    window.searchTokens = (Array.isArray(tokens) && tokens.length ? tokens : buildTokens(els.q?.value));

    const queryHasLegalKeyword = KW_RX.test(normQuery);
    const { wordTokens, numTokens } = splitTokens(tokens);


    // monta a lista de arquivos; se codeInfo → filtra pelo rótulo do <select>
    
// 1) monta catálogo base a partir do <select>
let allOptions = Array.from(els.codeSelect?.querySelectorAll("option") || [])
  .map((o) => ({ url: (o.value || "").trim(), label: (o.textContent || "").trim() }))
  .filter((o) => o.url);

// 2) se houve dica de código (ex.: “cp”, “cpc”), filtra por rótulo
if (codeInfo) {
  allOptions = allOptions.filter((o) => o.label === codeInfo.label);
  if (!allOptions.length) {
    toast(`Não achei o arquivo para “${codeInfo.label}”. Confira o catálogo.`);
  }
}

// 3) AGRUPA por conjuntos (ex.: une todos os /data/julgados/ em “Julgados”)
const mergedSources = buildMergedSources(allOptions);

// 4) busca “preguiçosa” (só 1º match por fonte/grupo)
const lazyGroups = []; // [{ label, url?|urls?, items:[first], partial:true }]

for (const src of mergedSources) {
  try {
    const predicate = (it) => {
      const bag = it._bag || norm(stripThousandDots(it.text));
      const okWords = hasAllWordTokens(bag, wordTokens);
      const okNums  = matchesNumbers(it, numTokens, queryHasLegalKeyword, queryMode);
      return okWords && okNums;
    };

    if (src.type === "group") {
      const first = await firstMatchInGroup(src, predicate);
      if (first) {
        lazyGroups.push({
          label: src.label,
          url: src.urls[0],
          items: [first],
          partial: true,
          __group: { label: src.label, urls: src.urls.slice() }
        });
        window.renderLazyResults(termRaw, lazyGroups, tokens);
      }
    } else {
      const first = await firstMatchInFile(src.url, src.label, predicate);
      if (first) {
        lazyGroups.push({ label: src.label, url: src.url, items: [first], partial: true });
        window.renderLazyResults(termRaw, lazyGroups, tokens);
      }
    }
  } catch (e) {
    toast(`⚠️ Não carreguei: ${src.label || 'fonte'}`);
    console.warn("Falha ao buscar:", e);
  }
}
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

    // só foca no input se for busca manual, não por "reset"
    if (!window._skipFocus) {
      els.q?.select();
    }
    window._skipFocus = false; // reseta para próximas buscas
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
  // AQUI: adiciona a classe .hl
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
body.innerHTML = highlight(item.text, (window.searchTokens && window.searchTokens.length) ? window.searchTokens : tokens);
  } else {
    body.classList.add("is-collapsed");
// agora já renderiza com highlight, usando truncatedHTML()
const tokensForHL = (window.searchTokens && window.searchTokens.length)
  ? window.searchTokens
  : (Array.isArray(tokens) ? tokens : []);
body.innerHTML = truncatedHTML(item.text || "", tokensForHL);

  }
  body.style.cursor = "pointer";
  body.addEventListener("click", () => openReader(item));

  const actions = document.createElement("div");
  actions.className = "actions";

  /* ===== TOGGLE (seta) ALINHADO À ESQUERDA ===== */
  if (item.text.length > CARD_CHAR_LIMIT) {
    const toggle = document.createElement("button");
    toggle.className = "toggle toggle-left";
    toggle.textContent = "▼";
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", expanded ? "false" : "true");
      toggle.textContent = expanded ? "▼" : "▲";
      // when collapsed, show fast plain snippet; when expanded, full with highlight
      if (expanded) {
  body.classList.add("is-collapsed");
  const tokensForHL = (window.searchTokens && window.searchTokens.length)
    ? window.searchTokens
    : (Array.isArray(tokens) ? tokens : []);
  body.innerHTML = truncatedHTML(item.text || "", tokensForHL);
} else {
  body.classList.remove("is-collapsed");
  body.innerHTML = highlight(item.text, (window.searchTokens && window.searchTokens.length) ? window.searchTokens : tokens);
         applyHighlights(body, (window.searchTokens && window.searchTokens.length) ? window.searchTokens : tokens);

}

    });

    actions.append(toggle);
  }

  /* ===== IA: função de query (reuso) ===== */
  const makeQuery = () => {
    const raw = (item.title + " " + item.text).replace(/\s+/g, " ").trim();
    const maxLen = 4000; // segurança p/ URL
    return encodeURIComponent(raw.length > maxLen ? raw.slice(0, maxLen) : raw);
  };

  /* ===== HUB DENTRO DO CARD (com prefixo fixo e bugfix) ===== */
  const hubWrap = document.createElement("div");
  hubWrap.className = "hub-wrap";

  const hubMenu = document.createElement("div");
  hubMenu.className = "hub-menu";

  // Prefixos por pasta (edite livremente os textos à direita)
  const INTRO_BY_DIR = {
    "data/codigos/":    "💡 ESTUDO (Códigos): Explique o tema com base no texto legal, citando fundamentos doutrinários, exemplos práticos e súmulas/julgados de apoio. Depois, aponte armadilhas de prova e como o artigo costuma ser cobrado na prática forense. Responda sempre em português do Brasil.",
    "data/sumulas/":    "💡 ESTUDO (Súmulas): Apresente o contexto fático-jurídico da súmula, indicando seu alcance prático. Relacione exceções conhecidas, dispositivos aplicáveis e exemplos de uso em concursos e casos reais. Responda sempre em português do Brasil.",
    "data/enunciados/": "💡 ESTUDO (Enunciados): Analise o enunciado relacionando-o aos dispositivos legais correspondentes e à interpretação dominante. Explique utilidade prática, aplicações típicas e como costuma ser exigido em provas ou petições. Responda sempre em português do Brasil.",
    "data/julgados/":   "💡 ESTUDO (Julgados): Resuma o julgado, explicando fundamentos centrais e precedentes determinantes da decisão. Comente efeitos práticos, divergências relevantes e a importância do caso para a jurisprudência atual. Responda sempre em português do Brasil.",
    "data/leis/":       "💡 ESTUDO (Leis): Destaque conceitos-chave da norma e a interpretação majoritária, com exemplos de aplicação. Aponte erros comuns, confusões frequentes e pontos sensíveis para concursos e prática jurídica. Responda sempre em português do Brasil.",
    "data/estatutos/":  "💡 ESTUDO (Estatutos): Explique o artigo abaixo dentro do contexto do estatuto a que pertence, destacando seu conteúdo, objetivo e relação com os demais dispositivos. Depois, aponte hipóteses práticas de aplicação, temas polêmicos e pegadinhas de prova. Responda sempre em português do Brasil.",
    "data/teses/":      "💡 ESTUDO (Teses): Explique a tese jurídica, seu conteúdo e lastro jurisprudencial, situando o contexto de aplicação. Comente divergências entre tribunais, controvérsias e impactos na prática forense. Responda sempre em português do Brasil.",
    "data/CF88/":       "💡 ESTUDO (CF/88): Relacione os princípios constitucionais e dispositivos da CF/88 diretamente aplicáveis ao tema. Apresente jurisprudência dominante e exemplos práticos que conectem teoria, lei e realidade. Responda sempre em português do Brasil.",
    "data/noticias/":   "💡 ESTUDO (Remuso): Escreva um resumo claro, com linguagem jurídica acessível. Destaque o entendimento do STJ, o impacto prático da decisão e a base legal aplicada.",
    "data/videos/":     "💡 ESTUDO (Explique e indique o vìdeo do be): Explique o tema, citando fundamentos doutrinários, exemplos práticos e súmulas/julgados de apoio. No final me de o link do vídeo em questão. Responda sempre em português do Brasil.  "
  };

  // (Opcional) complemento pedagógico geral
  const GLOBAL_PREFIX = "Seja Didático, organizado e de fácil entendimento. Entregue respostas com mais de 400 palavras. Tema:";

  // Resolve o prefixo por pasta a partir do fileUrl do item
  function getIntroForPath(fileUrl = "") {
    for (const dir in INTRO_BY_DIR) {
      if (fileUrl.includes(dir)) return INTRO_BY_DIR[dir];
    }
    return "💡 ESTUDO (Geral): explique de forma completa, prática e atualizada.";
  }

  // Monta a query do card
  const makeCardQuery = () => {
    const raw = (item.title + " " + item.text).replace(/\s+/g, " ").trim();
    const intro = getIntroForPath(item.fileUrl || "");
    const body  = `${intro}\n\n${raw}`;
    const maxLen = 1800; // segurança p/ não estourar URL
    return encodeURIComponent(body.length > maxLen ? body.slice(0, maxLen) : body);
  };

  // === Perplexity
  const hubBtn1 = document.createElement("button");
  hubBtn1.className = "round-btn";
  hubBtn1.setAttribute("aria-label", "perplexity");
  hubBtn1.innerHTML = '<img src="icons/ai-perplexity.png" alt="">';
  hubBtn1.addEventListener("click", () => {
    const q = makeCardQuery();
    window.open(`https://www.perplexity.ai/search?q=${q}`, "_blank", "noopener");
  });

  // === Copilot
  const hubBtn2 = document.createElement("button");
  hubBtn2.className = "round-btn";
  hubBtn2.setAttribute("aria-label", "copilot");
  hubBtn2.innerHTML = '<img src="icons/ai-copilot.png" alt="">';
  hubBtn2.addEventListener("click", () => {
    const q = makeCardQuery();
    const encoded = encodeURIComponent(q);
    window.open(`https://copilot.microsoft.com/?q=${encoded}`, "_blank", "noopener");
  });

  // === Google (AI mode / udm=50)
  const hubBtn3 = document.createElement("button");
  hubBtn3.className = "round-btn";
  hubBtn3.setAttribute("aria-label", "google-ai");
  hubBtn3.innerHTML = '<img src="icons/ai-gemini.png" alt="">';
  hubBtn3.addEventListener("click", () => {
    const q = makeCardQuery();
    window.open(`https://www.google.com/search?q=${q}&udm=50`, "_blank", "noopener");
  });

  hubMenu.append(hubBtn1, hubBtn2, hubBtn3);

  // Botão principal do hub (abre/fecha o menu)
  const hubMain = document.createElement("button");
  hubMain.className = "round-btn hub-main";
  hubMain.setAttribute("aria-label", "Abrir atalhos");
  hubMain.innerHTML = '<img src="icons/ai-hub.png" alt="">';
  hubMain.addEventListener("click", (e) => {
    e.stopPropagation();
    hubMenu.classList.toggle("open");
  });

  // Fecha qualquer menu aberto ao clicar fora (instala uma única vez)
  if (!window.__hubCloserInstalled) {
    document.addEventListener("click", (ev) => {
      document.querySelectorAll(".hub-wrap .hub-menu.open").forEach((menuEl) => {
        if (!menuEl.parentElement.contains(ev.target)) {
          menuEl.classList.remove("open");
        }
      });
    });
    window.__hubCloserInstalled = true;
  }

  hubWrap.append(hubMenu, hubMain);

  // Botão único do Gemini (sem hub)
  const geminiBtn = document.createElement("button");
  geminiBtn.className = "round-btn";
  geminiBtn.setAttribute("aria-label", "Estudar com Gemini");
  geminiBtn.innerHTML = '<img src="icons/ai-gemini.png" alt="Gemini">';
  geminiBtn.addEventListener("click", () => {
    const q = makeCardQuery();
    window.open(`https://www.google.com/search?q=${q}&udm=50`, "_blank", "noopener");
  });

 // === YouTube (puxar nome do canal pelo .txt e emendar o título do card)
if (item.fileUrl?.includes("data/videos/")) {
  // mapa: arquivo -> nome do canal (como você quer ver na busca)
  const CHANNEL_NAMES = {
    "supremo.txt":             "tv supremo",
    "instante_juridico.txt":   "instante juridico",
    "me_julga.txt":            "me julga",
    "seus_direitos.txt":       "seus direitos",
    "direito_desenhado.txt":   "direito desenhado",
    "diego_pureza.txt":        "prof diego pureza",
    "estrategia_carreiras_juridicas.txt":        "estrategia carreiras juridicas",
     "ana_carolina_aidar.txt":        "ana carolina aidar",
     "cebrian.txt":        "cebrian",
     "fonte_juridica_oficial.txt":        "fonte juridica oficial",
     "paulo_henrique_helene.txt":        "paulo henrique helene",
     "profnidal.txt":        "professor nidal",
     "monicarieger.txt":        "monica rieger",
     "rodrigo_castello.txt":        "rodrigo castello",
      "prof_alan_gestao.txt":        "prof alan gestao",
     "simplificando_direito_penal.txt":        "simplificando direito penal",
     "geofre_saraiva.txt":        "geofre saraiva",
      "ricardo_torques.txt":        "ricardo torques",
      "prof_eduardo_tanaka.txt":        "prof eduardo tanaka",
      "trilhante.txt":        "trilhante",
     "qconcurso.txt":        "qconcurso",
        "paulo_rodrigues_direito_para_a_vida.txt":        "paulo rodrigues direito para a vida"


  };

  const fileName = item.fileUrl.split("/").pop().toLowerCase();
  const canalNome = CHANNEL_NAMES[fileName];

  if (canalNome) {
    const title = (item.title || "").trim();

    // monta exatamente no formato do seu modelo:
    // https://www.youtube.com/results?search_query=prof+diego+pureza+como+organizar...
    const rawQuery = `${canalNome} ${title}`;
    const q = encodeURIComponent(rawQuery).replace(/%20/g, "+");
    const urlFinal = `https://www.youtube.com/results?search_query=${q}`;

    const ytBtn = document.createElement("button");
    ytBtn.className = "round-btn";
    ytBtn.setAttribute("aria-label", "Ver no YouTube");
    ytBtn.innerHTML = '<img src="icons/youtube.png" alt="YouTube">';
    ytBtn.addEventListener("click", () => {
      openExternal(urlFinal);
    });
    actions.append(ytBtn);
  }
}

 // === Link extra (para "artigos" e "notícias")
  if (item.fileUrl?.includes("data/artigos_e_noticias/")) {
    const fontes = {
      "jusbrasil.txt": {
        base: "https://www.jusbrasil.com.br/artigos-noticias/busca?q=",
        icon: "jusbrasil.png"
      },
      "conjur.txt": {
        base: "https://www.conjur.com.br/pesquisa/?q=",
        icon: "conjur.png"
      },
      "migalhas.txt": {
        base: "https://www.migalhas.com.br/busca?q=",
        icon: "migalhas.png"
      }
    };

    const fileName = item.fileUrl.split("/").pop().toLowerCase();
    const fonte = fontes[fileName];

    if (fonte?.base) {
      const query = encodeURIComponent(item.title.trim());
      const urlFinal = `${fonte.base}${query}`;
      const btn = document.createElement("button");
      btn.className = "round-btn";
      btn.setAttribute("aria-label", "Ver fonte original");
      btn.innerHTML = `<img src="icons/${fonte.icon}" alt="Fonte">`;
      btn.addEventListener("click", () => {
        window.open(urlFinal, "_blank", "noopener");
      });
      actions.append(btn);
    }
  }


  /* ===== Check (pilha) — permanece nos cards ===== */
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

  /* ===== Montagem das ações (cards) ===== */
  actions.append(geminiBtn, chk);

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

/* ---------- Leitor (modal) ---------- */
async 
/* ---------- Leitor (modal) — agora com suporte a GRUPOS ---------- */
async function openReader(item, tokens = []) {
  const readerTitle = item.__group?.label || item.source || "Leitor";
  if (els.readerTitle) els.readerTitle.textContent = readerTitle;
  if (els.selCount) els.selCount.textContent = `${state.selected.size}/${MAX_SEL}`;
  if (els.readerBody) els.readerBody.innerHTML = "";
  showModal(els.readerModal);

  // skeleton
  for (let i = 0; i < 3; i++) {
    const s = document.createElement("div");
    s.className = "skel block";
    s.style.margin = "10px 0";
    els.readerBody.appendChild(s);
  }

  try {
    let items = [];

    if (item.__group?.urls?.length) {
      items = await parseAllFromGroup(item.__group);
    } else {
      items = await parseFile(item.fileUrl, item.source);
    }

    els.readerBody.innerHTML = "";
    items.forEach((a) => {
      const card = renderCard(a, tokens, { context: "reader" });
      card.id = a.htmlId;
      els.readerBody.appendChild(card);
    });

    applyHighlights(
      els.readerBody,
      (window.searchTokens && window.searchTokens.length) ? window.searchTokens : tokens
    );

    const anchorId = item.htmlId || items[0]?.htmlId;
    const anchor = anchorId ? els.readerBody.querySelector(`#${CSS.escape(anchorId)}`) : null;
    if (anchor) {
      anchor.scrollIntoView({ block: "center", behavior: "instant" });
      anchor.classList.add("highlight");
      setTimeout(() => anchor.classList.remove("highlight"), 1800);
    }
    els.readerBody.focus();
  } catch (e) {
    toast("Erro ao abrir o leitor. Veja o console.");
    console.warn(e);
    hideModal(els.readerModal);
  }
}

