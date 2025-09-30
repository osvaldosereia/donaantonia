//#region [BLK00] BOOT • Service Worker & bootstrap

/* Service Worker (opcional) */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

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

//#region [BLK02] CONSTANTES & STATE

const MAX_SEL = 3;
const CARD_CHAR_LIMIT = 250;
const PREV_MAX = 60;

const state = {
  selected: new Map(),     // id -> item
  cacheTxt: new Map(),     // url -> string
  cacheParsed: new Map(),  // url -> items[]
  urlToLabel: new Map(),
};

// Popover de seleção (fixo)
const selectionPopover = document.createElement("div");
selectionPopover.className = "selection-popover hidden";
selectionPopover.innerHTML = `
  <button class="round-btn" data-action="search" title="Pesquisar">🔍</button>
  <button class="round-btn" data-action="gemini" title="Gemini">🤖</button>
  <button class="round-btn" data-action="questions" title="Questões">📝</button>
`;
document.body.appendChild(selectionPopover);

//#region [BLK03] TEXT • Helpers, Normalize, Tokenize

const norm = (s) => (s || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/ç/g, "c")
  .toLowerCase();

const stripThousandDots = (s) => String(s).replace(/(?<=\d)\.(?=\d)/g, "");

const escHTML = (s) => (s || "").replace(/[&<>"']/g, (m) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[m]));

// Normaliza tokens para highlight
function buildTokens(q) {
  return (q || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(t => t && t.length >= 2)
    .filter((t, i, a) => a.indexOf(t) === i);
}

// Pluralização básica
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

//#region [BLK05] SCORE • Ranking

function getBagWords(bag) {
  return bag.match(/\b[a-z0-9]{3,}\b/g) || [];
}

function escapeRx(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function withinOneSubstitutionStrict(a, b) {
  if (a.length !== b.length) return false;
  if (a.length < 4) return a === b;
  if (a[0] !== b[0] || a[a.length - 1] !== b[b.length - 1]) return false;
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

//#region [BLK06] PARSE • splitBlocks, parseBlock, forEachBlock

function sanitize(s) {
  return String(s)
    .replace(/\uFEFF/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n");
}

function splitBlocks(txt) {
  return sanitize(txt)
    .split(/^\s*-{5,}\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

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

function parseBlock(block, idx, fileUrl, sourceLabel) {
  const lines = block.split("\n");
  const firstIdx = lines.findIndex((l) => l.trim().length > 0);
  const first = firstIdx >= 0 ? lines[firstIdx].trim() : `Bloco ${idx + 1}`;
  const bodyLines = lines.slice(firstIdx + 1);

  // Captura link (se houver) e remove do corpo
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
    text: full,
    _bag,
    fileUrl,
    videoUrl: videoLink || null
  };
}

//#region [BLK07] DATA • Catálogo, fetch, cache

function toRawGitHub(url){
  if (!url) return url;
  const m = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^]+)$/);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  return url;
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

async function parseFile(url, sourceLabel) {
  if (state.cacheParsed.has(url)) return state.cacheParsed.get(url);
  const txt = await fetchText(url);
  const blocks = splitBlocks(txt);
  const items = blocks.map((b, i) => parseBlock(b, i, url, sourceLabel));
  state.cacheParsed.set(url, items);
  return items;
}

//#region [BLK08] SEARCH • predicados, preview, expand, doSearch (com aceleração)

function tokenize(query) {
  const src = String(query || "");
  const q = norm(src);

  const phraseRe = /"([^"]+)"/g;
  const phrases = [];
  let m;
  while ((m = phraseRe.exec(src)) !== null) {
    const p = m[1].trim();
    if (p.length >= 2) phrases.push(p);
  }
  window.__phrases = phrases;

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

function detectQueryMode(normQuery) {
  const trimmed = normQuery.trim();
  if (/^(art\.?\b|artigo\b)/i.test(trimmed)) return "art";
  if (/^s[uú]mula\b/i.test(trimmed)) return "sumula";
  return null;
}

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
  if (__searchAbort) try { __searchAbort.abort(); } catch (_) {}
  __searchAbort = new AbortController();
  const { signal } = __searchAbort;

  const termRaw = (els.q.value || "").trim();
  if (!termRaw) return;

  saveToHistory(termRaw);

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
    const s = document.createElement("div");
    s.className = "skel block";
    skel.appendChild(s);
  }
  els.stack.append(skel);
  els.spinner?.classList.add("show");

  try {
    const normQuery = norm(term);
    const queryMode = detectQueryMode(normQuery);
    const codeInfo = detectCodeFromQuery(normQuery);
    let tokens = tokenize(normQuery);

    if (!tokens.length && (!window.__phrases || window.__phrases.length === 0)) {
      skel.remove();
      window.renderBlock(termRaw, [], []);
      toast("Use palavras com 3+ letras ou números (1–4 dígitos).");
      return;
    }

    if (codeInfo) {
      tokens = tokens.filter((tk) => !codeInfo.keyWords.has(tk));
    }

    if (queryMode === "art") tokens = tokens.filter(t => !/^art(?:\.|igo)?$/i.test(t));
    if (queryMode === "sumula") tokens = tokens.filter(t => !/^s[uú]mula$/i.test(t));

    const phrases = Array.isArray(window.__phrases) ? window.__phrases : [];
    window.searchTokens = (tokens.length ? tokens : buildTokens(els.q?.value)).concat(phrases);

    const queryHasLegalKeyword = KW_RX.test(normQuery);
    const { wordTokens, numTokens } = splitTokens(tokens);

    let allOptions = Array.from(els.codeSelect?.querySelectorAll("option") || [])
      .map((o) => ({ url: (o.value || "").trim(), label: (o.textContent || "").trim() }))
      .filter((o) => o.url);

    if (codeInfo) {
      allOptions = allOptions.filter((o) => o.label === codeInfo.label);
      if (!allOptions.length) {
        toast(`Não achei o arquivo para “${codeInfo.label}”. Confira o rótulo do catálogo.`);
      }
    }

    allOptions.sort((a, b) => {
      const pa = pathPriority(a.url);
      const pb = pathPriority(b.url);
      if (pa !== pb) return pa - pb;
      if (a.label !== b.label) return a.label.localeCompare(b.label);
      return a.url.localeCompare(b.url);
    });

    const lazyGroups = [];

    for (const { url, label } of allOptions) {
      try {
        const predicate = (it) => {
          const bag = it._bag || norm(stripThousandDots(it.text));
          const okWords = hasAllWordTokens(bag, wordTokens);
          const okNums = matchesNumbers(it, numTokens, queryHasLegalKeyword, queryMode);
          return okWords && okNums;
        };

        const first = await firstMatchInFile(url, label, predicate);
        if (first) {
          lazyGroups.push({ label, url, items: [first], partial: true });
          window.renderLazyResults(termRaw, lazyGroups, tokens);
        }
        if (signal.aborted) return;
      } catch (e) {
        toast(`⚠️ Não carreguei: ${label}`);
        console.warn("Falha ao buscar:", e);
      }
    }

    skel.remove();
    toast(`${lazyGroups.length} fonte(s) com resultado.`);
  } finally {
    els.stack.setAttribute("aria-busy", "false");
    els.spinner?.classList.remove("show");

    if (!window._skipFocus) els.q?.select();
    window._skipFocus = false;
  }
}

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

  const normToken = (t) => {
    if (!t) return null;
    if (typeof t === "string") return { type: t.trim().includes(" ") ? "phrase" : "term", value: t.trim() };
    if (typeof t.value === "string") return { type: (t.type === "phrase" ? "phrase" : "term"), value: t.value.trim() };
    return null;
  };

  const list = tokens.map(normToken).filter(Boolean);
  if (list.length === 0) return;

  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const toDia = (s) => esc(s).replace(/\p{L}/gu, (ch) => ch + "\\p{M}*");

  const phrases = list.filter(t => t.type === "phrase" && t.value.length > 1).map(t => toDia(t.value));
  const terms   = list.filter(t => t.type !== "phrase").map(t => toDia(t.value)).filter(Boolean);

  const rxPhrase = phrases.length ? new RegExp("(" + phrases.join("|") + ")", "giu") : null;
  const rxTerm   = terms.length   ? new RegExp("\\b(" + terms.join("|") + ")\\b", "giu") : null;

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
          mark.className = "hl " + className;
          mark.textContent = out;
          df.appendChild(mark);
        } else {
          df.appendChild(document.createTextNode(out));
        }
      }
      return { parent: df, leftover: null };
    };

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
    body.innerHTML = highlight(item.text, (window.searchTokens && window.searchTokens.length) ? window.searchTokens : tokens);
  } else {
    body.classList.add("is-collapsed");
    const tokensForHL = (window.searchTokens && window.searchTokens.length)
      ? window.searchTokens
      : (Array.isArray(tokens) ? tokens : []);
    body.innerHTML = truncatedHTML(item.text || "", tokensForHL);
  }
  body.style.cursor = "pointer";
  body.addEventListener("click", () => openReader(item));

  // marcador lateral esquerdo
  const marker = document.createElement("div");
  marker.className = "card-marker";
  marker.title = "Marcar trecho para estudar";
  marker.addEventListener("click", (e) => {
    e.stopPropagation();
    toast("Selecione o trecho que deseja estudar.");
  });
  card.appendChild(marker);

  // seleção de texto
  body.addEventListener("mouseup", (e) => {
    const selected = window.getSelection().toString().trim();
    if (selected.length > 0) {
      const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
      showSelectionPopover(rect, selected, item);
    } else {
      hideSelectionPopover();
    }
  });

  const actions = document.createElement("div");
  actions.className = "actions";

  // botão Gemini
  const geminiBtn = document.createElement("button");
  geminiBtn.type = "button";
  geminiBtn.className = "round-btn";
  geminiBtn.setAttribute("aria-label", "Estudar com Gemini");
  geminiBtn.title = "Estudar";
  geminiBtn.innerHTML = '<img src="icons/ai-gemini4.png" alt="Gemini">';
  geminiBtn.addEventListener("click", () => {
    const q = buildGeminiQueryFromItem(item);
    openExternal(`https://www.google.com/search?q=${q}&udm=50`);
  });
  actions.append(geminiBtn);

  // botão Questões
  const questoesBtn = document.createElement("button");
  questoesBtn.type = "button";
  questoesBtn.className = "round-btn";
  questoesBtn.setAttribute("aria-label", "Gerar questões");
  questoesBtn.title = "Questões";
  questoesBtn.innerHTML = '<img src="icons/ai-questoes.png" alt="Questões">';
  questoesBtn.addEventListener("click", () => {
    const q = buildQuestoesQueryFromItem(item);
    openExternal(`https://www.google.com/search?q=${q}&udm=50`);
  });
  actions.append(questoesBtn);

  // botão YouTube (caso item venha de vídeos)
  if (item.fileUrl?.includes("data/videos/") && item.title) {
    const query = encodeURIComponent(item.title.trim());
    const urlFinal = `https://m.youtube.com/results?search_query=${query}`;
    const ytBtn = document.createElement("button");
    ytBtn.className = "round-btn";
    ytBtn.setAttribute("aria-label", "Ver no YouTube");
    ytBtn.innerHTML = '<img src="icons/youtube.png" alt="YouTube">';
    ytBtn.addEventListener("click", () => openExternal(urlFinal));
    actions.append(ytBtn);
  }

  // botão “Selecionar” (check)
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
  if (ctx.context !== "reader") {
    actions.append(chk);
  }

  // toggle (seta para expandir)
  if (item.text.length > CARD_CHAR_LIMIT) {
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
        body.innerHTML = highlight(item.text, (window.searchTokens && window.searchTokens.length) ? window.searchTokens : tokens);
        applyHighlights(body, (window.searchTokens && window.searchTokens.length) ? window.searchTokens : tokens);
      }
    });
    actions.append(toggle);
  }

  left.append(body, actions);
  card.append(left);
  return card;
}
//#region [BLK11] RENDER • Buckets & Results

