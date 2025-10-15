/* meujus – app.js (2025-10-07)
   Home minimalista (logo + busca)
   Tema com ROLAGEM INFINITA (selecionado ±5; carrega +5 por sentinela)
   Drawer funcional e dropdown centralizado no mobile
*/
;(() => {
  'use strict';

  const $  = (q, el = document) => el.querySelector(q);
  const $$ = (q, el = document) => Array.from(el.querySelectorAll(q));

  /* ===== Estado ===== */
  let TEMAS = [];
  const CACHED_FILES = new Map();
  let activeCat = 'Todos';

  const SAVED_KEY       = 'meujus:saved';
  const LAST_AC_KEY     = 'meujus:lastAc';
  const LAST_SEARCH_KEY = 'meujus:lastSearch';

  const readSaved  = () => { try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch { return []; } };
  const writeSaved = (list) => localStorage.setItem(SAVED_KEY, JSON.stringify(Array.from(new Set(list))));
  const isSaved    = (slug) => readSaved().includes(slug);

  const toggleSaved = (slug) => {
    const s = new Set(readSaved());
    const added = !s.has(slug);
    added ? s.add(slug) : s.delete(slug);
    writeSaved([...s]);
    try { window.dispatchEvent(new CustomEvent('meujus:saved-changed', { detail:{ slug, added } })); } catch {}
    return added;
  };

  const escapeHTML = (s) => String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');

  const slugify = (s) => (s||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^\w\s-]/g,'').trim().replace(/\s+/g,'-');

  /* ===== Busca helpers ===== */
  const normPT = (s) => String(s||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ç/g,'c');

  const escRx = (x) => x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

  function pluralRegexToken(w){
    if(w.length<=2) return escRx(w);
    const s2=w.slice(0,-2), s1=w.slice(0,-1);
    if(/ao$/.test(w)) return `(?:${escRx(w)}|${escRx(s2+'oes')}|${escRx(s2+'aes')}|${escRx(s2+'aos')})`;
    if(/m$/.test(w))  return `(?:${escRx(w)}|${escRx(s1+'ns')})`;
    if(/[rz]$/.test(w)) return `(?:${escRx(w)}|${escRx(w+'es')})`;
    if(/al$/.test(w)) return `(?:${escRx(w)}|${escRx(s2+'ais')})`;
    if(/el$/.test(w)) return `(?:${escRx(w)}|${escRx(s2+'eis')})`;
    if(/il$/.test(w)) return `(?:${escRx(w)}|${escRx(s2+'is')})`;
    if(/ol$/.test(w)) return `(?:${escRx(w)}|${escRx(s2+'ois')})`;
    if(/ul$/.test(w)) return `(?:${escRx(w)}|${escRx(s2+'uis')})`;
    return `(?:${escRx(w)}s?)`;
  }

  function _hitPT(hayRaw,qRaw){
    const hay=normPT(hayRaw), qn=normPT(qRaw);
    if(!hay||!qn) return 0;
    let s=0;
    if(hay===qn) s+=100;
    if(hay.includes(qn)) s+=60;
    for(const t of qn.split(/\s+/).filter(Boolean)){
      const rx=new RegExp(`(?<![a-z0-9])${pluralRegexToken(t)}(?![a-z0-9])`,'g');
      if(rx.test(hay)) s+=10;
    }
    return s;
  }

  function currentPage(){
    const h=location.hash||'#/';
    const mTema=h.match(/^#\/tema\/([^?#]+)/);
    if(mTema) return { kind:'tema', slug:decodeURIComponent(mTema[1]) };
    if(/^#\/sobre\b/.test(h)) return { kind:'sobre' };
    if(/^#\/?$/.test(h) || /^#\/home\b/.test(h)) return { kind:'home' };
    return { kind:'home' };
  }

/* ===== Normalização jurídica ===== */
const DIP_ABR = new Map(Object.entries({
  'cc':'codigo civil','cp':'codigo penal','cpc':'codigo de processo civil','cpp':'codigo de processo penal',
  'cf88':'constituicao federal','cf/88':'constituicao federal','cdc':'codigo de defesa do consumidor',
  'ctn':'codigo tributario nacional','clt':'consolidacao das leis do trabalho','eca':'estatuto da crianca e do adolescente',
  'ctb':'codigo de transito brasileiro','lindb':'lei de introducao as normas do direito brasileiro',
  'lia':'lei de improbidade administrativa','lacp':'lei da acao civil publica'
}));
function normBasic(s){
  return String(s||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/ç/g,'c').replace(/\s+/g,' ').trim();
}
function normNumbers(s){
  // 9.2.7 / 9-27 / 927. → 927 ; mantém sufixo A/B
  return s.replace(/(?<=\b\d{1,3})[.\-](?=\d{1,3}\b)/g,'')
          .replace(/(?<=\d)\.(?=\D|\b)/g,'');
}
function normOrdinals(s){
  return s.replace(/\b(\d+)\s*[º°o]\b/g,'$1')
          .replace(/\b§{1,2}\s*(\d+)\b/g,'par$1')
          .replace(/\bn[º°.]?\s*(\d+)\b/g,'numero $1');
}
function normHyphens(s){ return s.replace(/[–—]/g,'-'); }
function normAliases(s){
  // art., arts., inc., al., par. único, § → formas canônicas
  return s
    .replace(/\barts?\.\b/g,'art')
    .replace(/\binc\.\b/g,'inciso')
    .replace(/\bal\.\b/g,'alinea')
    .replace(/\bpar\.\s*unico\b/g,'paragrafo unico')
    .replace(/§§/g,'paragrafos ').replace(/§/g,'paragrafo ');
}
function normDiplomaTokens(s){
  let out = s;
  for(const [abr,full] of DIP_ABR){
    const rx = new RegExp(`\\b${abr.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'g');
    out = out.replace(rx, full);
  }
  return out;
}
function normJur(s){
  // ordem de normalização importa
  return normBasic(normDiplomaTokens(normAliases(normOrdinals(normNumbers(normHyphens(s))))));
}

/* ===== Parser de referência jurídica no query ===== */
function parseRef(q){
  const n = normJur(q);
  // art 121-a §2 inciso iv al b cc
  const art = (n.match(/\bart\s*(\d+[a-z]?)/) || [])[1] || null;
  const par = (n.match(/\bparagrafo\s*(\d+|unico)\b/) || [])[1] || null;
  const inc = (n.match(/\binciso\s*([ivx]+|\d+)\b/) || [])[1] || null;
  const ali = (n.match(/\balinea\s*([a-z])\b/) || [])[1] || null;
  // diploma amplo
  let dip = null;
  for(const full of DIP_ABR.values()){
    const rx = new RegExp(`\\b${full}\\b`,'i');
    if(rx.test(n)){ dip = full; break; }
  }
  return { art, par, inc, ali, dip, norm:n };
}
/* ===== Variantes numéricas/alfa ===== */
function normNumToken(tok){
  // ex.: "1.990" → "1990", "927-A" → "927a", "§ 2º" → "par2"
  let s = normJur(tok);
  s = s.replace(/\bparagrafo\s+(\d+|unico)\b/g,'par$1');
  s = s.replace(/(?<=\b\d{1,3})[.\-](?=\d{1,3}\b)/g,''); // remove pontos/hífens internos em números
  s = s.replace(/[\-]/g,''); // 927-a → 927a
  return s;
}
function genVariantsFromQuery(q){
  const raw = (q||'').trim();
  if(!raw) return [];
  const parts = raw.split(/[\s,;/]+/).filter(Boolean);
  const out = new Set();
  for(const p of parts){
    const n = normNumToken(p);
    if(n) out.add(n);
    // se for número puro c/ sufixo opcional (ex.: 927, 927a), gera versão com pontos de milhar
    if(/^\d+[a-z]?$/.test(n)){
      const withDots = n.replace(/(\d)(?=(\d{3})+(?!\d))/g,'$1.');
      out.add(withDots);
    }
  }
  return [...out];
}

   
  /* ===== Toast ===== */
  const toastsEl = $('#toasts');
  function toast(msg,type='info',ttl=2200){
    if(!toastsEl) return;
    const el=document.createElement('div');
    el.className=`toast ${type}`;
    el.innerHTML=`<span>${escapeHTML(msg)}</span>`;
    toastsEl.appendChild(el);
    setTimeout(()=>el.classList.add('show'),20);
    setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=>el.remove(),350); }, ttl);
  }

  /* ===== IO ===== */
  async function fetchText(path){
    const url=(path||'').replace(/^\.?\//,'');
    const res=await fetch(url,{cache:'no-store'});
    if(!res.ok){
      console.error('Fetch falhou:',url,res.status);
      toast(`Erro ao carregar ${url}`,'error',3000);
      throw new Error(`HTTP ${res.status}`);
    }
    return res.text();
  }

  function splitThemesByDelim(raw){
    const txt=raw.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim();
    return txt.split(/^\s*-{3,}\s*$/m).map(s=>s.trim()).filter(Boolean);
  }

  const normalizeHeading = (h)=> (h||'').toLowerCase()
    .replace(/\(.*?\)/g,'').replace(/[.#:]/g,' ')
    .replace(/\s+/g,' ').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').trim();

  /* ===== IA helpers ===== */
function googleIA(prompt){
  const MAX = 3800;
  let s = String(prompt||'').replace(/\s+/g,' ').trim();
  if (s.length > MAX) s = s.slice(0, MAX) + '…';
  return `https://www.google.com/search?udm=50&q=${encodeURIComponent(s)}`;
}

const IA_PROMPTS = {
  resumo:        (t, full) => `Assuma a persona de Professor de Direito e faça resumo 80/20 em tópicos com base legal, exemplo prático e links oficiais; Tema: ${t}; Texto: ${full}`,
  detalhada:     (t, full) => `Assuma a persona de Professor de Direito e produza apostila do básico ao avançado com índice→conceitos→exemplos→exercícios→leituras, citando fontes oficiais e doutrina; Tema: ${t}; Texto: ${full}`,
  mapaMental:    (t, full) => `Assuma a persona de Professor de Direito e gere mapa mental com nós, conexões e links para fontes oficiais/doutrina; Tema: ${t}; Texto: ${full}`,
  linhaTemporal: (t, full) => `Assuma a persona de Pesquisador Jurídico e monte linha do tempo com marcos legislativos/jurisprudenciais, datas e links oficiais; Tema: ${t}; Texto: ${full}`,
  comparativo:   (t, full) => `Assuma a persona de Professor de Direito e compare institutos correlatos, destacando semelhanças/diferenças/usos e citando súmulas com links; Tema: ${t}; Texto: ${full}`,
  doutrina:      (t, full) => `Assuma a persona de Pesquisador Jurídico e liste 3–5 posições doutrinárias com obra, trecho-chave e links; Tema: ${t}; Texto: ${full}`,
  controv:       (t, full) => `Assuma a persona de Professor de Direito e explique correntes A/B, entendimento predominante e impactos práticos, citando e linkando fontes; Tema: ${t}; Texto: ${full}`,
  perguntas:     (t, full) => `Assuma a persona de Orientador de Estudos e crie roteiro progressivo de perguntas/respostas com artigos aplicáveis e links; Tema: ${t}; Texto: ${full}`,
  dissertativas: (t, full) => `Assuma a persona de Orientador de Estudos e elabore 5 questões dissertativas com gabarito comentado, base legal e links oficiais; Tema: ${t}; Texto: ${full}`,
  objetivas:     (t, full) => `Assuma a persona de Orientador de Estudos e crie 10 questões objetivas (A–E) com gabarito, justificativa breve e referência legal/jurisprudencial linkada; Tema: ${t}; Texto: ${full}`,
  quiz:          (t, full) => `Assuma a persona de Orientador de Estudos e gere 10 perguntas mistas (objetivas e curtas) com gabarito e links para base legal; Tema: ${t}; Texto: ${full}`,
  flashcards:    (t, full) => `Assuma a persona de Orientador de Estudos e produza flashcards termo→definição→artigo/base com link oficial; Tema: ${t}; Texto: ${full}`,
  revisao:       (t, full) => `Assuma a persona de Coach Acadêmico/Forense e liste assertivas essenciais e checklist com artigos e links oficiais; Tema: ${t}; Texto: ${full}`,
  errosComuns:   (t, full) => `Assuma a persona de Professor de Direito e aponte confusões frequentes, corrija e cite fonte oficial com link; Tema: ${t}; Texto: ${full}`,
  glossario:     (t, full) => `Assuma a persona de Professor de Direito e crie glossário de termos técnicos com definições objetivas e links oficiais; Tema: ${t}; Texto: ${full}`,
  jurisprudenciaQuiz: (t, full) => `Assuma a persona de Coach de Jurisprudência e formule 5 questões sobre entendimentos atuais com respostas e links de julgados oficiais; Tema: ${t}; Texto: ${full}`,
  ffp:           (t, full) => `Assuma a persona de Advogado Experiente e apresente 3 exemplos de Fatos, Fundamentos e Pedidos comuns, com base legal e links oficiais; Tema: ${t}; Texto: ${full}`,
  cabimento:     (t, full) => `Assuma a persona de Advogado Experiente e indique a peça processual cabível, fundamento, requisitos e links oficiais (sem redigir a peça); Tema: ${t}; Texto: ${full}`,
  fundamentacao: (t, full) => `Assuma a persona de Advogado Experiente e extraia 3–5 fundamentos curtos para petição com artigos e links oficiais; Tema: ${t}; Texto: ${full}`,
  docsPorPedido: (t, full) => `Assuma a persona de Advogado Experiente e liste documentos/provas típicas por pedido, finalidade e base legal com link; Tema: ${t}; Texto: ${full}`,
  precedentes:   (t, full) => `Assuma a persona de Pesquisador de Jurisprudência e traga 3–5 precedentes colegiados recentes (5–10 anos) com ementa-resumo e links oficiais; Tema: ${t}; Texto: ${full}`,
  medidasUrgentes: (t, full) => `Assuma a persona de Advogado Experiente e indique medidas urgentes cabíveis, requisitos, perigo/urgência e prova mínima com links oficiais; Tema: ${t}; Texto: ${full}`,
  prescricaoCompetenciaRito: (t, full) => `Assuma a persona de Advogado Processualista e verifique prescrição/decadência e competência/rito aplicáveis com artigos e links oficiais; Tema: ${t}; Texto: ${full}`,
  roteiroAudiencia: (t, full) => `Assuma a persona de Advogado Experiente e monte roteiro de audiência com pontos a provar, perguntas-chave, objeções e base legal linkada; Tema: ${t}; Texto: ${full}`,
  cronograma:    (t, full) => `Assuma a persona de Advogado Processualista e esboce fases e prazos prováveis com gatilhos e referências legais/jurisprudenciais linkadas; Tema: ${t}; Texto: ${full}`,
  matrizPedidos: (t, full) => `Assuma a persona de Advogado Experiente e estruture pedido→fundamento→prova→observações com artigos e link oficial; Tema: ${t}; Texto: ${full}`,
  remissoes:     (t, full) => `Assuma a persona de Pesquisador Jurídico e liste súmulas, enunciados, temas repetitivos e informativos relacionados com links oficiais; Tema: ${t}; Texto: ${full}`,
  rotaPesquisa:  (t, full) => `Assuma a persona de Pesquisador Jurídico e monte consultas prontas para LexML/Planalto/Diários/jurisprudência .jus.br com sintaxes e links; Tema: ${t}; Texto: ${full}`,
  divergenciaTribunais: (t, full) => `Assuma a persona de Pesquisador de Jurisprudência e mapeie divergências relevantes entre tribunais com trechos-chave e links dos julgados; Tema: ${t}; Texto: ${full}`,
  atualizacao:   (t, full) => `Assuma a persona de Pesquisador Legislativo e verifique alterações recentes (últimos 2 anos) em Planalto/LexML/Diários, resuma mudanças e linke as fontes; Tema: ${t}; Texto: ${full}`,
  leis:          (t, full) => `Assuma a persona de Pesquisador Legislativo e pesquise leis/decretos/normas correlatas, destacando artigos relevantes e links oficiais; Tema: ${t}; Texto: ${full}`,
  // estes dois são chamados apenas com o título
  videos:        (t)       => `Assuma a persona de Orientador de Estudos e sugira 3–5 vídeoaulas no YouTube com foco didático e jurídico, incluindo canais/filtros e links; Tema: ${t}`,
  artigos:       (t)       => `Assuma a persona de Pesquisador Jurídico e indique 3–5 artigos jurídicos/acadêmicos de fontes confiáveis (JusBrasil, Migalhas, universidades) com links; Tema: ${t}`
};
   

  /* ===== Parser de chunk TXT ===== */
  function parseTemaFromChunk(chunk){
    const fixed=chunk.replace(/^\s*##\s+##\s+/mg,'## ');
    const mTitle=fixed.match(/^\s*#\s+(.+?)\s*$/m);
    if(!mTitle) return null;

    const title=mTitle[1].trim(); const slug=slugify(title);

    const rxHead=/^\s*#\s+(.+?)\s*$/mg;
    const sections=[]; let m;
    while((m=rxHead.exec(fixed))){
      const name=m[1].trim(); const nm=normalizeHeading(name);
      const start=rxHead.lastIndex;
      const prev=sections.at(-1); if(prev) prev.end=m.index;
      sections.push({raw:name, nm, start, end:fixed.length});
    }

    // Linha meta logo após o título (ex.: "- Código Civil")
    let metaLine = '';
    const titleBlock = sections[0];
    if (titleBlock) {
      const preBody = fixed.slice(titleBlock.start, titleBlock.end);
      const mMeta = preBody.match(/^\s*-\s+(.+?)\s*$/m);
      if (mMeta) metaLine = mMeta[1].trim();
    }

    const secD=sections.find(s=>/^dispositivos\s+legais\b/.test(s.nm));
    const secR=sections.find(s=>/^remissoes\s+normativas\b/.test(s.nm));

    function parseList(sec){
      if(!sec) return [];
      const body=fixed.slice(sec.start,sec.end);
      const lines=body.split('\n');
      const out=[]; let last=null;
      for(const rawLine of lines){
        const L=rawLine.replace(/\r/g,'').trimEnd();
        if(!L.trim()) continue;
        if(/^\s*#\s+/.test(L)) break;
        if(/^\s*-{5}\s*$/.test(L)) break;
        if(/^\s*-{4}\s*$/.test(L)) continue;

        if(/^\s*--\s+/.test(L)){
          const c=L.replace(/^\s*--+\s*/,'').trim();
          if(last){ (last.comentarios||(last.comentarios=[])).push(c); }
          continue;
        }
        if(/^\s*-\s+/.test(L)){
          const texto=L.replace(/^\s*-+\s*/,'').trim();
          last={texto, comentario:null}; out.push(last);
          continue;
        }
      }
      return out;
    }

    const dispositivos=parseList(secD);
    const remissoes   =parseList(secR);

    const mkLink = (txt) => googleIA(IA_PROMPTS.detalhada(title, `${txt}`));
for (const it of dispositivos) it.link = mkLink(`${title} — ${it.texto}`);
// Remissões: usa só o texto do item (sem o título do card)
for (const it of remissoes)    it.link = googleIA(IA_PROMPTS.detalhada(it.texto, it.texto));


const dispText=dispositivos.map(x=>[x.texto,(x.comentarios||[]).join(' ')].filter(Boolean).join(' ')).join(' ');
const remText =remissoes.map(x=>[x.texto,(x.comentarios||[]).join(' ')].filter(Boolean).join(' ')).join(' ');
const fullRaw = [title, dispText, remText].filter(Boolean).join(' ');

return {
  slug, title, dispositivos, remissoes,
  titleN: normJur(title),
  dispN:  normJur(dispText),
  remN:   normJur(remText),
  bodyN:  normJur(fullRaw),   // TODO CORPO: dispositivos + remissões + comentários + título
  metaLine
};
  }

  /* ===== Highlight ===== */
  function _buildHighlightRegex(q){
    const parts=String(q||'').toLowerCase().split(/\s+/)
      .filter(w=>w.length>=4 && /[\p{L}]/u.test(w) && !/^\d+$/.test(w))
      .map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
    if(!parts.length) return null;
    try{ return new RegExp(`(?<!\\p{L})(${parts.join('|')})(?!\\p{L})`,'uig'); }
    catch{ return new RegExp(`(^|[^\\p{L}])(${parts.join('|')})(?!\\p{L})`,'uig'); }
  }

  function highlightTitle(title,q){
    const esc=String(title).replace(/</g,'&lt;');
    const rx=_buildHighlightRegex(q); if(!rx) return esc;
    if(rx.source.startsWith('(^|')){
      return esc.replace(rx,(m,prefix,word)=>(prefix||'')+'<mark>'+word+'</mark>');
    }
    return esc.replace(rx,'<mark>$1</mark>');
  }

  const fmtInlineBold=(html)=>String(html).replace(/\*([^*]+)\*/g,'<strong>$1</strong>');

  /* Snippet do 1º dispositivo legal (até 60 chars; 1ª linha) */
  function getDispSnippet(slug, max = 60){
    for (const arr of CACHED_FILES.values()){
      const hit = arr.find(x => x.slug === slug);
      if (hit && hit.dispositivos?.length){
        const txt = String(hit.dispositivos[0].texto || '');
        return txt.length > max ? txt.slice(0, max - 1) + '…' : txt;
      }
    }
    return '';
  }

  /* ===== Dropdown pós-busca ===== */
  let __popEl=null;
  function closeAcDropdown(){
    if(__popEl){ __popEl.remove(); __popEl=null; }
    document.removeEventListener('click',onDocClickClose,true);
    window.removeEventListener('hashchange', closeAcDropdown, { once:true });
  }
  function onDocClickClose(e){ if(__popEl && !__popEl.contains(e.target)) closeAcDropdown(); }

  /* ===== Autocomplete ===== */
  let input=$('#search');
  let acList=$('#suggestions');
  if(acList) acList.hidden=true;

 function scoreFields(q,t){
  const ref = parseRef(q);
  // base: título + dispositivos + remissões + CORPO COMPLETO
  let s = 1.2*_hitPT(t.titleN, ref.norm)
        + 1.0*_hitPT(t.dispN||'', ref.norm)
        + 0.9*_hitPT(t.remN||'',  ref.norm)
        + 0.8*_hitPT(t.bodyN||'', ref.norm);

  // boost por referência explícita (art/§/inc/al)
  if(ref.art){
    const artRX = new RegExp(`\\bart\\s*${ref.art}\\b`);
    if(artRX.test(t.titleN) || artRX.test(t.dispN||'') || artRX.test(t.bodyN||'')) s += 120;
  }
  if(ref.par && (new RegExp(`\\b(par|§)\\s*${ref.par}\\b`).test(t.bodyN||''))) s += 45;
  if(ref.inc && (new RegExp(`\\binciso\\s*(${ref.inc})\\b`).test(t.bodyN||''))) s += 40;
  if(ref.ali && (new RegExp(`\\balinea\\s*${ref.ali}\\b`).test(t.bodyN||''))) s += 35;

  // variantes numéricas/alfa — cobre "1990", "1.990", "927a", "927-a"
  const vars = genVariantsFromQuery(q);
  for(const v of vars){
    if(v && (t.bodyN||'').includes(normJur(v))) s += 90;
  }

  // diploma coerente com a categoria
  if(ref.dip){
    const g = t.groupN || normJur(t.group||'');
    if(g.includes(ref.dip)) s += 80;
  }

  // proximidade simples
  if(/\bart\b/.test(ref.norm) && /\d/.test(ref.norm) && /\bart\b/.test(t.titleN) && /\d/.test(t.titleN)) s += 20;

  return { score: s };
}



  function bindAutocomplete(){
    input=$('#search');
    acList=$('#suggestions');
    if(acList) acList.hidden=true;
    input?.addEventListener('input',onInputAC);
    input?.addEventListener('keydown',onKeydownAC);
    acList?.addEventListener('click',onClickAC);
  }

  function onInputAC(e){
  const raw = (e.target.value||'').trim();   // o que o usuário digitou
  const q   = normJur(raw);                  // normalizado p/ matching

  if(q.length<2 || !TEMAS.length){
    acList.innerHTML=''; acList.hidden=true; closeAcDropdown(); return;
  }

  let arr = TEMAS.map(t=>({t, ...scoreFields(q,t)}))
    .filter(x=>x.score>0)
    .sort((a,b)=> b.score-a.score || a.t.title.localeCompare(b.t.title,'pt-BR'))
    .slice(0,40);

  if(!arr.length){ acList.innerHTML=''; acList.hidden=true; closeAcDropdown(); return; }

  const counts=new Map();
  for(const x of arr){ const g=x.t.group||'Geral'; counts.set(g,(counts.get(g)||0)+1); }
  const catList=[...counts.keys()].sort((a,b)=> a.localeCompare(b,'pt-BR'));

  if(activeCat && activeCat!=='Todos'){
    const filtered=arr.filter(x=>(x.t.group||'Geral')===activeCat);
    arr = filtered.length?filtered:arr;
  }

  const lastAc = {
    q: raw,  // guarda o texto cru
    categories: ['Todos', ...catList],
    items: arr.slice(0,20).map(x=>({ slug:x.t.slug, title:x.t.title, group:x.t.group||'Geral' }))
  };
  try{ sessionStorage.setItem(LAST_AC_KEY, JSON.stringify(lastAc)); }catch{}

  const chipsHTML = `
    <div class="ac-chips" role="group" aria-label="Filtrar sugestões por categoria">
      <button type="button" class="ac-chip" data-cat="Todos" aria-pressed="${activeCat==='Todos'}">Todos</button>
      ${catList.map(cat=>`<button type="button" class="ac-chip" data-cat="${(cat||'').replace(/"/g,'&quot;')}" aria-pressed="${activeCat===cat}">${escapeHTML(cat)}</button>`).join('')}
    </div>`;

  const listHTML = arr.slice(0,8).map(x=>{
    const { t } = x;
    const titleHTML = highlightTitle(t.title, raw);   // usa normalizado p/ destaque
    const snippet   = getDispSnippet(t.slug, 60);
    return `<li role="option">
      <a href="#/tema/${t.slug}" data-q="${escapeHTML(raw)}">
        <div class="s1">${titleHTML}</div>
        ${snippet ? `<div class="s3">${escapeHTML(snippet)}</div>` : ''}
        <div class="s2">${escapeHTML(t.group || 'Geral')}</div>
      </a>
    </li>`;
  }).join('');

  acList.innerHTML = chipsHTML + listHTML;
  acList.hidden = false;

  acList.querySelectorAll('.ac-chip').forEach(btn=>{
    btn.addEventListener('click',()=>{
      activeCat=btn.getAttribute('data-cat')||'Todos';
      input.dispatchEvent(new Event('input',{bubbles:false}));
    });
  });
}

function onKeydownAC(ev){
  if(ev.key==='Enter'){
    const a=acList?.querySelector('a');
    if(a){
      const raw=a.getAttribute('data-q')||'';
      try{ sessionStorage.setItem(LAST_SEARCH_KEY, JSON.stringify({q: raw})); }catch{}
      location.hash=a.getAttribute('href');
      acList.hidden=true;
    }
  }
}

function onClickAC(ev){
  const a=ev.target.closest('a'); if(!a) return;
  const raw=a.getAttribute('data-q')||'';
  try{ sessionStorage.setItem(LAST_SEARCH_KEY, JSON.stringify({q: raw})); }catch{}
  acList.hidden=true;
}


  window.addEventListener('hashchange', ()=>{ if(acList) acList.hidden=true; closeAcDropdown(); });

  /* ===== Drawer ===== */
  function closeDrawer() {
    const drawer  = $('#drawer');
    const btnMenu = $('#btnMenu');
    if (!drawer) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('noscroll');
    if (btnMenu) { btnMenu.setAttribute('aria-expanded', 'false'); try{ btnMenu.focus(); }catch{} }
    $$('#menuList .cat-btn[aria-expanded="true"]').forEach(b => {
      b.setAttribute('aria-expanded','false');
      const ul=b.parentElement?.querySelector('.sublist'); if(ul) ul.hidden=true;
    });
  }

  function renderMenu(){
    const menu = $('#menuList');
    if (!menu) return;

    if (!menu.dataset.bound) {
      menu.addEventListener('click', (e) => {
        const a = e.target.closest('a.title');
        if (a) {
          e.stopPropagation();
          if (window.__closeDrawer) window.__closeDrawer();
          else closeDrawer();
        }
      });
      menu.dataset.bound = '1';
    }

    menu.innerHTML = '';

    // Sobre
    const liSobre = document.createElement('li');
    const linkSobre = document.createElement('a');
    linkSobre.className = 'title';
    linkSobre.href = '#/sobre';
    linkSobre.textContent = 'Sobre';
    liSobre.appendChild(linkSobre);
    menu.appendChild(liSobre);

    // Salvos
    let saved = [];
    try { saved = readSaved(); } catch {}
    const liSaved = document.createElement('li'); liSaved.className = 'item';
    const btnSaved = document.createElement('button');
    btnSaved.className = 'cat-btn'; btnSaved.type = 'button';
    btnSaved.setAttribute('aria-expanded', 'false');
    btnSaved.innerHTML = `<span>Salvos</span><span class="caret">▸</span>`;
    const ulSaved = document.createElement('ul'); ulSaved.className = 'sublist'; ulSaved.hidden = true;

    if (saved.length) {
      const map = new Map(TEMAS.map(t => [t.slug, t]));
      ulSaved.innerHTML = saved.map(slug => {
        const t = map.get(slug); if (!t) return '';
        return `<li>
          <a class="title" href="#/tema/${t.slug}">${escapeHTML(t.title)}</a>
          <button class="mini" data-remove="${t.slug}" type="button">Remover</button>
        </li>`;
      }).join('');
    } else {
      ulSaved.innerHTML = `<li><a class="title" href="#/sobre">Nenhum tema salvo</a></li>`;
    }

    btnSaved.addEventListener('click', () => {
      const open = btnSaved.getAttribute('aria-expanded') === 'true';
      btnSaved.setAttribute('aria-expanded', String(!open));
      ulSaved.hidden = open;
    });

    liSaved.appendChild(btnSaved);
    liSaved.appendChild(ulSaved);
    menu.appendChild(liSaved);

    ulSaved.querySelectorAll('button[data-remove]').forEach(b => {
      b.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const slug = b.getAttribute('data-remove');
        const now = toggleSaved(slug);
        toast(now ? 'Tema salvo' : 'Removido', 'info', 1400);
        renderMenu();
      });
    });

    // Separador e título
    const div = document.createElement('div'); div.className = 'divider'; menu.appendChild(div);
    const title = document.createElement('div'); title.className = 'menu-title'; title.textContent = 'Categorias'; menu.appendChild(title);

    // Categorias dinâmicas
    const byCat = new Map();
    for (const t of TEMAS) {
      const key = t.group || 'Geral';
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key).push(t);
    }
    const cats = [...byCat.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    for (const cat of cats) {
      const temas = byCat.get(cat).slice().sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));

      const li = document.createElement('li'); li.className = 'item';
      const btn = document.createElement('button');
      btn.className = 'cat-btn'; btn.type = 'button';
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = `<span>${escapeHTML(cat)}</span><span class="caret">▸</span>`;

      const ul = document.createElement('ul'); ul.className = 'sublist'; ul.hidden = true;
      ul.innerHTML = temas.map(t =>
        `<li><a class="title" href="#/tema/${t.slug}" data-path="${t.path}" data-frag="${t.frag}" data-title="${escapeHTML(t.title)}">${escapeHTML(t.title)}</a></li>`
      ).join('');

      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        ul.hidden = open;
      });

      li.appendChild(btn);
      li.appendChild(ul);
      menu.appendChild(li);
    }
  }

  /* ===== Home ===== */
  const searchWrap       = document.querySelector('.search-wrap');
  const searchWrapParent = searchWrap?.parentElement || null;
  const searchWrapNext   = searchWrap?.nextSibling || null;

  function moveSearchTo(container){ if(!searchWrap||!container) return; container.appendChild(searchWrap); bindAutocomplete(); }
  function restoreSearchToTopbar(){
    if(!searchWrap || !searchWrapParent) return;
    if(searchWrapNext && searchWrapNext.parentNode===searchWrapParent) searchWrapParent.insertBefore(searchWrap, searchWrapNext);
    else searchWrapParent.appendChild(searchWrap);
    bindAutocomplete();
  }
  function enterHomeMode(){ document.body.classList.add('is-home','route-home'); }
function leaveHomeMode(){ document.body.classList.remove('is-home','route-home'); }


  function renderHome(){
  const contentEl=$('#content');
  enterHomeMode();
  contentEl.innerHTML=`
    <section class="home-hero" aria-label="Busca principal">
      <div class="home-stack">
        <div class="home-logo"><span class="b1">Meu</span><span class="b2">Jus</span></div>
        <div class="home-search-host"></div>
      </div>
    </section>`;
  moveSearchTo(contentEl.querySelector('.home-search-host'));
}


/* ===== IA — dropdown (chips verticais) ===== */
let __iaDrop = null;
function closeIADrop() {
  if (__iaDrop) {
    __iaDrop.remove();
    __iaDrop = null;
    document.removeEventListener('click', onDocCloseIADrop, true);
  }
}
function onDocCloseIADrop(e) {
  if (__iaDrop && !__iaDrop.contains(e.target)) closeIADrop();
}

function openIADropdown(anchorBtn, title, fullText) {
  closeIADrop();

  const IA_GROUPS = {
    estudo: {
      label: '📘 Estudo',
      items: [
        { key: 'resumo',        label: 'Resumo 80/20' },
        { key: 'detalhada',     label: 'Explicação Detalhada' },
        { key: 'mapaMental',    label: 'Mapa Mental' },
        { key: 'comparativo',   label: 'Comparativo de Institutos' },
        { key: 'doutrina',      label: 'Doutrina Relevante' },
        { key: 'controv',       label: 'Controvérsias Doutrinárias' },
        { key: 'perguntas',     label: 'Perguntas Socráticas' },
        { key: 'glossario',     label: 'Glossário do Tema' },
        { key: 'flashcards',    label: 'Flashcards' }
      ]
    },
    revisao: {
      label: '🧠 Revisão',
      items: [
        { key: 'revisao',           label: 'Revisão Rápida' },
        { key: 'errosComuns',       label: 'Erros Comuns' },
        { key: 'dissertativas',     label: 'Questões Dissertativas' },
        { key: 'objetivas',         label: 'Questões Objetivas' },
        { key: 'quiz',              label: 'Quiz Misto' },
        { key: 'jurisprudenciaQuiz',label: 'Jurisprudência-Quiz' },
        { key: 'videos',            label: 'Vídeoaulas' },
        { key: 'artigos',           label: 'Artigos Jurídicos' }
      ]
    },
    pratica: {
      label: '⚖️ Prática',
      items: [
        { key: 'ffp',                      label: 'Fatos, Fundamentos e Pedidos' },
        { key: 'cabimento',                label: 'Peça Cabível (sem redigir)' },
        { key: 'fundamentacao',            label: 'Fundamentação Enxuta' },
        { key: 'docsPorPedido',            label: 'Documentos por Pedido' },
        { key: 'medidasUrgentes',          label: 'Medidas Urgentes' },
        { key: 'prescricaoCompetenciaRito',label: 'Prescrição/Competência/Rito' },
        { key: 'roteiroAudiencia',         label: 'Roteiro de Audiência' },
        { key: 'cronograma',               label: 'Cronograma Processual' },
        { key: 'matrizPedidos',            label: 'Matriz de Pedidos' },
        { key: 'precedentes',              label: 'Precedentes Prioritários' }
      ]
    },
    pesquisa: {
      label: '🔍 Pesquisa',
      items: [
        { key: 'leis',               label: 'Leis Relacionadas' },
        { key: 'remissoes',          label: 'Súmulas e Enunciados' },
        { key: 'linhaTemporal',      label: 'Linha do Tempo Legal' },
        { key: 'atualizacao',        label: 'Atualização Legislativa' },
        { key: 'rotaPesquisa',       label: 'Rota de Pesquisa Rápida' },
        { key: 'divergenciaTribunais', label: 'Divergência entre Tribunais' }
      ]
    }
  };

  __iaDrop = document.createElement('div');
  __iaDrop.className = 'ia-pop';
  document.body.appendChild(__iaDrop);

  function renderCategories() {
    __iaDrop.innerHTML = Object.entries(IA_GROUPS)
      .map(([k, g]) => `<button class="ia-item ia-cat" data-cat="${k}">${g.label}</button>`)
      .join('');
  }
  function renderSubmenu(cat) {
    const g = IA_GROUPS[cat];
    __iaDrop.innerHTML = `
      <button class="ia-item ia-back" data-back="1">◀ Voltar</button>
      ${g.items.map(a => `<button class="ia-item" data-k="${a.key}">${a.label}</button>`).join('')}
    `;
  }

  renderCategories();

  const r = anchorBtn.getBoundingClientRect();
  __iaDrop.style.left = (r.left + window.scrollX) + 'px';
  __iaDrop.style.top  = (r.bottom + window.scrollY + 6) + 'px';

  __iaDrop.addEventListener('click', (e) => {
    const cat = e.target.dataset.cat;
    const back = e.target.dataset.back;
    const k = e.target.dataset.k;

    if (cat) { renderSubmenu(cat); return; }
    if (back){ renderCategories(); return; }

    if (k) {
      const fn = IA_PROMPTS[k];
      if (!fn) return;
      const p = (k === 'videos' || k === 'artigos') ? fn(title) : fn(title, fullText);
      window.open(googleIA(p), '_blank', 'noopener');
      closeIADrop();
    }
  });

  setTimeout(() => document.addEventListener('click', onDocCloseIADrop, true), 0);
}


  /* ===== ROLAGEM INFINITA ===== */
  function buildBundle(title,dispositivos,remissoes){
    const d=(dispositivos||[]).map(it=>`- ${it.texto}${(it.comentarios&&it.comentarios.length)?`\n    Comentário: ${it.comentarios.join(' | ')}`:''}`).join('\n');
    const r=(remissoes||[]).map(it=>`- ${it.texto}${(it.comentarios&&it.comentarios.length)?`\n    Comentário: ${it.comentarios.join(' | ')}`:''}`).join('\n');
    return `Título: ${title}\n\nDispositivos Legais:\n${d}\n\nRemissões Normativas:\n${r}`;
  }

  function renderList(items){
    if(!items?.length) return '<p class="muted">Sem itens.</p>';
    return `<ul class="ref-list">` + items.map(it=>`
      <li>
        <a class="link-arrow" href="${it.link}" target="_blank" rel="noopener">
          ${fmtInlineBold(escapeHTML(it.texto))}
          <span class="arrow-icon" aria-hidden="true">↗</span>
        </a>
        ${(it.comentarios||[]).map(c=>`<div class="muted">${escapeHTML(c)}</div>`).join('')}
      </li>
    `).join('') + `</ul>`;
  }

  function renderTemaCard(container,item){
    const fullText=buildBundle(item.title,item.dispositivos,item.remissoes);
    const card=document.createElement('article');
    card.className='card ubox';
    card.dataset.slug=item.slug;

    const hasD = (item.dispositivos && item.dispositivos.length>0);
    const hasR = (item.remissoes    && item.remissoes.length>0);

    card.innerHTML=`
      <header class="ficha-head">
        <div class="actions chip-bar"></div>
        ${item.metaLine ? `<div class="card-sep"></div><div class="card-cat">${escapeHTML(item.metaLine)}</div>` : ``}
        <div class="card-sep"></div>
        <h1 class="h1">${escapeHTML(item.title)}</h1>
      </header>

      ${hasD ? `
        <section class="ubox-section">
          <h3 class="ubox-sub">Dispositivos Legais (D)</h3>
          ${renderList(item.dispositivos)}
        </section>` : ''}

      ${hasR ? `
        <section class="ubox-section">
          <h3 class="ubox-sub">Remissões Normativas (R)</h3>
          ${renderList(item.remissoes)}
        </section>` : ''}
    `;

    const actionsEl=card.querySelector('.actions');
    const mkBtn=(txt,variant,fn)=>{ const b=document.createElement('button'); b.className='btn-ios is-small'; if(variant) b.setAttribute('data-variant',variant); b.textContent=txt; b.onclick=fn; return b; };
    const saved=isSaved(item.slug);
    const saveBtn=mkBtn(saved?'Remover':'Salvar', saved?'primary':'', ()=>{
      const added=toggleSaved(item.slug);
      saveBtn.textContent=added?'Remover':'Salvar';
      if(added) saveBtn.setAttribute('data-variant','primary'); else saveBtn.removeAttribute('data-variant');
      toast(added?'Tema salvo':'Removido','info',1400);
      try { renderMenu(); } catch {}
    });
    const iaBtn = mkBtn('Google modo I.A.','');
    iaBtn.onclick = () => openIADropdown(iaBtn, item.title, fullText);
    actionsEl.append(saveBtn, iaBtn);

    container.appendChild(card);
  }

  async function ensureFileParsed(path,group){
    if(CACHED_FILES.has(path)) return CACHED_FILES.get(path);
    const raw=await fetchText(path);
    const chunks=splitThemesByDelim(raw);
    const parsed=chunks.map(parseTemaFromChunk).filter(Boolean);
    const arr=parsed.map(t=>({
      slug:`${slugify(group)}-${t.slug}`,
      title:t.title,
      group,
      metaLine: t.metaLine || '',
      dispositivos:t.dispositivos||[],
      remissoes:t.remissoes||[]
    }));
    CACHED_FILES.set(path,arr);
    return arr;
  }

  function scrollCardIntoViewTop(el){
    if(!el) return;
    el.scrollIntoView({ block:'start', behavior:'instant' in window ? 'instant' : 'auto' });
    const topbar=$('.topbar');
    const off=(topbar?.getBoundingClientRect().height || 64) + 16;
    const targetTop=el.getBoundingClientRect().top + window.scrollY - off;
    window.scrollTo({ top: Math.max(0, targetTop), left:0, behavior:'auto' });
  }

  async function loadTemaInfinite(slug){
    leaveHomeMode(); restoreSearchToTopbar();

    const meta=TEMAS.find(t=>t.slug===slug);
    if(!meta){ $('#content').innerHTML=`<div class="card ubox"><p class="muted">Tema não encontrado.</p></div>`; return; }

    const list=await ensureFileParsed(meta.path, meta.group);
    const idx=list.findIndex(x=>x.slug===slug);
    if(idx===-1){ $('#content').innerHTML=`<div class="card ubox"><p class="muted">Tema não encontrado no arquivo.</p></div>`; return; }

const host = $('#content');
host.innerHTML = `<div id="infiniteHost"></div>`;
const feed = $('#infiniteHost');

// janela inicial: selecionado ±5
let start = Math.max(0, idx - 5);
let end   = Math.min(list.length - 1, idx + 5);

// Sentinelas nas extremidades
const topSentinel    = document.createElement('div');
const bottomSentinel = document.createElement('div');
topSentinel.className = 'sentinel sentinel--top';
bottomSentinel.className = 'sentinel sentinel--bottom';
topSentinel.style.cssText = 'height:1px;';
bottomSentinel.style.cssText = 'height:1px;';
feed.prepend(topSentinel);
feed.append(bottomSentinel);

// Inserção de cards mantendo sentinelas nas pontas
function mountRange(a, b, where = 'append') {
  if (a > b) return;
  const frag = document.createDocumentFragment();
  for (let i = a; i <= b; i++) renderTemaCard(frag, list[i]);
  if (where === 'append') {
    feed.insertBefore(frag, bottomSentinel);
  } else {
    const afterTop = topSentinel.nextSibling;
    if (afterTop) feed.insertBefore(frag, afterTop);
    else feed.appendChild(frag);
  }
}

// Render inicial
mountRange(start, end, 'append');

const STEP = 5;
const io = new IntersectionObserver((entries) => {
  for (const ent of entries) {
    if (!ent.isIntersecting) continue;
    if (ent.target === bottomSentinel) {
      const nextEnd = Math.min(list.length - 1, end + STEP);
      if (nextEnd > end) { mountRange(end + 1, nextEnd, 'append'); end = nextEnd; }
    }
    if (ent.target === topSentinel) {
      const nextStart = Math.max(0, start - STEP);
      if (nextStart < start) { mountRange(nextStart, start - 1, 'prepend'); start = nextStart; }
    }
  }
}, { root: null, rootMargin: '600px 0px', threshold: 0.01 });

io.observe(bottomSentinel);
io.observe(topSentinel);

    // Atualiza hash pelo card dominante
    let rafId=0;
    const onScroll=()=>{
      if(rafId) return;
      rafId=requestAnimationFrame(()=>{
        rafId=0;
        const cards=$$('.card.ubox', feed);
        const mid=window.scrollY + window.innerHeight*0.35;
        for(const c of cards){
          const r=c.getBoundingClientRect(); const top=r.top+window.scrollY; const bottom=top+r.height;
          if(mid>=top && mid<=bottom){
            const s=c.dataset.slug;
            if(s && !location.hash.endsWith(s)) history.replaceState(null,'', '#/tema/'+s);
            break;
          }
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive:true });

    // Focar o card alvo logo abaixo da topbar
    const targetEl=feed.querySelector(`.card.ubox[data-slug="${slug}"]`);
    scrollCardIntoViewTop(targetEl);

    // Cleanup on route change
    const onHash=()=>{ io.disconnect(); window.removeEventListener('scroll', onScroll); };
    window.addEventListener('hashchange', onHash, { once:true });
  }

  /* ===== Seeds & rotas ===== */
  async function readAllSeeds(){
    const seeds=$$('#menuList a.title[data-auto="1"][data-path]');
    const temas=[];
    for(const a of seeds){
      const group=(a.dataset.group||'').trim()||'Geral';
      const path =(a.dataset.path||'').trim();
      if(!path) continue;
      try{
        const raw=await fetchText(path);
        const chunks=splitThemesByDelim(raw);
        const parsed=chunks.map(parseTemaFromChunk).filter(Boolean);
       for(const t of parsed){
  const slug = `${slugify(group)}-${t.slug}`;
  const dispN = t.dispN || '';
  const remN  = t.remN  || '';
  const body  = (dispN+' '+remN).toLowerCase();
  const groupN = normJur(group||'');
  temas.push({
    slug, title:t.title, path, group, frag:t.slug,
    titleN: t.titleN, dispN, remN, bodyN: t.bodyN, bodyL: body,
    groupN
  });
} // <-- FECHA O for

// cache com metaLine para snippets e cards
CACHED_FILES.set(path, parsed.map(t=>({
  slug:`${slugify(group)}-${t.slug}`,
  title:t.title,
  group,
  metaLine: t.metaLine || '',
  dispositivos:t.dispositivos||[],
  remissoes:t.remissoes||[]
})));

      }catch(e){
        console.error('Seed falhou',path,e);
        toast(`Erro ao ler ${path}`,'error',2800);
      }
    }
    return temas;
  }

  async function loadTemas(){
    TEMAS = await readAllSeeds();
    renderMenu();
  }

  /* ===== ROTEAMENTO / BOOT ===== */
  async function renderByRoute(){
    const page = currentPage();
    if(!TEMAS.length) await loadTemas();
    if(page.kind === 'tema'){
      await loadTemaInfinite(page.slug);
    } else if(page.kind === 'sobre'){
      $('#content').innerHTML =
        `<div class="card ubox">
           <h2 class="ubox-title">Sobre o projeto</h2>
           <p class="ubox-intro">
             TXT por tema: <code># Título</code> → <code>- Linha meta (ex.: Código Civil)</code> →
             <code># Dispositivos Legais</code> → <code># Remissões Normativas</code> → <code>-----</code>.
             Linhas com <code>- </code> são linkadas; <code>-- </code> são comentários.
             A “linha meta” é mostrada no cabeçalho do card.
           </p>
         </div>`;
      leaveHomeMode(); restoreSearchToTopbar();
    } else {
      renderHome();
    }
  }

  // Atualizar menu quando “Salvos” mudar (mesma aba)
  window.addEventListener('meujus:saved-changed', () => {
    try { renderMenu(); } catch {}
  });

  // Sincronizar Salvos entre abas/janelas
  window.addEventListener('storage', (e) => {
    if (e.key === 'meujus:saved') {
      try { renderMenu(); } catch {}
    }
  });

  // Listeners padrão
  document.querySelector('#search')?.addEventListener('focus', closeAcDropdown);
  window.addEventListener('hashchange', renderByRoute);

  // Init
  (async function init(){
    closeDrawer();
    await renderByRoute();
    bindAutocomplete();
  })();

/* =========================================
   QUIZ v2 — simples: lista (cat/tema) + execução + resumo de erros
   ========================================= */
(() => {
  // Helpers base (já existem no app — mantenho locais para isolamento)
  const $  = (q, el = document) => (el || document).querySelector(q);
  const $$ = (q, el = document) => Array.from((el || document).querySelectorAll(q));
  const CONTENT_SEL = '#content';
  const LS_KEY = 'meujus:quiz:v2';

  // Estado
  const QUIZ = {
    indexLoaded: false,
    // paths: ["codigo_civil/contratos.json", ...]
    paths: [],
    // bank: Map<cat/tema, [{id, enunciado, alternativas, ...}]>
    bank: new Map(),
    // sessão mínima
    session: null // { key, order[], i, answers:{[id]:altId}, startedAt, finishedAt? }
  };

  // Persistência mínima
  const saveLS = () => { try { localStorage.setItem(LS_KEY, JSON.stringify({ session: QUIZ.session })); } catch {} };
  const loadLS = () => { try { const d = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); if (d?.session) QUIZ.session = d.session; } catch {} };
  loadLS();

  // Util
  const html = (s='') => String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const render = (el, tpl) => { if(!el) return; el.innerHTML = tpl; try{window.__closeDrawer?.();}catch{}; el.querySelector('[data-focus]')?.focus?.(); };
  const shuffle = (arr) => arr.slice().sort(()=>Math.random()-.5);
  const keyOf = (cat, tema) => `${cat}/${tema}`;
  const parsePath = (p) => {
    // "codigo_civil/contratos.json" => {cat:"codigo_civil", tema:"contratos"}
    const m = String(p).match(/^([^/]+)\/([^/.]+)\.json$/i);
    return m ? { cat:m[1], tema:m[2] } : null;
  };

  async function getJSON(path){
    try{
      const r = await fetch(path, { cache:'no-cache' });
      if(!r.ok) return null;
      return await r.json();
    }catch{ return null; }
  }

  // ====== Loader do índice (categorias/temas) ======
  async function loadIndex(){
    if (QUIZ.indexLoaded) return;
    const idx = await getJSON('data/quizzes/index.json');
    QUIZ.paths = Array.isArray(idx) ? idx : [];
    QUIZ.indexLoaded = true;
  }

  // ====== Carrega um tema (cat/tema) ======
  async function ensureTheme(cat, tema){
    const k = keyOf(cat, tema);
    if (QUIZ.bank.has(k)) return;
    const arr = await getJSON(`data/quizzes/${cat}/${tema}.json`);
    if (Array.isArray(arr)) QUIZ.bank.set(k, arr);
  }

  // ====== Lista (dropdowns) ======
  async function viewList(){
    await loadIndex();
    const el = $(CONTENT_SEL); if (!el) return;

    // Agrupa por categoria
    const byCat = new Map();
    for (const p of QUIZ.paths){
      const pt = parsePath(p); if (!pt) continue;
      if (!byCat.has(pt.cat)) byCat.set(pt.cat, []);
      byCat.get(pt.cat).push(pt.tema);
    }

    // Ordenação simples
    for (const [cat, list] of byCat.entries()) byCat.set(cat, list.sort((a,b)=>a.localeCompare(b)));
    const cats = Array.from(byCat.keys()).sort((a,b)=>a.localeCompare(b));

    let out = `
      <section class="card ubox quiz-card" tabindex="-1" data-focus>
        <header class="card-head">
          <h2 class="h2">Quiz • Lista</h2>
          <p class="muted">Escolha um tema por categoria.</p>
        </header>

        <div class="vspace mt12">
    `;

    if (!cats.length){
      out += `<p class="muted">Nenhum quiz encontrado. Adicione arquivos em <code>data/quizzes/&lt;categoria&gt;/&lt;tema&gt;.json</code> e atualize <code>index.json</code>.</p>`;
    } else {
      for (const cat of cats){
        const temas = byCat.get(cat) || [];
        out += `
          <details class="ubox">
            <summary class="row between" style="cursor:pointer">
              <strong>${html(labelCat(cat))}</strong>
              <span class="muted">${temas.length} tema(s)</span>
            </summary>
            <div class="vspace mt8">
              ${temas.map(t => `
                <div class="row between">
                  <span>${html(labelTema(t))}</span>
                  <a class="btn" href="#/quiz/${encodeURIComponent(cat)}/${encodeURIComponent(t)}">Começar</a>
                </div>
              `).join('')}
            </div>
          </details>
        `;
      }
    }

    out += `</div></section>`;
    render(el, out);
  }

  // Rótulos humanos básicos
  function labelCat(c){ return c.replace(/_/g,' ').replace(/\b\w/g, m=>m.toUpperCase()); }
  function labelTema(t){ return t.replace(/_/g,' ').replace(/\b\w/g, m=>m.toUpperCase()); }

  // ====== Sessão ======
  function startSession(cat, tema){
    const k = keyOf(cat, tema);
    const arr = QUIZ.bank.get(k) || [];
    const order = shuffle(arr.map(q => q.id));
    QUIZ.session = { key:k, order, i:0, answers:{}, startedAt: Date.now() };
    saveLS();
  }
  const curQ = () => {
    if (!QUIZ.session) return null;
    const k = QUIZ.session.key;
    const list = QUIZ.bank.get(k) || [];
    const id = QUIZ.session.order[QUIZ.session.i];
    return list.find(q => q.id === id) || null;
  };
  const next = () => {
    if (!QUIZ.session) return false;
    if (QUIZ.session.i < QUIZ.session.order.length - 1){ QUIZ.session.i++; saveLS(); return true; }
    return false;
  };
  const prev = () => {
    if (!QUIZ.session) return false;
    if (QUIZ.session.i > 0){ QUIZ.session.i--; saveLS(); return true; }
    return false;
  };

  // ====== Execução ======
  function renderRun(){
    const el = $(CONTENT_SEL); if (!el) return;

    const q = curQ();
    if (!q){
      render(el, `
        <section class="card ubox quiz-card" tabindex="-1" data-focus>
          <header class="card-head"><h2 class="h2">Quiz</h2></header>
          <p class="muted">Nenhuma questão disponível.</p>
          <div class="mt12"><a class="btn" href="#/quiz">Voltar à lista</a></div>
        </section>
      `);
      return;
    }

    const total = QUIZ.session.order.length;
    const n = QUIZ.session.i + 1;
    const chosen = QUIZ.session.answers[q.id];

    // Feedback imediato
    const altView = q.alternativas.map(a => {
      const isSel = chosen === a.id;
      const isOk  = a.correta === true;
      // Quando já escolheu, sinalizar correto/errado
      const cls = [
        'chip',
        isSel ? 'is-selected' : '',
        chosen ? (isOk ? 'ok' : '') : ''
      ].join(' ').trim();
      return `<button class="${cls}" role="radio" aria-checked="${isSel?'true':'false'}" data-alt="${a.id}">${html(a.texto)}</button>`;
    }).join('');

    const feedback = chosen
      ? (() => {
          const alt = q.alternativas.find(a => a.id === chosen);
          const ok  = !!alt?.correta;
          const right = q.alternativas.find(a => a.correta);
          const rightText = right ? right.texto : '';
          const comment = alt?.comentario || '';
          return `
            <div class="feedback ${ok?'ok':'err'}">
              ${ok ? 'Correta.' : `Incorreta. Gabarito: ${html(rightText)}.`}
              ${comment ? ` ${html(comment)}` : ''}
            </div>
          `;
        })()
      : '';

    render(el, `
      <section class="card ubox quiz-card" tabindex="-1" data-focus>
        <header class="card-head">
          <div class="row between">
            <h2 class="h2">Quiz • ${html(q.tema || temaFromKey(QUIZ.session.key))}</h2>
            <span class="muted">${n}/${total}</span>
          </div>
          <p class="muted">${html(q.fonte || '')}</p>
        </header>

        <div class="vspace">
          <div class="enunciado">${html(q.enunciado)}</div>

          <div class="radiogroup" role="radiogroup" aria-label="Alternativas">
            ${altView}
          </div>

          ${feedback}

          <div class="row gap mt12">
            <button class="btn outline" data-prev ${QUIZ.session.i===0?'disabled':''}>Anterior</button>
            <button class="btn" data-next ${QUIZ.session.i===total-1?'disabled':''}>Próxima</button>
            <button class="btn ghost" data-exit>Sair</button>
          </div>
        </div>
      </section>
    `);

    // Interações
    $$('.radiogroup .chip', el).forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const altId = btn.getAttribute('data-alt');
        QUIZ.session.answers[q.id] = altId;
        saveLS();
        renderRun(); // re-render para feedback
      });
    });
    $('[data-next]', el)?.addEventListener('click', ()=>{
      if (!next()){ // acabou
        QUIZ.session.finishedAt = Date.now(); saveLS(); renderSummary();
      } else { renderRun(); }
    });
    $('[data-prev]', el)?.addEventListener('click', ()=>{ if (prev()) renderRun(); });
    $('[data-exit]', el)?.addEventListener('click', ()=>{ history.length > 1 ? history.back() : (location.hash = '#/'); });
  }

  function temaFromKey(k){ return k.split('/')[1] || ''; }

  // ====== Resumo — só erros e gabaritos ======
  function renderSummary(){
    const el = $(CONTENT_SEL); if (!el || !QUIZ.session) return;
    const k = QUIZ.session.key;
    const list = QUIZ.bank.get(k) || [];
    const ids = QUIZ.session.order;

    const erros = [];
    for (const id of ids){
      const q = list.find(x => x.id === id);
      if (!q) continue;
      const chosen = QUIZ.session.answers[id];
      const ok = q.alternativas.some(a => a.id === chosen && a.correta);
      if (!ok) erros.push(q);
    }

    const wrongList = erros.map(q=>{
      const right = (q.alternativas.find(a=>a.correta) || {}).texto || '';
      return `<li class="vspace-sm">
        <div><strong>${html(q.tema || temaFromKey(k))}</strong> — ${html(q.enunciado)}</div>
        <div class="muted">Gabarito: ${html(right)}</div>
      </li>`;
    }).join('');

    render(el, `
      <section class="card ubox quiz-card" tabindex="-1" data-focus>
        <header class="card-head">
          <h2 class="h2">Gabarito • Erros (${erros.length})</h2>
        </header>

        <div class="vspace">
          ${erros.length ? `<ul class="list-plain">${wrongList}</ul>` : '<p class="muted">Sem erros. Boa.</p>'}
          <div class="row gap mt12">
            <a class="btn" href="#/quiz">Voltar à lista</a>
            <button class="btn ghost" data-exit>Sair</button>
          </div>
        </div>
      </section>
    `);

    $('[data-exit]', el)?.addEventListener('click', ()=>{ history.length > 1 ? history.back() : (location.hash = '#/'); });
  }

  // ====== Roteamento ======
  function parseHash(){
    const m = (location.hash || '').match(/^#\/quiz(?:\/([^/]+)\/([^/?#]+))?$/i);
    if (!m) return null;
    const cat = m[1] ? decodeURIComponent(m[1]) : null;
    const tema = m[2] ? decodeURIComponent(m[2]) : null;
    return { cat, tema };
  }

  async function handleRoute(){
    const r = parseHash();
    if (!r) return false;

    // Página de lista
    if (!r.cat || !r.tema){
      await viewList();
      return true;
    }

    // Execução
    await ensureTheme(r.cat, r.tema);
    if (!QUIZ.bank.has(keyOf(r.cat, r.tema))){
      const el = $(CONTENT_SEL);
      render(el, `
        <section class="card ubox quiz-card" tabindex="-1" data-focus>
          <header class="card-head"><h2 class="h2">Quiz</h2></header>
          <p class="muted">Não foi possível carregar <code>${html(r.cat)}/${html(r.tema)}.json</code>.</p>
          <div class="mt12"><a class="btn" href="#/quiz">Voltar</a></div>
        </section>
      `);
      return true;
    }

    // Nova sessão se mudou de tema
    const k = keyOf(r.cat, r.tema);
    if (!QUIZ.session || QUIZ.session.key !== k){
      startSession(r.cat, r.tema);
    }
    if (QUIZ.session?.finishedAt) renderSummary();
    else renderRun();
    return true;
  }

  window.addEventListener('hashchange', handleRoute);
  window.addEventListener('load', handleRoute);
})();



})();
