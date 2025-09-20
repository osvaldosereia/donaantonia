/* ============================================================
   ESTADO GLOBAL
============================================================ */
let selecionados = [];                               // [{id, codigo, texto}]
let listasSalvas = JSON.parse(localStorage.getItem("listasSalvas") || "[]");
let currentListaNome = null;                         // nome da lista ativa (overwrite)
let arquivoAtivo = null;                             // 'civil' | 'penal' | 'processo-penal'
let matchMap = { civil: [], penal: [], "processo-penal": [] }; // índices com match por arquivo
let currentMatchIdx = { civil: -1, penal: -1, "processo-penal": -1 }; // ponteiro da seta por arquivo

/* Mock de base COMPLETA por arquivo — troque depois por fetch() */
const baseArquivos = {
  civil: [
    { id: "cc_186",  codigo: "Código Civil", texto: "Art. 186 - Aquele que, por ação ou omissão voluntária, negligência ou imprudência, violar direito e causar dano a outrem, ainda que exclusivamente moral, comete ato ilícito." },
    { id: "cc_927",  codigo: "Código Civil", texto: "Art. 927 - Aquele que, por ato ilícito, causar dano a outrem, fica obrigado a repará-lo." },
    { id: "cc_944",  codigo: "Código Civil", texto: "Art. 944 - A indenização mede-se pela extensão do dano." },
    { id: "cc_945",  codigo: "Código Civil", texto: "Art. 945 - Se a vítima tiver concorrido culposamente para o evento danoso, a sua indenização será fixada tendo-se em conta a gravidade de sua culpa em confronto com a do autor do dano." }
  ],
  penal: [
    { id: "cp_145",  codigo: "Código Penal", texto: "Art. 145 - O cônjuge do ausente, sempre que não esteja separado judicialmente..." },
    { id: "cp_121",  codigo: "Código Penal", texto: "Art. 121 - Matar alguém: Pena - reclusão, de seis a vinte anos." },
    { id: "cp_129",  codigo: "Código Penal", texto: "Art. 129 - Ofender a integridade corporal ou a saúde de outrem." }
  ],
  "processo-penal": [
    { id: "cpp_312", codigo: "Código de Processo Penal", texto: "Art. 312 - A prisão preventiva poderá ser decretada como garantia da ordem pública..." },
    { id: "cpp_319", codigo: "Código de Processo Penal", texto: "Art. 319 - São medidas cautelares diversas da prisão..." }
  ]
};

/* ============================================================
   HOME (index.html)
============================================================ */
function iniciarBusca() {
  const input = document.getElementById("globalSearch");
  if (!input) return;
  const termo = (input.value || "").trim();
  if (!termo) return;
  window.location.href = `resultados.html?busca=${encodeURIComponent(termo)}`;
}

/* ============================================================
   MODAIS (listas & nova lista)
============================================================ */
function abrirModalListas() {
  renderizarListasModal();
  document.getElementById("modalListas")?.classList.remove("hidden");
}
function fecharModalListas() {
  document.getElementById("modalListas")?.classList.add("hidden");
}
function excluirTodasListas() {
  if (!confirm("Excluir TODAS as listas salvas?")) return;
  listasSalvas = [];
  localStorage.setItem("listasSalvas", JSON.stringify(listasSalvas));
  renderizarListasModal();
}

function renderizarListasModal() {
  const ul = document.getElementById("listasSalvas");
  if (!ul) return;
  ul.innerHTML = "";
  if (!listasSalvas.length) {
    const li = document.createElement("li");
    li.textContent = "Nenhuma lista salva ainda.";
    li.style.color = "#6b7280";
    ul.appendChild(li);
    return;
  }
  listasSalvas.forEach(lista => {
    const li = document.createElement("li");
    li.textContent = `${lista.nome} (${lista.itens.length})`;
    li.onclick = () => abrirLista(lista.nome);
    ul.appendChild(li);
  });
}