function renderLazyResults(term, groups, tokens) {
  els.stack.innerHTML = "";

  const block = document.createElement("section");
  block.className = "block";

  const title = document.createElement("div");
  title.className = "block-title";
  title.textContent = `Busca: ‘${term}’`;
  block.appendChild(title);

  // Agrupa por categoria principal
  const buckets = new Map();

  for (const entry of groups) {
    const { main } = resolveBucket(entry.url);
    const group = renderLazyGroupSection(entry, tokens, term);

    if (!buckets.has(main)) buckets.set(main, []);
    buckets.get(main).push(group);
  }

  for (const [mainTitle, nodes] of buckets.entries()) {
    block.appendChild(renderBucket(mainTitle, nodes));
  }

  els.stack.append(block);
}
window.renderLazyResults = renderLazyResults;

function renderBlock(term, items, tokens) {
  els.stack.innerHTML = "";

  const block = document.createElement("section");
  block.className = "block";

  const title = document.createElement("div");
  title.className = "block-title";
  title.textContent = `Busca: ‘${term}’ (${items.length} resultados)`;
  block.appendChild(title);

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "block-empty";
    empty.textContent = `Nada encontrado com ‘${term}’.`;
    block.appendChild(empty);
    els.stack.append(block);
    return;
  }

  // Agrupar por arquivo (label+url)
  const fileGroups = new Map();
  for (const it of items) {
    const key = `${it.source}::${it.fileUrl}`;
    if (!fileGroups.has(key)) {
      fileGroups.set(key, { label: it.source || "Outros", url: it.fileUrl, items: [] });
    }
    fileGroups.get(key).items.push(it);
  }

  const bucketGroups = new Map();
  for (const g of fileGroups.values()) {
    const sec = document.createElement("section");
    sec.className = "group";

    const head = document.createElement("button");
    head.className = "group-head";
    head.setAttribute("aria-expanded", "false");
    head.innerHTML = `
      <span class="group-title">${g.label}</span>
      <span class="group-count">${g.items.length}</span>
      <span class="group-caret">▾</span>
    `;
    sec.appendChild(head);

    const body = document.createElement("div");
    body.className = "group-body";
    body.hidden = true;

    // Ranking leve
    const normTerm = norm(stripThousandDots(term));
    const qMode = detectQueryMode(normTerm);
    const words = tokens.filter(t => !/^\d{1,4}$/.test(t));
    const nums  = tokens.filter(t => /^\d{1,4}$/.test(t));

    const ranked = [...g.items].sort((a, b) => {
      const sa = scoreItem(a, words, nums, normTerm, qMode);
      const sb = scoreItem(b, words, nums, normTerm, qMode);
      return sb - sa;
    });

    ranked.forEach(it => {
      const card = renderCard(it, tokens);
      body.appendChild(card);
    });

    head.addEventListener("click", () => {
      const open = head.getAttribute("aria-expanded") === "true";
      head.setAttribute("aria-expanded", open ? "false" : "true");
      body.hidden = open;
    });

    sec.appendChild(body);

    const { main } = resolveBucket(g.url);
    if (!bucketGroups.has(main)) bucketGroups.set(main, []);
    bucketGroups.get(main).push(sec);
  }

  for (const [mainTitle, nodes] of bucketGroups.entries()) {
    block.appendChild(renderBucket(mainTitle, nodes));
  }

  els.stack.append(block);
}
window.renderBlock = renderBlock;

