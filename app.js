/* ============================================================
   Estado global
============================================================ */
let selecionados = [];
let listasSalvas = JSON.parse(localStorage.getItem("listasSalvas") || "[]");
let currentListaNome = null;            // nome da lista aberta (p/ overwrite)
let resultadosPorArquivo = {};          // { civil: [...], penal: [...], 'processo-penal': [...] }
let arquivoAtivo = null;                // chave do arquivo atualmente exibido

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
   Modal de Listas (home e resultados)
============================================================ */
function abrirModalListas() {
  renderizarListasModal();
  const m = document.getElementById("modalListas");
  if (m) m.classList.remove("hidden");
}
function fecharModalListas() {
  const m = document.getElementById("modalListas");
  if (m) m.classList.add("hidden");
}
function excluirTodasListas() {
  if (!confirm("Tem certeza que deseja excluir TODAS as listas salvas?")) return;
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
    li.title = "Abrir esta lista";
    li.onclick = () => abrirLista(lista.nome);
    ul.appendChild(li);
  });
}

function abrirLista(nome) {
  const lista = listasSalvas.find(l => l.nome === nome);
  if (!lista) return;
  currentListaNome = lista.nome;
  selecionados = [...lista.itens];
  renderizarSelecionados();
  fecharModalListas();
  toast(`📂 Lista “${nome}” aberta`);
}

/* ============================================================
   RESULTADOS (resultados.html)
============================================================ */
function getParametroBusca() {
  const params = new URLSearchParams(window.location.search);
  return params.get("busca") || "";
}

function novaBusca() {
  const campo = document.getElementById("campoBusca");
  if (!campo) return;
  const termo = (campo.value || "").trim();
  if (!termo) return;
  window.location.search = `?busca=${encodeURIComponent(termo)}`;
}

function novaPesquisa() {
  // Reseta a tela e foca no campo
  const campo = document.getElementById("campoBusca");
  if (campo) {
    campo.value = "";
    campo.focus();
  }
  const res = document.getElementById("resultados");
  if (res) res.innerHTML = "";
  const chips = document.getElementById("chipsArquivos");
  if (chips) chips.innerHTML = "";
  arquivoAtivo = null;
  resultadosPorArquivo = {};
  currentListaNome = null;
  toast("🔎 Nova pesquisa");
}

/* ============================================================
   Busca (MOCK) — substitua por seu backend/JSON depois
============================================================ */
function buscarArtigosMock(termo) {
  // Simula base por arquivos
  const base = {
    civil: [
      { id: "cc_186",  codigo: "Código Civil",      texto: "Art. 186 - Aquele que, por ação ou omissão voluntária, negligência ou imprudência, violar direito e causar dano..." },
      { id: "cc_927",  codigo: "Código Civil",      texto: "Art. 927 - Aquele que, por ato ilícito, causar dano a outrem, fica obrigado a repará-lo." }
    ],
    penal: [
      { id: "cp_145",  codigo: "Código Penal",      texto: "Art. 145 - O cônjuge do ausente, sempre que não esteja separado judicialmente..." },
      { id: "cp_121",  codigo: "Código Penal",      texto: "Art. 121 - Matar alguém: Pena - reclusão, de seis a vinte anos." }
    ],
    "processo-penal": [
      { id: "cpp_312", codigo: "Código de Processo Penal", texto: "Art. 312 - A prisão preventiva poderá ser decretada como garantia da ordem pública..." },
      { id: "cpp_319", codigo: "Código de Processo Penal", texto: "Art. 319 - São medidas cautelares diversas da prisão..." }
    ]
  };

  // Filtro simples por termo (titulo/texto)
  const t = (termo || "").toLowerCase();
  const filtra = arr => arr.filter(a =>
    a.texto.toLowerCase().includes(t) ||
    a.codigo.toLowerCase().includes(t) ||
    a.id.toLowerCase().includes(t)
  );

  return {
    civil: filtra(base.civil),
    penal: filtra(base.penal),
    "processo-penal": filtra(base["processo-penal"])
  };
}

function renderizarResultados(termo) {
  resultadosPorArquivo = buscarArtigosMock(termo);

  // Define arquivo ativo (o primeiro que tiver resultado; senão "civil")
  const ordem = ["civil", "penal", "processo-penal"];
  arquivoAtivo = ordem.find(k => resultadosPorArquivo[k] && resultadosPorArquivo[k].length) || "civil";

  renderizarChipsArquivos();
  renderizarListaResultados();
}

function renderizarChipsArquivos() {
  const cont = document.getElementById("chipsArquivos");
  if (!cont) return;

  const labels = {
    civil: "CIVIL",
    penal: "PENAL",
    "processo-penal": "PROCESSO PENAL"
  };

  cont.innerHTML = "";
  Object.keys(labels).forEach(key => {
    const btn = document.createElement("button");
    btn.className = `chip ${key === arquivoAtivo ? "active" : ""}`;
    btn.dataset.arquivo = key;
    btn.textContent = labels[key];
    btn.onclick = () => {
      arquivoAtivo = key;
      // rola direto para o box de resultados, simulando “setas pulam direto…”
      document.getElementById("box-resultados")?.scrollIntoView({ behavior: "smooth", block: "start" });
      renderizarChipsArquivos();
      renderizarListaResultados();
    };
    cont.appendChild(btn);
  });
}