function abrirModalNovaLista() {
  const input = document.getElementById("nomeNovaLista");
  if (input) input.value = "";
  document.getElementById("modalNovaLista")?.classList.remove("hidden");
}
function fecharModalNovaLista() {
  document.getElementById("modalNovaLista")?.classList.add("hidden");
}

/* ============================================================
   LISTAS (abrir/salvar/nova)
============================================================ */
function abrirLista(nome) {
  const lista = listasSalvas.find(l => l.nome === nome);
  if (!lista) return;
  currentListaNome = lista.nome;
  selecionados = [...lista.itens];
  renderizarSelecionados();
  fecharModalListas();
  toast(`📂 Lista “${nome}” aberta`);
}

function salvarListaFlow() {
  // se há lista ativa, salva por cima sem modal
  if (currentListaNome) {
    salvarLista(currentListaNome);
    return;
  }
  // nova lista → abre modal para nome
  abrirModalNovaLista();
}

function confirmarCriacaoNovaLista() {
  const input = document.getElementById("nomeNovaLista");
  const nome = (input?.value || "").trim();
  if (!nome) return;
  currentListaNome = nome;
  salvarLista(nome);
  fecharModalNovaLista();
}

function salvarLista(nome) {
  if (!selecionados.length) {
    alert("Nenhum artigo selecionado.");
    return;
  }
  // overwrite
  listasSalvas = listasSalvas.filter(l => l.nome !== nome);
  listasSalvas.push({ nome, itens: selecionados });
  localStorage.setItem("listasSalvas", JSON.stringify(listasSalvas));
  toast(`💾 Lista “${nome}” salva`);
}

function iniciarNovaLista() {
  // limpa seleção e busca e pede nome
  selecionados = [];
  renderizarSelecionados();
  const campo = document.getElementById("campoBusca");
  if (campo) campo.value = "";
  currentListaNome = null;
  rebuildResultados(""); // limpa resultados
  abrirModalNovaLista();
}

/* ============================================================
   BUSCA E RENDERIZAÇÃO
============================================================ */
function getParametroBusca() {
  const params = new URLSearchParams(window.location.search);
  return params.get("busca") || "";
}

function novaBusca() {
  const campo = document.getElementById("campoBusca");
  if (!campo) return;
  const termo = (campo.value || "").trim();
  rebuildResultados(termo);
}

function rebuildResultados(termo) {
  // monta matchMap (quais índices casam) e chips só com arquivos que têm match
  matchMap = { civil: [], penal: [], "processo-penal": [] };
  currentMatchIdx = { civil: -1, penal: -1, "processo-penal": -1 };

  const t = termo.toLowerCase();
  Object.keys(baseArquivos).forEach(arq => {
    baseArquivos[arq].forEach((art, idx) => {
      if (
        !termo ||
        art.texto.toLowerCase().includes(t) ||
        art.codigo.toLowerCase().includes(t) ||
        art.id.toLowerCase().includes(t)
      ) {
        matchMap[arq].push(idx);
      }
    });
  });

  // define arquivo ativo: primeiro com match; se nenhum termo, usa 'civil'
  const filesWithMatch = Object.keys(matchMap).filter(k => matchMap[k].length);
  arquivoAtivo = filesWithMatch[0] || "civil";

  renderizarChipsArquivos(filesWithMatch);
  renderizarListaResultados(termo);
}

/* chips SÓ dos arquivos com resultado */
function renderizarChipsArquivos(filesWithMatch) {
  const cont = document.getElementById("chipsArquivos");
  if (!cont) return;
  const labels = { civil: "CIVIL", penal: "PENAL", "processo-penal": "PROCESSO PENAL" };

  cont.innerHTML = "";
  filesWithMatch.forEach(key => {
    const btn = document.createElement("button");
    btn.className = `chip ${key === arquivoAtivo ? "active" : ""}`;
    btn.dataset.arquivo = key;
    btn.textContent = labels[key];
    btn.onclick = () => {
      arquivoAtivo = key;
      renderizarChipsArquivos(filesWithMatch);
      renderizarListaResultados(document.getElementById("campoBusca")?.value || "");
    };
    cont.appendChild(btn);
  });
}