//#endregion
//#region [BLK12] UI • Seleção, Hub, Toasts

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
    els.viewBtn.style.pointerEvents = "none";
  }
  if (els.selCount) els.selCount.textContent = `${n}/${MAX_SEL}`;
}

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

//#region [BLK13] MODALS • Leitor

const READER_PRELOAD_PREV = 20;
const READER_PRELOAD_NEXT = 20;
const READER_BATCH_SIZE = 100;
const READER_IDLE_MS = 16;

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

async function prefetchFile(url, label) {
  try { await parseFile(url, label); } catch (_) {}
}

async function openReader(item, tokens = []) {
  if (els.readerTitle) els.readerTitle.textContent = item.source || "";
  if (els.selCount) els.selCount.textContent = `${state.selected.size}/${MAX_SEL}`;
  if (els.readerBody) els.readerBody.innerHTML = "";
  showModal(els.readerModal);

  for (let i = 0; i < 3; i++) {
    const s = document.createElement("div");
    s.className = "skel block";
    s.style.margin = "10px 0";
    els.readerBody.appendChild(s);
  }

  try {
    const items = await parseFile(item.fileUrl, item.source);
    els.readerBody.innerHTML = "";

    const anchorIdx = items.findIndex(it => it.id === item.id || it.htmlId === item.htmlId);
    const idx = anchorIdx >= 0 ? anchorIdx : 0;

    const start = Math.max(0, idx - READER_PRELOAD_PREV);
    const end   = Math.min(items.length, idx + READER_PRELOAD_NEXT + 1);
    for (let i = start; i < end; i++) {
      const card = renderCard(items[i], tokens, { context: "reader" });
      card.id = items[i].htmlId;
      els.readerBody.appendChild(card);
    }

    const phrases = Array.isArray(window.__phrases) ? window.__phrases : [];
    const searchTokens = (window.searchTokens && window.searchTokens.length) ? window.searchTokens : tokens;
    idle(() => applyHighlights(els.readerBody, searchTokens.concat(phrases)));

    const restTop = items.slice(0, start);
    const restBottom = items.slice(end);

    const list = document.createElement("div");
    list.id = "readerList";
    els.readerBody.appendChild(list);

    const tmpNodes = Array.from(els.readerBody.querySelectorAll(".card"));
    tmpNodes.forEach(n => list.appendChild(n));

    const mkBar = (pos, label, onClick) => {
      const bar = document.createElement("div");
      bar.className = "reader-loadbar";
      bar.style.cssText = "display:flex;gap:10px;align-items:center;justify-content:center;margin:12px 0;";
      bar.setAttribute("aria-live", "polite");

      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = label;

      const small = document.createElement("small");
      small.textContent = "Conteúdo grande — carregamento em lotes.";
      small.id = (pos === "top") ? "readerTopHint" : "readerBottomHint";
      btn.setAttribute("aria-describedby", small.id);

      btn.addEventListener("click", () => { btn.disabled = true; onClick(btn); });

      bar.append(btn, small);
      if (pos === "top") els.readerBody.insertBefore(bar, list);
      else els.readerBody.appendChild(bar);
      return { bar, btn };
    };

    const BATCH = READER_BATCH_SIZE;

    const loadPrevIncremental = (btn) => {
      const chunk = restTop.splice(Math.max(0, restTop.length - BATCH), BATCH);
      if (!chunk.length) { btn.closest(".reader-loadbar")?.remove(); return; }
      const frag = document.createDocumentFragment();
      chunk.forEach(it => {
        const card = renderCard(it, [], { context: "reader" });
        card.id = it.htmlId;
        frag.appendChild(card);
      });
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
      list.appendChild(frag);
      idle(() => applyHighlights(els.readerBody, (window.searchTokens || []).concat(window.__phrases || [])));
      if (restBottom.length) {
        btn.textContent = `Carregar próximos (${restBottom.length})`;
        btn.disabled = false;
      } else {
        btn.closest(".reader-loadbar")?.remove();
      }
    };

    if (restTop.length)   mkBar("top",    `Carregar anteriores (${restTop.length})`,   loadPrevIncremental);
    if (restBottom.length) mkBar("bottom", `Carregar próximos (${restBottom.length})`, loadNextIncremental);

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

//#endregion
//#region [BLK14] INIT • Autoexec, binds, ?q=, histórico

// Atualiza o contador inferior
updateBottom();

// Remove botões antigos (modo legacy)
document.getElementById("studyBtn")?.remove();
document.getElementById("questionsBtn")?.remove();

// Prepara o HUB e botões de controle
if (els.viewBtn && els.viewBtn.parentElement) {
  ensureBaseHub();
  ensureClearSelectedBtn();
  ensureBaseSpacer();
  reorderBaseControlsAndCenter();
  window.addEventListener("resize", reorderBaseControlsAndCenter);
}

// Botão “Reiniciar”
document.getElementById("resetBtn")?.addEventListener("click", () => {
  window._skipFocus = true;
  collapseAllGroupsAndScrollTop();
});

// Executa a busca automaticamente se a URL tiver ?q=
document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const q = params.get("q");
  if (q) {
    const input = document.getElementById("searchInput");
    if (input) input.value = q;
    doSearch();
  }
});

// Fecha grupos abertos e sobe pro topo
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

// Histórico de buscas
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

// Botão do histórico
document.getElementById("historyBtn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const menu = document.getElementById("historyDropdown");
  if (!menu) return;
  loadHistoryDropdown();
  menu.classList.toggle("open");
});

// Fecha dropdown se clicar fora
document.addEventListener("click", (e) => {
  const menu = document.getElementById("historyDropdown");
  if (!menu) return;
  if (!document.getElementById("historyBtn")?.contains(e.target)) {
    menu.classList.remove("open");
  }
});