function renderizarListaResultados() {
  const wrap = document.getElementById("resultados");
  if (!wrap) return;
  wrap.innerHTML = "";

  const lista = resultadosPorArquivo[arquivoAtivo] || [];
  if (!lista.length) {
    const vazio = document.createElement("div");
    vazio.style.color = "#6b7280";
    vazio.style.padding = "6px 0";
    vazio.textContent = "Nenhum resultado neste arquivo.";
    wrap.appendChild(vazio);
    return;
  }

  lista.forEach(art => {
    const jaSel = selecionados.some(s => s.id === art.id);

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="artigo">${art.texto}</div>
      <div class="card-actions">
        <button class="btn-pill" title="Estudar">ESTUDAR</button>
        <button class="btn-pill" title="Consultar versão oficial">CONSULTAR</button>
        <button class="btn-pill" title="Selecionar para a lista" ${jaSel ? 'disabled' : ''}>
          ${jaSel ? '✅ SELECIONADO' : 'SELECIONAR'}
        </button>
      </div>
    `;

    const [btnEstudar, btnConsultar, btnSelecionar] = card.querySelectorAll(".btn-pill");

    btnEstudar.onclick = () => estudarArtigo(art);
    btnConsultar.onclick = () => consultarArtigo(art);
    btnSelecionar.onclick = () => selecionarArtigo(art);

    wrap.appendChild(card);
  });
}

/* ============================================================
   Selecionados
============================================================ */
function selecionarArtigo(art) {
  // sem duplicata
  if (selecionados.some(a => a.id === art.id)) {
    toast("Já está selecionado.");
    return;
  }
  selecionados.push({ id: art.id, codigo: art.codigo, texto: art.texto });
  renderizarSelecionados();
  // atualiza a lista para desabilitar o botão "Selecionar" do card
  renderizarListaResultados();
  toast("✅ Adicionado aos selecionados");
}

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
      <span class="badge-selected">SELECIONADO</span>
    `;
    box.appendChild(item);
  });

  // persiste um snapshot dos selecionados (opcional)
  localStorage.setItem("selecionadosTemp", JSON.stringify(selecionados));
}

function limparSelecionados() {
  if (!selecionados.length) return;
  if (!confirm("Remover todos os itens selecionados?")) return;
  selecionados = [];
  renderizarSelecionados();
  // re-render para reabilitar os botões "Selecionar"
  renderizarListaResultados();
}

/* ============================================================
   Salvar / Abrir lista
============================================================ */
function salvarLista() {
  if (!selecionados.length) {
    alert("Nenhum artigo selecionado.");
    return;
  }

  // Se já existe uma lista aberta, salva por cima
  let nome = currentListaNome;

  if (!nome) {
    // Nova lista → pede nome
    nome = prompt("Nome da lista:");
    if (!nome) return;
  }

  // overwrite se existir
  listasSalvas = listasSalvas.filter(l => l.nome !== nome);
  listasSalvas.push({ nome, itens: selecionados });

  currentListaNome = nome; // passa a ser a lista ativa
  localStorage.setItem("listasSalvas", JSON.stringify(listasSalvas));
  toast(`💾 Lista “${nome}” salva`);
}

/* ============================================================
   Ações simuladas (placeholders)
============================================================ */
function estudarArtigo(art) {
  alert("📖 Estudar artigo:\n\n" + art.texto);
}
function consultarArtigo(art) {
  // coloque aqui seu link oficial por ID/arquivo quando tiver a base real
  alert("🔗 Consultar versão oficial (simulação)\n\n" + art.codigo + " — " + art.id);
}

/* ============================================================
   Utilitários
============================================================ */
function toast(msg, ms = 1600) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/* ============================================================
   Bootstrapping por página
============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  // Se estiver na resultados.html: carrega termo e renderiza
  const campo = document.getElementById("campoBusca");
  if (campo) {
    const termo = getParametroBusca();
    campo.value = termo;

    // Restaura selecionados temporários (opcional)
    try {
      const temp = JSON.parse(localStorage.getItem("selecionadosTemp") || "[]");
      if (Array.isArray(temp)) selecionados = temp;
    } catch(_) {}

    renderizarSelecionados();
    renderizarResultados(termo);
  }

  // Botão buscar (header resultados)
  const btnBuscar = document.getElementById("btnBuscar");
  if (btnBuscar && campo) {
    btnBuscar.addEventListener("click", novaBusca);
    campo.addEventListener("keydown", (e) => {
      if (e.key === "Enter") novaBusca();
    });
  }

  // Rodapé (resultados)
  const btnAbrirListas = document.getElementById("btnAbrirListas");
  if (btnAbrirListas) btnAbrirListas.addEventListener("click", abrirModalListas);

  const btnNovaPesquisa = document.getElementById("btnNovaPesquisa");
  if (btnNovaPesquisa) btnNovaPesquisa.addEventListener("click", novaPesquisa);

  // Botões do box "Selecionados"
  const btnLimpar = document.getElementById("limpar-tudo");
  if (btnLimpar) btnLimpar.addEventListener("click", limparSelecionados);

  const btnSalvar = document.getElementById("salvar-lista");
  if (btnSalvar) btnSalvar.addEventListener("click", salvarLista);

  // HOME: preencher modal de listas ao abrir
  const modalHome = document.getElementById("modalListas");
  if (modalHome && !document.getElementById("campoBusca")) {
    renderizarListasModal();
  }
});