/* renderiza TODAS as entradas do arquivo ativo (colapsadas) e marca as que são match */
function renderizarListaResultados(termo) {
  const wrap = document.getElementById("resultados");
  if (!wrap) return;
  wrap.innerHTML = "";

  const lista = baseArquivos[arquivoAtivo] || [];
  const matches = new Set(matchMap[arquivoAtivo] || []);

  lista.forEach((art, idx) => {
    const isMatch = matches.has(idx);
    const jaSel = selecionados.some(s => s.id === art.id);

    const card = document.createElement("div");
    card.className = "card";
    if (isMatch) card.classList.add("match");
    card.dataset.idx = String(idx);

    card.innerHTML = `
      <div class="artigo">${art.texto}</div>
      <div class="card-actions">
        <button class="btn-pill" title="Estudar">ESTUDAR</button>
        <button class="btn-pill" title="Consultar">CONSULTAR</button>
        <button class="btn-pill btn-toggle" title="Selecionar/Deselecionar">
          ${jaSel ? '✅ SELECIONADO' : 'SELECIONAR'}
        </button>
        <button class="btn-link btn-expand" title="Expandir/Colapsar">Ver mais</button>
      </div>
    `;

    const [btnEstudar, btnConsultar, btnToggle, btnExpand] = card.querySelectorAll("button");

    btnEstudar.onclick = () => estudarArtigo(art);
    btnConsultar.onclick = () => consultarArtigo(art);
    btnToggle.onclick = () => toggleSelecionado(art, btnToggle);
    btnExpand.onclick = () => toggleExpand(card, btnExpand);

    wrap.appendChild(card);
  });

  // reseta ponteiro de navegação para o primeiro match (se houver)
  if ((matchMap[arquivoAtivo] || []).length) {
    currentMatchIdx[arquivoAtivo] = 0;
    highlightAndScrollToCurrent();
  }
}

/* Expande/colapsa (3 linhas -> completo) */
function toggleExpand(card, btnExpand) {
  card.classList.toggle("expanded");
  btnExpand.textContent = card.classList.contains("expanded") ? "Ver menos" : "Ver mais";
}

/* ============================================================
   SELECIONAR (toggle) + RENDERIZAR SELECIONADOS
============================================================ */
function toggleSelecionado(art, btn) {
  const i = selecionados.findIndex(a => a.id === art.id);
  if (i >= 0) {
    // remover
    selecionados.splice(i, 1);
    btn.textContent = "SELECIONAR";
    toast("❌ Removido dos selecionados");
  } else {
    // adicionar
    selecionados.push({ id: art.id, codigo: art.codigo, texto: art.texto });
    btn.textContent = "✅ SELECIONADO";
    toast("✅ Adicionado aos selecionados");
  }
  renderizarSelecionados();
}

/* lista “Selecionados” em 1 linha */
function renderizarSelecionados() {
  const box = document.getElementById("selecionados");
  if (!box) return;
  box.innerHTML = "";

  if (!selecionados.length) {
    const vazio = document.createElement("div");
    vazio.style.color = "#6b7280";
    vazio.style.padding = "6px 0";
    vazio.textContent = "Nenhum artigo selecionado ainda.";
    box.appendChild(vazio);
    return;
  }

  selecionados.forEach(art => {
    const item = document.createElement("div");
    item.className = "card";
    item.innerHTML = `
      <div class="info">
        <div class="titulo">${art.codigo}</div>
        <div class="resumo">${art.texto}</div>
      </div>
      <span class="badge-selected" data-id="${art.id}" title="Clique para remover">SELECIONADO</span>
    `;
    // possibilidade de remover clicando na badge
    item.querySelector(".badge-selected").onclick = () => {
      const idx = selecionados.findIndex(a => a.id === art.id);
      if (idx >= 0) selecionados.splice(idx, 1);
      renderizarSelecionados();
      // também atualiza lista de resultados para refletir botão
      renderizarListaResultados(document.getElementById("campoBusca")?.value || "");
    };
    box.appendChild(item);
  });
}

