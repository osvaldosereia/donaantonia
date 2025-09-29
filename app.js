/* ==========================
   direito.love — app.js (2025-09 • estável + SMART SEARCH v2)
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
  viewBtn: $("#viewBtn"),

  /* leitor */
  reader: $("#reader"),
  readerTitle: $("#readerTitle"),
  readerClose: $("#readerClose"),
  readerBody: $("#readerBody"),
  readerTop: $("#readerTop"),
  readerSrc: $("#readerSource"),
  readerOpenSrc: $("#readerOpenSrc"),

  /* histórico modal */
  histBtn: $("#historyBtn"),
  histList: $("#historyList"),
  histClear: $("#historyClear"),

  /* contador superior de resultados */
  count: $("#resultsCount")
};

// toasts simples
let toastTimer = null;
function toast(msg, t = 2800) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), t);
}

// normalização leve (acentos, espaços, minúsculas)
function norm(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// remove pontos de milhar (1.000 → 1000)
function stripThousandDots(s) {
  return String(s || "").replace(/(?<=\d)\.(?=\d{3}\b)/g, "");
}

// gera tokens de highlight (palavras 3+ e números)
function buildTokens(q) {
  if (!q) return [];
  return norm(q)
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => (/\d/.test(t) ? /^\d{1,4}$/.test(t) : /^\p{L}{3,}$/u.test(t)))
    .slice(0, 10);
}

/* ========== cache & fetch ========== */
const state = {
  cacheTxt: new Map(), // url -> conteudo .txt
  cacheItems: new Map(), // url -> [{title,text,...}]
  history: JSON.parse(localStorage.getItem("dl_history") || "[]")
};

function saveToHistory(q) {
  const arr = state.history.filter((x) => x !== q);
  arr.unshift(q);
  state.history = arr.slice(0, 30);
  localStorage.setItem("dl_history", JSON.stringify(state.history));
}
function renderHistory() {
  if (!els.histList) return;
  els.histList.innerHTML = "";
  state.history.forEach((q) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = q;
    b.addEventListener("click", () => {
      els.q.value = q;
      doSearch();
    });
    li.appendChild(b);
    els.histList.appendChild(li);
  });
}

/* fetch txt com cache */
async function fetchTxt(url, signal) {
  if (state.cacheTxt.has(url)) return state.cacheTxt.get(url);
  const r = await fetch(url, { signal });
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

  // bag indexável
  const bag = (first + "\n" + body)
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    id: `${fileUrl}#${idx}`,
    sourceLabel,
    fileUrl,
    title: first,
    text: body,
    _bag: bag,
    videoLink
  };
}

function sanitize(t) {
  return (t || "").replace(/\u00A0/g, " ").replace(/\r\n?/g, "\n");
}

// cria itens parseados de um .txt (com cache)
async function itemsFromURL(url, label, signal) {
  const k = `${url}::${label}`;
  if (state.cacheItems.has(k)) return state.cacheItems.get(k);
  const txt = await fetchTxt(url, signal);
  const blocks = splitBlocks(txt);
  const items = blocks.map((b, i) => parseBlock(b, i, url, label));
  state.cacheItems.set(k, items);
  return items;
}

/* ---------- busca/rules ---------- */

/* detecta intenção “art” ou “súmula” na query */
function detectQueryMode(q) {
  if (/^(?:\s*)(art(?:\.|igo)?)(?:\s+|$)/i.test(q)) return "art";
  if (/^(?:\s*)(s[uú]mula)(?:\s+|$)/i.test(q)) return "sumula";
  return null;
}

