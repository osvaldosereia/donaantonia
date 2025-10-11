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
    writeSaved(Array.from(s));
    return added;
  };

  const escapeHTML = (s) => String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');

  /* ===== Toast ===== */
  let __toastTimer = null;
  function toast(msg, type='info', ms=2200){
    const t = $('#toast') || (() => {
      const el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role','status');
      document.body.appendChild(el);
      return el;
    })();
    t.className = `toast ${type}`;
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(__toastTimer);
    __toastTimer = setTimeout(() => { t.style.opacity = '0'; }, ms);
  }

  /* ===== Seeds (temas) ===== */
  async function fetchSeed(path){
    if (CACHED_FILES.has(path)) return CACHED_FILES.get(path);

    const res = await fetch(path, {cache:'no-store'});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    // Cada linha: "slug|Título|Grupo|Dispositivos|Remissões|meta: ... "
    const parsed = text.split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => {
        const [slug, title, group, dispositivos, remissoes, metaLine] = l.split('|').map(x => (x||'').trim());
        return { slug, title, group, dispositivos: (dispositivos||'').split(',').filter(Boolean), remissoes: (remissoes||'').split(',').filter(Boolean), metaLine };
      });

    CACHED_FILES.set(path, parsed);
    return parsed;
  }

  async function loadTemas(){
    try{
      const paths = [
        'data/temas/constitucional.txt',
        'data/temas/civil.txt',
        'data/temas/processual.txt',
        'data/temas/trabalhista.txt',
        'data/temas/penal.txt'
      ];

      const arrays = await Promise.all(paths.map(fetchSeed));
      const items = [];
      for (let i=0;i<arrays.length;i++){
        const group = paths[i].split('/').pop().replace('.txt','');
        arrays[i].forEach(t => {
          items.push({
            t: {
              slug: `${slugify(group)}-${t.slug}`,
              title: t.title,
              group,
              dispositivos: t.dispositivos,
              remissoes: t.remissoes,
              metaLine: t.metaLine || ''
            }
          });
        });
      }
      TEMAS = items;
    }catch(e){
      console.error('Falha ao carregar temas', e);
      toast('Falha ao carregar temas','error',2600);
    }
  }

  /* ===== Helpers ===== */
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
    if(/m$/.test(w))  return `(?:${escRx(w)}|${escRx(s1+'ns')}|${escRx(s1+'m')})`;
    if(/l$/.test(w))  return `(?:${escRx(w)}|${escRx(s1+'is')})`;
    if(/r$/.test(w))  return `(?:${escRx(w)}|${escRx(w+'es')})`;
    return `(?:${escRx(w)}|${escRx(w+'s')})`;
  }

  function buildSmartRegex(q){
    const toks = normPT(q).split(/\s+/).filter(Boolean);
    const rx = toks.map(pluralRegexToken).join('.*');
    return new RegExp(rx,'i');
  }

  /* ===== Autocomplete ===== */
  function getDispSnippet(slug, maxLen=80){
    const file = [...CACHED_FILES.values()].flat().find(x => `${slugify(x.group||'')}-${x.slug}`===slug);
    const s = file?.metaLine || '';
    if(!s) return '';
    return s.length>maxLen ? s.slice(0,maxLen-1)+'…' : s;
  }

  function highlightTitle(title, raw){
    const rx = buildSmartRegex(raw);
    return escapeHTML(title).replace(rx, (m) => `<mark>${escapeHTML(m)}</mark>`);
  }

  let acList = null;

  function closeAcDropdown(){
    acList?.remove();
    acList = null;
  }

  function openAcDropdown(anchorInput){
    closeAcDropdown();
    const host = document.createElement('div');
    host.className = 'ac-host';
    host.innerHTML = `<div class="ac-wrap">
      <div class="ac-chips-wrap"></div>
      <ul class="ac-list" role="listbox" aria-label="Sugestões de temas"></ul>
    </div>`;
    anchorInput.parentElement.appendChild(host);
    acList = host;
  }

  function renderAc(raw){
    const input = $('#search');
    if(!acList || !input) return;

    if(!raw){
      const last = (()=>{ try{ return JSON.parse(sessionStorage.getItem(LAST_AC_KEY)||'{}'); }catch{return{}} })();
      if(last?.q){
        raw = last.q;
      }else{
        const ls = (()=>{ try{ return JSON.parse(sessionStorage.getItem(LAST_SEARCH_KEY)||'{}'); }catch{return{}} })();
        raw = ls?.q || '';
      }
    }

    const list = acList.querySelector('.ac-list');
    const chips = acList.querySelector('.ac-chips-wrap');

    if(!TEMAS?.length){
      list.innerHTML = `<li class="muted">Carregando temas…</li>`;
      chips.innerHTML = '';
      return;
    }

    let arr = TEMAS.map(x => ({
      ...x,
      norm: normPT(x.t.title + ' ' + (x.t.group||'')),
    }));

    const catList = Array.from(new Set(arr.map(x => (x.t.group||'Geral')))).sort((a,b)=>a.localeCompare(b,'pt-BR'));

    if(raw?.trim()){
      const rx = buildSmartRegex(raw.trim());
      arr = arr.filter(x => rx.test(x.norm));
    }

    if(activeCat!=='Todos'){
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
        ${catList.map(cat=>`<button type="button" class="ac-chip" data-cat="${escapeHTML(cat)}" aria-pressed="${activeCat===cat}">${escapeHTML(cat)}</button>`).join('')}
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

    chips.innerHTML = chipsHTML;
    list.innerHTML  = listHTML || `<li class="muted">Sem resultados. Tente outra busca.</li>`;

    chips.onclick = (ev)=>{
      const b = ev.target.closest('.ac-chip'); if(!b) return;
      activeCat = b.dataset.cat || 'Todos';
      renderAc(input.value||'');
    };

    list.onclick = (ev)=>{
      const a=ev.target.closest('a'); if(!a) return;
      const raw=a.getAttribute('data-q')||'';
      try{ sessionStorage.setItem(LAST_SEARCH_KEY, JSON.stringify({q: raw})); }catch{}
      acList.hidden=true;
    }
  }

  window.addEventListener('hashchange', ()=>{ if(acList) acList.hidden=true; closeAcDropdown(); });

  /* ===== Drawer ===== */
  function closeDrawer() {
    const drawer  = $('#drawer');
    const btnMenu = $('#btnMenu');
    if (!drawer) return;
    drawer.classList.remove('open');
    btnMenu?.setAttribute('aria-expanded','false');
  }
  window.__closeDrawer = closeDrawer;

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

    // Montar Prompt
    const liMont = document.createElement('li');
    const linkMont = document.createElement('a');
    linkMont.className = 'title';
    linkMont.href = '/montador/';
    linkMont.textContent = 'Montar Prompt';
    liMont.appendChild(linkMont);
    menu.appendChild(liMont);

    // Salvos
    let saved = [];
    try { saved = readSaved(); } catch {}
    const liSaved = document.createElement('li'); liSaved.className = 'item';
    const btnSaved = document.createElement('button');
    btnSaved.className = 'title';
    btnSaved.setAttribute('aria-expanded','false');
    btnSaved.innerHTML = `<span>Favoritos</span>`;
    const ulSaved = document.createElement('ul'); ulSaved.hidden = true;

    if(!saved.length){
      ulSaved.innerHTML = `<li class="muted">Nenhum favorito ainda.</li>`;
    } else {
      ulSaved.innerHTML = saved.map(slug =>
        `<li><a class="sub" href="#/tema/${escapeHTML(slug)}">${escapeHTML(slug)}</a></li>`
      ).join('');
    }

    btnSaved.addEventListener('click', () => {
      const open = btnSaved.getAttribute('aria-expanded') === 'true';
      btnSaved.setAttribute('aria-expanded', String(!open));
      ulSaved.hidden = open;
    });

    liSaved.appendChild(btnSaved);
    liSaved.appendChild(ulSaved);
    menu.appendChild(liSaved);

    // Categorias (dinâmicas)
    const groups = Array.from(new Set(TEMAS.map(x => x.t.group || 'Geral'))).sort((a,b)=>a.localeCompare(b,'pt-BR'));

    for (const group of groups) {
      const li = document.createElement('li'); li.className = 'item';
      const btn = document.createElement('button'); btn.className = 'title';
      btn.setAttribute('aria-expanded','false');
      btn.innerHTML = `<span>${escapeHTML(group)}</span>`;
      const ul = document.createElement('ul'); ul.hidden = true;

      const fix = TEMAS.filter(x => (x.t.group || 'Geral') === group);
      ul.innerHTML = fix.slice(0,30).map(x =>
        `<li><a class="sub" href="#/tema/${escapeHTML(x.t.slug)}" aria-label="Abrir tema ${escapeHTML(x.t.title)}" title="Abrir tema" data-title="${escapeHTML(x.t.title)}">${escapeHTML(x.t.title)}</a></li>`
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

  function enterHomeMode(){
    const root = document.body;
    root.classList.add('is-home');
    // recoloca search para posição padrão do header
    if (searchWrap && searchWrapParent) {
      searchWrapParent.insertBefore(searchWrap, searchWrapNext);
    }
  }

  function moveSearchTo(host){
    if(!host || !searchWrap) return;
    host.appendChild(searchWrap);
  }

  /* ===== Cards/Lista ===== */
  function cardHTML(t){
    const fav = isSaved(t.slug);
    return `
      <article class="card">
        <div class="card-head">
          <h3 class="card-title"><a href="#/tema/${escapeHTML(t.slug)}">${escapeHTML(t.title)}</a></h3>
          <button class="btn-icon save" data-slug="${escapeHTML(t.slug)}" aria-pressed="${fav}">${fav ? '★' : '☆'}</button>
        </div>
        <div class="card-meta">${escapeHTML(t.group || 'Geral')}</div>
        <div class="card-body">${escapeHTML(t.metaLine || '')}</div>
      </article>
    `;
  }

  function renderTemaList(group='Todos'){
    const root = $('#content');
    root.innerHTML = `
      <section class="wrap">
        <header class="section-head">
          <h2>${group==='Todos' ? 'Todos os temas' : escapeHTML(group)}</h2>
        </header>
        <div id="temaList" class="grid"></div>
        <div id="sentinel" class="sentinel" aria-hidden="true"></div>
      </section>`;

    const list = $('#temaList');
    list.innerHTML = '';

    let items = TEMAS.map(x=>x.t);
    if(group!=='Todos') items = items.filter(x => (x.group||'Geral') === group);

    let idx = 0;
    const step = 10;
    function loadMore(){
      const chunk = items.slice(idx, idx+step);
      idx += step;
      list.insertAdjacentHTML('beforeend', chunk.map(cardHTML).join(''));
      bindSaveButtons();
      if (idx >= items.length) observer.disconnect();
    }

    const sentinel = $('#sentinel');
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) loadMore();
      }
    }, { rootMargin: '200px' });

    observer.observe(sentinel);
    loadMore();
  }

  function bindSaveButtons(){
    $$('.btn-icon.save').forEach(btn=>{
      if(btn.dataset.bound) return;
      btn.dataset.bound='1';
      btn.addEventListener('click', ()=>{
        const slug = btn.dataset.slug;
        const added = toggleSaved(slug);
        btn.setAttribute('aria-pressed', String(added));
        btn.textContent = added ? '★' : '☆';
        toast(added ? 'Adicionado aos favoritos' : 'Removido dos favoritos');
      });
    });
  }

  /* ===== Página Sobre ===== */
  function renderSobre(){
    const root = $('#content');
    root.innerHTML = `
      <section class="wrap">
        <h2>Sobre o MeuJus</h2>
        <p>Coletânea de temas jurídicos com busca rápida e organização por categorias.</p>
        <p>Projeto aberto e em evolução.</p>
      </section>`;
  }

  /* ===== Página Tema ===== */
  async function renderTema(slug){
    const root = $('#content');
    // busca simples pelo título/slug no cache
    const all = [...CACHED_FILES.values()].flat();
    const hit = all.find(x => `${slugify(x.group||'')}-${x.slug}` === slug);

    root.innerHTML = `
      <section class="wrap">
        <a class="btn-ios" href="#/">← Voltar</a>
        <h2>${escapeHTML(hit?.title || 'Tema')}</h2>
        <div class="muted">${escapeHTML(hit?.group || '')}</div>
        <article class="doc">
          <pre>${escapeHTML(hit?.metaLine || 'Sem conteúdo disponível.')}</pre>
        </article>
      </section>`;
  }

  /* ===== Home ===== */
  function renderHome(){
    const contentEl=$('#content');
    enterHomeMode();
    contentEl.innerHTML=`
      <section class="home-hero" aria-label="Busca principal">
        <div class="home-stack">
          <div class="home-logo"><span class="b1">Meu</span><span class="b2">Jus</span></div>
          <div class="home-search-host"></div>
          <div class="chip-bar">
            <a class="btn-ios" data-variant="primary" href="/montador/">Montar Prompt</a>
          </div>
        </div>
      </section>`;
    moveSearchTo(contentEl.querySelector('.home-search-host'));
  }


  /* ===== IA — dropdown (chips verticais) ===== */
  let __iaDrop=null;
  function closeIADrop(){ if(__iaDrop){ __iaDrop.remove(); __iaDrop=null; document.removeEventListener('click', onDocCloseIADrop, true); } }
  function onDocCloseIADrop(e){ if(__iaDrop && !__iaDrop.contains(e.target)) closeIADrop(); }

  function openIADropdown(anchorBtn, title, fullText){
  closeIADrop();
  const actions = [
    {key:'resumo',        label:'Resumo'},
    {key:'detalhada',     label:'Detalhado'},
    {key:'revisao',       label:'Revisão'},
    {key:'perguntas',     label:'Perguntas Essenciais'},     
    {key:'dissertativas', label:'Questões Dissertativas'},
    {key:'objetivas',     label:'Questões Objetivas'},
    {key:'videos',        label:'Vídeos'}
  ];

  const host = document.createElement('div');
  host.className = 'ia-drop';
  host.innerHTML = `
    <div class="ia-head">${escapeHTML(title)}</div>
    <div class="ia-actions">
      ${actions.map(a=>`<button class="btn-ios" data-key="${a.key}">${a.label}</button>`).join('')}
    </div>
    <div class="ia-foot muted">Escolha uma ação</div>
  `;
  anchorBtn.parentElement.appendChild(host);
  __iaDrop = host;

  setTimeout(()=> document.addEventListener('click', onDocCloseIADrop, true), 0);
  }

  /* ===== Busca principal (header) ===== */
  function bindAutocomplete(){
    const input = $('#search');
    if(!input) return;

    input.addEventListener('focus', ()=>{
      if(!acList) openAcDropdown(input);
      renderAc(input.value);
    });

    input.addEventListener('input', ()=>{
      if(!acList) openAcDropdown(input);
      renderAc(input.value);
    });

    document.addEventListener('keydown', (e)=>{
      if(e.key==='Escape'){ closeAcDropdown(); }
    });

    // Ao navegar, fecha dropdown
    window.addEventListener('hashchange', ()=>{ if(acList) acList.hidden=true; closeAcDropdown(); });
  }

  /* ===== Router ===== */
  async function renderByRoute(){
    const hash = location.hash || '#/';
    const [_, route, arg] = hash.split('/');

    if (!TEMAS.length) {
      await loadTemas();
      renderMenu();
    }

    if (route === '') {
      renderHome();
      return;
    }
    if (route === 'sobre') {
      renderSobre();
      return;
    }
    if (route === 'tema' && arg) {
      await renderTema(arg);
      return;
    }

    // rota de categoria
    if (route === 'cat' && arg) {
      const g = arg.replace(/-/g,' ');
      renderTemaList(g);
      return;
    }

    // fallback
    renderHome();
  }

  /* ===== Eventos globais ===== */
  $('#btnMenu')?.addEventListener('click', () => {
    const drawer = $('#drawer');
    const expanded = drawer?.classList.toggle('open');
    $('#btnMenu')?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  });

  document.addEventListener('click', (e)=>{
    if(e.target.closest('#drawer')) return;
    if(e.target.closest('#btnMenu')) return;
    closeDrawer();
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

})();