/* limpar todos os selecionados */
function limparSelecionados() {
  if (!selecionados.length) return;
  if (!confirm("Remover todos os itens selecionados?")) return;
  selecionados = [];
  renderizarSelecionados();
  renderizarListaResultados(document.getElementById("campoBusca")?.value || "");
}

/* ============================================================
   NAVEGAÇÃO POR SETAS (RESULTADOS & SELECIONADOS)
============================================================ */
function navegarResultados(dir) {
  const list = matchMap[arquivoAtivo] || [];
  if (!list.length) return;
  let cur = currentMatchIdx[arquivoAtivo];
  cur = (cur + dir + list.length) % list.length;
  currentMatchIdx[arquivoAtivo] = cur;
  highlightAndScrollToCurrent();
}

function highlightAndScrollToCurrent() {
  // remove highlights anteriores
  document.querySelectorAll("#resultados .card.is-current").forEach(el => el.classList.remove("is-current"));

  const list = matchMap[arquivoAtivo] || [];
  const idx = list[currentMatchIdx[arquivoAtivo]];
  if (idx == null) return;

  const target = document.querySelector(`#resultados .card[data-idx="${idx}"]`);
  if (!target) return;

  target.classList.add("is-current");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
}

function navegarSelecionados(dir) {
  const items = Array.from(document.querySelectorAll("#selecionados .card"));
  if (!items.length) return;

  let current = items.findIndex(el => el.classList.contains("is-current"));
  current = (current + dir + items.length) % items.length;

  items.forEach(el => el.classList.remove("is-current"));
  items[current].classList.add("is-current");
  items[current].scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ============================================================
   AÇÕES SIMULADAS
============================================================ */
function estudarArtigo(art) {
  alert("📖 Estudar artigo:\n\n" + art.texto);
}
function consultarArtigo(art) {
  // plugue aqui o link oficial quando tiver a base
  alert("🔗 Consultar oficial (simulação): " + art.codigo + " — " + art.id);
}

/* ============================================================
   TOAST
============================================================ */
function toast(msg, ms = 1400) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/* ============================================================
   BOOTSTRAP POR PÁGINA
============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  // resultados.html
  const campo = document.getElementById("campoBusca");
  if (campo) {
    const termo = getParametroBusca();
    campo.value = termo;

    // render inicial
    renderizarSelecionados();
    rebuildResultados(termo);

    // eventos
    document.getElementById("btnBuscar")?.addEventListener("click", novaBusca);
    campo.addEventListener("keydown", (e) => e.key === "Enter" && novaBusca());

    document.getElementById("btnAbrirListas")?.addEventListener("click", abrirModalListas);
    document.getElementById("btnNovaLista")?.addEventListener("click", iniciarNovaLista);

    document.getElementById("limpar-tudo")?.addEventListener("click", limparSelecionados);
    document.getElementById("salvar-lista")?.addEventListener("click", salvarListaFlow);

    // setas
    document.getElementById("navResPrev")?.addEventListener("click", () => navegarResultados(-1));
    document.getElementById("navResNext")?.addEventListener("click", () => navegarResultados(1));
    document.getElementById("navSelPrev")?.addEventListener("click", () => navegarSelecionados(-1));
    document.getElementById("navSelNext")?.addEventListener("click", () => navegarSelecionados(1));

    // modal nova lista
    document.getElementById("btnCancelarNovaLista")?.addEventListener("click", fecharModalNovaLista);
    document.getElementById("btnConfirmarNovaLista")?.addEventListener("click", confirmarCriacaoNovaLista);
  }

  // home: preparar modal (se existir)
  const listasModal = document.getElementById("modalListas");
  if (listasModal && !campo) renderizarListasModal();
});