/* Dica de código jurídico a partir de palavras-chave (filtra <select>) */
function detectCodeFromQuery(q) {
  const hint = [
    { label: "Código Penal", keys: ["cp", "codigo penal", "código penal"] },
    { label: "Código Civil", keys: ["cc", "codigo civil", "código civil"] },
    { label: "CPC", keys: ["cpc", "codigo de processo civil", "código de processo civil"] },
    { label: "CPP", keys: ["cpp", "codigo de processo penal", "código de processo penal"] },
    { label: "CLT", keys: ["clt"] },
  ];
  for (const h of hint) {
    const hit = h.keys.some((k) => q.includes(k));
    if (hit) {
      const keyWords = new Set(
        h.keys
          .flatMap((s) => s.split(/\s+/))
          .map((w) => norm(w))
          .filter(Boolean)
      );
      return { label: h.label, keyWords };
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
  const rx = new RegExp(
    `(?:^|\\D)${n}(?:\\D|$)`, "g");
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

  // (b) se começou com Art/Súmula: início de linha com ≤15 chars até o número
  if (queryMode === "art" && KW_ART_RX.test(stripThousandDots(raw))) {
    const head = stripThousandDots(raw).slice(0, 60); // curto
    const idx = head.search(/\d/);
    if (idx >= 0 && idx <= 15) return true;
  }
  if (queryMode === "sumula" && KW_SUM_RX.test(stripThousandDots(raw))) {
    const head = stripThousandDots(raw).slice(0, 60);
    const idx = head.search(/\d/);
    if (idx >= 0 && idx <= 15) return true;
  }
  return true;
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
  return true;
}

// checa se bag contém todas as palavras (com plural e 1 erro leve)
function bagHasTokenWord(bag, token) {
  const words = getBagWords(bag);
  const vars = pluralVariants(token);
  for (const w of words) {
    for (const v of vars) {
      if (w === v) return true;
      if (withinOneSubstitutionStrict(w, v)) return true;
    }
  }
  return false;
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

/* ========== SMART SEARCH v2 (ranking estilo "Google-lite") ========== */
/* Drop-in: dado (query, items) -> lista ranqueada */
function computeResults(query, allItems) {
  // --- build _bag (normalizado) se faltar
  const SR_norm = s => (s || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9"'\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const it of allItems) {
    if (!it._bag) {
      const raw = `${it.title || ""}\n${it.text || it.content || ""}`;
      it._bag = SR_norm(raw);
    }
    delete it._score;
  }

  // --- tokenização da query (aspas = frase)
  const STOP = new Set(["de","da","do","das","dos","em","no","na","e","o","a","os","as","um","uma","para","por","com","sem","que","se","sobre","ao","à","as","aos","como","entre"]);
  function tokenizeQuery(q) {
    const quoted = [];
    q = (q || "").replace(/"([^"]+)"/g, (_, m) => { quoted.push(SR_norm(m)); return " "; });
    const toks = SR_norm(q).split(" ").filter(Boolean).filter(t => !STOP.has(t));
    return { quoted, toks };
  }
  const qparts = tokenizeQuery(query);

  // --- split hard/soft: números + frases = obrigatórios
  function splitHardSoft(qtoks) {
    const num  = qtoks.toks.filter(t => /^\d{1,4}([a-z]\w*)?$/.test(t)); // 30, 121, 129-a
    const soft = qtoks.toks.filter(t => !/^\d/.test(t));
    const hard = [...num, ...qtoks.quoted];
    return { hard, soft, nums: num };
  }
  const { hard, soft, nums } = splitHardSoft(qparts);

  // --- gate inicial (hard)
  let candidates = allItems.filter(it => {
    return hard.every(h => it._bag.includes(h));
  });

  // --- fallback: se nada com hard, aceita quem casar pelo menos 1 soft
  if (candidates.length === 0 && soft.length) {
    candidates = allItems.filter(it => soft.some(s => it._bag.includes(s)));
  }

  // --- DF/IDF (BM25-lite) no corpus de candidatos
  function buildDF(items) {
    const df = new Map();
    for (const it of items) {
      const seen = new Set(it._bag.split(/\s+/));
      for (const w of seen) df.set(w, (df.get(w) || 0) + 1);
    }
    return { df, N: Math.max(1, items.length) };
  }
  const DF = buildDF(candidates.length ? candidates : allItems);

  const avgdl = 2000; // heurística p/ seus cards
  function idf(term) {
    const n = DF.df.get(term) || 0;
    return Math.log((DF.N - n + 0.5) / (n + 0.5) + 1);
  }
  function tfIn(text, term) {
    const rx = new RegExp(`\\b${term.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "g");
    let c = 0; for (; rx.exec(text);) c++;
    return c;
  }
  function bm25Score(it, terms, k1 = 1.2, b = 0.75) {
    const text = it._bag;
    const dl = text.length;
    let s = 0;
    for (const t of terms) {
      const tf = tfIn(text, t);
      if (!tf) continue;
      const _idf = idf(t);
      const num = tf * (k1 + 1);
      const den = tf + k1 * (1 - b + b * (dl / avgdl));
      s += _idf * (num / den);
    }
    return s;
  }

  // --- boosts
  function proximityBoost(it, terms) {
    if (terms.length < 2) return 0;
    const arr = it._bag.split(/\s+/);
    const pos = terms.map(t => arr.indexOf(t)).filter(i => i >= 0).sort((a, b) => a - b);
    if (pos.length < 2) return 0;
    const span = pos[pos.length - 1] - pos[0] + 1;
    return span <= 8 ? 1.2 : (span <= 15 ? 0.6 : 0);
  }
  function titleBoost(it, terms) {
    const title = SR_norm(it.title || "");
    let hit = 0; for (const t of terms) if (title.includes(t)) hit++;
    return hit ? 0.8 + 0.2 * hit : 0;
  }
  function phraseBoost(it, quoted) {
    if (!quoted.length) return 0;
    let b = 0; for (const p of quoted) if (it._bag.includes(p)) b += 1.5;
    return b;
  }
  function numericExactBoost(it, numbers) {
    if (!numbers.length) return 0;
    let b = 0;
    for (const n of numbers) if (new RegExp(`\\b${n}\\b`).test(it._bag)) b += 1.2;
    return b;
  }
  function coverageBoost(it, allTerms) {
    let hit = 0; for (const t of allTerms) if (it._bag.includes(t)) hit++;
    const cov = hit / Math.max(1, allTerms.length);
    return cov >= 0.8 ? 0.6 : (cov >= 0.6 ? 0.3 : 0);
  }

  // --- score final
  const allTerms = [...hard, ...soft];
  for (const it of candidates) {
    const s1 = bm25Score(it, allTerms);
    const s2 = proximityBoost(it, allTerms);
    const s3 = titleBoost(it, allTerms);
    const s4 = phraseBoost(it, qparts.quoted);
    const s5 = numericExactBoost(it, nums);
    const s6 = coverageBoost(it, allTerms);
    it._score = s1 + s2 + s3 + s4 + s5 + s6;
  }

  // --- ordenação
  candidates.sort((a, b) => (b._score || 0) - (a._score || 0));

  // --- diversificação (evita 10 itens do mesmo arquivo)
  const seenByFile = new Map();
  const diversified = [];
  for (const it of candidates) {
    const f = it.fileUrl || "";
    const k = seenByFile.get(f) || 0;
    if (k < 3) { diversified.push(it); seenByFile.set(f, k + 1); }
    if (diversified.length >= 100) break;
  }

  return diversified;
}

/* ========== BUSCA PRINCIPAL ========== */
async function doSearch() {
  // cancel previous search if any
  if (__searchAbort) { try { __searchAbort.abort(); } catch(_){} }
  __searchAbort = new AbortController();
  const { signal } = __searchAbort;
  const termRaw = (els.q.value || "").trim();
  if (!termRaw) return;

  saveToHistory(termRaw); // histórico
  renderHistory();

  els.stack.innerHTML = "";
  els.count.textContent = "…";
  const skel = document.createElement("div");
  skel.className = "skeleton";
  for (let i = 0; i < 5; i++) {
    const s = document.createElement("div");
    s.className = "skel";
    skel.appendChild(s);
  }
  els.stack.append(skel);
  els.spinner?.classList.add("show");

  try {
    const normQuery = norm(termRaw);
    const queryMode = detectQueryMode(normQuery); // "art" | "sumula" | null

    // dica de código (cc, cp, cpc, "codigo civil", etc.)
    const codeInfo = detectCodeFromQuery(normQuery);

    // tokens válidos (palavras 3+ e números 1–4)
    let tokens = tokenize(normQuery);
    if (!tokens.length) {
      skel.remove();
      window.renderBlock?.(termRaw, [], []); // fallback (se existir)
      toast("Use palavras com 3+ letras ou números (1–4 dígitos).");
      return;
    }

    // se houve codeInfo, remove do conjunto de palavras os termos que só serviram p/ identificar o código
    if (codeInfo) {
      tokens = tokens.filter((tk) => !codeInfo.keyWords.has(tk));
    }

    // FIX: não tratar 'art', 'art.' ou 'artigo' como palavra obrigatória no modo ART
    if (queryMode === "art") {
      tokens = tokens.filter(t => !/^art(?:\.|igo)?$/i.test(t));
    }
    // FIX opcional: idem para 'súmula' no modo SUMULA
    if (queryMode === "sumula") {
      tokens = tokens.filter(t => !/^s[uú]mula$/i.test(t));
    }

    // salva tokens globais para highlight on-demand (abrir card)
    window.searchTokens = (Array.isArray(tokens) && tokens.length ? tokens : buildTokens(els.q?.value));

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
          window.renderLazyResults(termRaw, lazyGroups, tokens);
        }
      } catch (e) {
        toast(`⚠️ Não carreguei: ${label}`);
        console.warn("Falha ao buscar:", e);
      }
    }

    // fim da busca inicial (só previews)
    skel.remove();

    // carrega o resto dos matches por arquivo (em paralelo controlado)
    await loadAllMatches(lazyGroups, (loadedGroups) => {
      window.renderLazyResults(termRaw, loadedGroups, tokens);
    }, { wordTokens, numTokens, queryHasLegalKeyword, queryMode, signal });

    // === SMART SEARCH v2: ranking geral (Google-lite)
    const flatItems = [];
    for (const g of lazyGroups) {
      for (const it of (g.items || [])) {
        // garanta a preservação da origem
        if (!it.sourceLabel) it.sourceLabel = g.label;
        flatItems.push(it);
      }
    }

    const ranked = computeResults(normQuery, flatItems);
    window.renderRankedAndGroups(termRaw, ranked, lazyGroups, tokens);

  } catch (err) {
    console.error(err);
    toast("Erro na busca. Tente novamente.");
  } finally {
    els.spinner?.classList.remove("show");
  }
}

/* busca “apenas primeiro match” em um arquivo (preview) */
async function firstMatchInFile(url, label, predicate) {
  const items = await itemsFromURL(url, label, __searchAbort.signal);
  for (const it of items) {
    if (predicate(it)) return it;
  }
  return null;
}

/* carrega todos os matches de cada grupo (com limite de concorrência) */
async function loadAllMatches(lazyGroups, onPartial, ctx) {
  const CONC = 3;
  const queue = [...lazyGroups];
  const next = async () => {
    const g = queue.shift();
    if (!g) return;
    const items = await itemsFromURL(g.url, g.label, __searchAbort.signal);
    const filtered = items.filter((it) => {
      const bag = it._bag || norm(stripThousandDots(it.text));
      const okWords = hasAllWordTokens(bag, ctx.wordTokens);
      const okNums  = matchesNumbers(it, ctx.numTokens, ctx.queryHasLegalKeyword, ctx.queryMode);
      return okWords && okNums;
    });
    g.items = filtered;
    g.partial = false;
    onPartial(lazyGroups);
    await new Promise((r) => setTimeout(r, 80));
    return next();
  };
  const workers = Array.from({ length: CONC }, next);
  await Promise.all(workers);
}

/* ---------- render ---------- */

const CARD_CHAR_LIMIT = 420;

function truncatedHTML(text, tokens) {
  const full = String(text || "");
  if (full.length <= CARD_CHAR_LIMIT) {
    return highlight(full, tokens);
  }
  const head = full.slice(0, CARD_CHAR_LIMIT);
  return highlight(head + "…", tokens);
}
function openExternal(url) {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// highlight leve (pré-render)
function highlight(text, tokens) {
  if (!tokens?.length) return escapeHTML(text);
  let html = escapeHTML(text);
  for (const t of tokens) {
    const rx = new RegExp(`(${escapeRx(t)})`, "gi");
    html = html.replace(rx, '<mark>$1</mark>');
  }
  return html;
}
function escapeHTML(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt")
    .replace(/>/g, "&gt;");
}

// Aplica highlight em NÓS DE TEXTO (acento-insensível; não mexe em tags/links)
function applyHighlights(rootEl, tokens) {
  if (!rootEl || !tokens?.length) return;

  // transforma cada token em um padrão que aceita acentos: letra -> letra + \p{M}*
  const toDiacriticRx = (t) =>
    String(t)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\p{L}/gu, (m) => `${m}\\p{M}*`);

  const patterns = tokens.map(toDiacriticRx);
  const rx = new RegExp(`(${patterns.join("|")})`, "giu");

  // Walk nos nós de texto
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) textNodes.push(n);

  for (const node of textNodes) {
    const parent = node.parentNode;
    if (!parent) continue;
    const frag = document.createDocumentFragment();
    let lastIdx = 0;
    const str = node.nodeValue || "";
    for (const m of str.matchAll(rx)) {
      const i = m.index || 0;
      if (i > lastIdx) frag.appendChild(document.createTextNode(str.slice(lastIdx, i)));
      const mark = document.createElement("mark");
      mark.textContent = str.slice(i, i + m[0].length);
      frag.appendChild(mark);
      lastIdx = i + m[0].length;
    }
    if (lastIdx < str.length) frag.appendChild(document.createTextNode(str.slice(lastIdx)));
    parent.replaceChild(frag, node);
  }
}

function renderItem(item, tokens) {
  const card = document.createElement("article");
  card.className = "card";

  const head = document.createElement("header");
  head.className = "card-head";

  const h3 = document.createElement("h3");
  h3.textContent = item.title || "(sem título)";
  head.appendChild(h3);

  const src = document.createElement("span");
  src.className = "src";
  src.textContent = item.sourceLabel || "";
  head.appendChild(src);

  const body = document.createElement("div");
  body.className = "card-body is-collapsed";
  body.innerHTML = truncatedHTML(item.text || "", tokens);

  card.appendChild(head);
  card.appendChild(body);

  body.style.cursor = "pointer";
  body.addEventListener("click", () => openReader(item));

  const actions = document.createElement("div");
  actions.className = "actions";

  /* ===== TOGGLE (seta) ALINHADO À ESQUERDA ===== */
  if ((item.text || "").length > CARD_CHAR_LIMIT) {
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
        body.innerHTML = highlight(item.text || "", (window.searchTokens && window.searchTokens.length) ? window.searchTokens : tokens);
        applyHighlights(body, (window.searchTokens && window.searchTokens.length) ? window.searchTokens : tokens);
      }
    });
    head.appendChild(toggle);
  }

  /* ===== BOTÕES DE AÇÃO (AI & extras) ===== */

  // Helper: monta a query baseada no título do card
  function makeCardQuery() {
    const t = (item.title || "").trim();
    return encodeURIComponent(t);
  }

  // === ChatGPT
  const hubBtn = document.createElement("button");
  hubBtn.className = "round-btn";
  hubBtn.setAttribute("aria-label", "chatgpt");
  hubBtn.innerHTML = '<img src="icons/ai-chatgpt.png" alt="">';
  hubBtn.addEventListener("click", () => {
    const q = makeCardQuery();
    window.open(`https://chat.openai.com/?q=${q}`, "_blank", "noopener");
  });

  // === Gemini
  const geminiBtn = document.createElement("button");
  geminiBtn.className = "round-btn";
  geminiBtn.setAttribute("aria-label", "gemini");
  geminiBtn.innerHTML = '<img src="icons/ai-gemini.png" alt="Gemini">';
  geminiBtn.addEventListener("click", () => {
    const q = makeCardQuery();
    window.open(`https://www.google.com/search?q=${q}&udm=50`, "_blank", "noopener");
  });

  // === YouTube (puxar nome do canal pelo .txt e emendar o título do card) — FIX iOS
  if (item.fileUrl?.includes("data/videos/")) {
    const CHANNEL_NAMES = {
      "supremo.txt":             "tv supremo",
      "instante_juridico.txt":   "instante juridico",
      "me_julga.txt":            "me julga",
      "seus_direitos.txt":       "seus direitos",
      "direito_desenhado.txt":   "direito desenhado",
      "diego_pureza.txt":        "prof diego pureza",
      "estrategia_carreiras_juridicas.txt": "estrategia carreiras juridicas",
      "ana_carolina_aidar.txt":  "ana carolina aidar",
      "cebrian.txt":             "cebrian",
      "fonte_juridica_oficial.txt": "fonte juridica oficial",
      "paulo_henrique_helene.txt": "paulo henrique helene",
      "profnidal.txt":           "professor nidal",
      "monicarieger.txt":        "monica rieger",
      "rodrigo_castello.txt":    "rodrigo castello",
      "prof_alan_gestao.txt":    "prof alan gestao",
      "simplificando_direito_penal.txt": "simplificando direito penal",
      "geofre_saraiva.txt":      "geofre saraiva",
      "ricardo_torques.txt":     "ricardo torques",
      "prof_eduardo_tanaka.txt": "prof eduardo tanaka",
      "trilhante.txt":           "trilhante",
      "qconcurso.txt":           "qconcurso",
      "paulo_rodrigues_direito_para_a_vida.txt": "paulo rodrigues direito para a vida"
    };

    const fileName = item.fileUrl.split("/").pop().toLowerCase();
    const canalNome = CHANNEL_NAMES[fileName];

    if (canalNome) {
      const title = (item.title || "").trim();
      const rawQuery = `${canalNome} ${title}`;

      // iOS fix: NADA de trocar %20 por "+", e usar m.youtube.com
      const q = encodeURIComponent(rawQuery);
      const urlFinal = `https://m.youtube.com/results?search_query=${q}`;

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
    const fileName = (item.fileUrl.split("/").pop() || "").toLowerCase();
    const MAP_EXTRA = {
      "jusbrasil.txt":   { icon: "icons/jusbrasil.png", base: "https://www.jusbrasil.com.br/busca?q=" },
      "conjur.txt":      { icon: "icons/conjur.png",    base: "https://www.conjur.com.br/?s=" },
      "ambito.txt":      { icon: "icons/ambito.png",    base: "https://www.google.com/search?q=site:ambito-juridico.com.br+" },
      "mig.txt":         { icon: "icons/migalhas.png",  base: "https://www.migalhas.com.br/busca?q=" },
      "default.txt":     { icon: "icons/news.png",      base: "https://www.google.com/search?q=" }
    };
    const meta = MAP_EXTRA[fileName] || MAP_EXTRA["default.txt"];
    const q = encodeURIComponent((item.title || "").trim());
    const url = `${meta.base}${q}`;
    const b = document.createElement("button");
    b.className = "round-btn";
    b.innerHTML = `<img src="${meta.icon}" alt="">`;
    b.addEventListener("click", () => openExternal(url));
    actions.append(b);
  }

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
  hubBtn3.setAttribute("aria-label", "google ai");
  hubBtn3.innerHTML = '<img src="icons/ai-google.png" alt="">';
  hubBtn3.addEventListener("click", () => {
    const q = makeCardQuery();
    window.open(`https://www.google.com/search?q=${q}&udm=50`, "_blank", "noopener");
  });

  // actions
  const hub = document.createElement("div");
  hub.className = "hub";
  hub.appendChild(hubBtn);
  hub.appendChild(geminiBtn);
  hub.appendChild(hubBtn2);
  hub.appendChild(hubBtn3);
  actions.appendChild(hub);

  card.appendChild(actions);
  return card;
}

/* ---------- reader ---------- */
function openReader(item) {
  els.readerTitle.textContent = item.title || "";
  els.readerBody.innerHTML = highlight(item.text || "", window.searchTokens || []);
  applyHighlights(els.readerBody, window.searchTokens || []);
  els.readerSrc.textContent = item.sourceLabel || "";
  els.readerOpenSrc.onclick = () => openExternal(item.fileUrl);
  els.reader.classList.add("open");
  document.body.classList.add("no-scroll");
}
els.readerClose?.addEventListener("click", () => {
  els.reader.classList.remove("open");
  document.body.classList.remove("no-scroll");
});

/* ---------- results render (lazy + ranked) ---------- */
window.renderLazyResults = function (q, groups, tokens, isFinal = false) {
  // Este render é chamado durante o carregamento incremental.
  // Mostra apenas os grupos parciais.
  els.stack.innerHTML = "";

  let total = 0;
  for (const g of groups) total += (g.items?.length || 0);
  els.count.textContent = String(total);

  groups.forEach((g) => {
    const sec = document.createElement("section");
    sec.className = "group";
    const h4 = document.createElement("h4");
    h4.textContent = g.label + (g.partial ? " (parcial)" : "");
    sec.appendChild(h4);

    const list = document.createElement("div");
    list.className = "cards";

    (g.items || []).forEach((it) => {
      list.appendChild(renderItem(it, tokens));
    });

    sec.appendChild(list);
    els.stack.appendChild(sec);
  });

  if (isFinal && total === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nada encontrado. Tente variar os termos.";
    els.stack.appendChild(empty);
  }
};

window.renderRankedAndGroups = function (q, ranked, groups, tokens) {
  els.stack.innerHTML = "";

  const totalRanked = ranked.length;
  const totalGrouped = groups.reduce((acc, g) => acc + (g.items?.length || 0), 0);
  els.count.textContent = String(Math.max(totalRanked, totalGrouped));

  // 1) Bloco de Relevantes (SMART SEARCH v2)
  if (ranked.length) {
    const secTop = document.createElement("section");
    secTop.className = "group relevant";
    const h4 = document.createElement("h4");
    h4.textContent = "Relevantes";
    secTop.appendChild(h4);

    const listTop = document.createElement("div");
    listTop.className = "cards";
    ranked.forEach((it) => listTop.appendChild(renderItem(it, tokens)));
    secTop.appendChild(listTop);
    els.stack.appendChild(secTop);
  }

  // 2) Blocos originais por arquivo (para exploração manual)
  groups.forEach((g) => {
    const sec = document.createElement("section");
    sec.className = "group";
    const h4 = document.createElement("h4");
    h4.textContent = g.label;
    sec.appendChild(h4);

    const list = document.createElement("div");
    list.className = "cards";
    (g.items || []).forEach((it) => list.appendChild(renderItem(it, tokens)));
    sec.appendChild(list);
    els.stack.appendChild(sec);
  });

  if (!ranked.length && !totalGrouped) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nada encontrado. Tente variar os termos.";
    els.stack.appendChild(empty);
  }
};

/* ---------- UI: histórico ---------- */
els.histBtn?.addEventListener("click", () => {
  const modal = document.querySelector("#historyModal");
  if (!modal) return;
  renderHistory();
  modal.classList.add("open");
});
els.histClear?.addEventListener("click", () => {
  state.history = [];
  localStorage.setItem("dl_history", "[]");
  renderHistory();
  toast("Histórico limpo.");
});
document.querySelectorAll(".modal .close").forEach((b) => {
  b.addEventListener("click", (e) => e.target.closest(".modal")?.classList.remove("open"));
});

/* ---------- eventos ---------- */
els.form?.addEventListener("submit", (e) => {
  e.preventDefault();
  doSearch();
});
els.brand?.addEventListener("click", () => {
  els.q.value = "";
  els.stack.innerHTML = "";
  els.count.textContent = "0";
});
window.addEventListener("DOMContentLoaded", () => {
  const url = new URL(location.href);
  const q = url.searchParams.get("q");
  if (q) {
    els.q.value = decodeURIComponent(q);
    doSearch();
  }
});
