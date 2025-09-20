// ==================== Variáveis globais ====================
let selecionados = [];
let listasSalvas = JSON.parse(localStorage.getItem("listasSalvas")) || [];

// ==================== Funções da HOME ====================

// Inicia busca: leva para resultados.html com termo salvo na URL
function iniciarBusca() {
  const termo = document.getElementById("globalSearch").value.trim();
  if (!termo) return;
  window.location.href = `resultados.html?busca=${encodeURIComponent(termo)}`;
}

// Abre modal de listas na home
function abrirModalListas() {
  renderizarListas();
  document.getElementById("modalListas").classList.remove("hidden");
}

function fecharModalListas() {
  document.getElementById("modalListas").classList.add("hidden");
}

// ==================== Funções da página RESULTADOS ====================

// Lê parâmetro da URL (termo buscado)
function getParametroBusca() {
  const params = new URLSearchParams(window.location.search);
  return params.get("busca") || "";
}

// Renderiza resultados simulados (substituir depois por dados reais)
function buscarArtigos(termo) {
  // Mock: normalmente aqui viria leitura de arquivos JSON
  return [
    { id: "cp145", codigo: "Código Penal", texto: "Art 145 - O cônjuge do ausente..." },
    { id: "cc146", codigo: "Código Civil", texto: "Art 146 - O cônjuge do ausente desaparecido..." },
  ].filter(a => a.texto.toLowerCase().includes(termo.toLowerCase()));
}

// Mostra resultados em cards
function renderizarResultados(termo) {
  const container = document.getElementById("resultados");
  if (!container) return;
  const artigos = buscarArtigos(termo);

  container.innerHTML = "";
  artigos.forEach(art => {
    const jaSelecionado = selecionados.some(s => s.id === art.id);

    const card = document.createElement("div");
    card.classList.add("card");

    card.innerHTML = `
      <strong>${art.codigo}</strong><br>
      ${art.texto.substring(0, 100)}...
      <div class="card-actions">
        <button onclick="selecionarArtigo('${art.id}', '${art.codigo}', '${art.texto.replace(/'/g,"")}' )" ${jaSelecionado ? "disabled" : ""}>
          ${jaSelecionado ? "✅ Selecionado" : "📂 Selecionar"}
        </button>
        <button onclick="estudarArtigo('${art.texto}')">📖 Estudar</button>
        <button onclick="consultarArtigo('${art.id}')">🔗 Consultar</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// ==================== Selecionados ====================

function selecionarArtigo(id, codigo, texto) {
  if (selecionados.some(a => a.id === id)) return;
  selecionados.push({ id, codigo, texto });
  renderizarSelecionados();
  salvarNoLocalStorage();
}

function renderizarSelecionados() {
  const box = document.getElementById("selecionados");
  if (!box) return;

  box.innerHTML = "";
  selecionados.forEach(art => {
    const item = document.createElement("div");
    item.classList.add("card");
    item.innerHTML = `
      <strong>${art.codigo}</strong><br>
      ${art.texto.substring(0, 100)}...
      <span class="tag-selecionado">Selecionado</span>
    `;
    box.appendChild(item);
  });
}

function limparSelecionados() {
  selecionados = [];
  renderizarSelecionados();
}

// ==================== Listas ====================

function salvarLista() {
  if (selecionados.length === 0) {
    alert("Nenhum artigo selecionado.");
    return;
  }

  const nome = prompt("Nome da lista:");
  if (!nome) return;

  const novaLista = { nome, itens: selecionados };
  // Se já existe, substitui
  listasSalvas = listasSalvas.filter(l => l.nome !== nome);
  listasSalvas.push(novaLista);

  localStorage.setItem("listasSalvas", JSON.stringify(listasSalvas));
  alert("✅ Lista salva com sucesso!");
}

function renderizarListas() {
  const ul = document.getElementById("listasSalvas");
  if (!ul) return;
  ul.innerHTML = "";

  listasSalvas.forEach(lista => {
    const li = document.createElement("li");
    li.textContent = lista.nome;
    li.onclick = () => abrirLista(lista.nome);
    ul.appendChild(li);
  });
}

function abrirLista(nome) {
  const lista = listasSalvas.find(l => l.nome === nome);
  if (!lista) return;

  selecionados = lista.itens;
  renderizarSelecionados();
  fecharModalListas();
}

// ==================== Ações simuladas ====================
function estudarArtigo(texto) {
  alert("📖 Estudando artigo:\n\n" + texto);
}

function consultarArtigo(id) {
  alert("🔗 Consultar artigo no Planalto (simulação): " + id);
}

// ==================== Inicialização ====================
document.addEventListener("DOMContentLoaded", () => {
  const campoBusca = document.getElementById("campoBusca");
  if (campoBusca) {
    const termo = getParametroBusca();
    campoBusca.value = termo;
    renderizarResultados(termo);
    renderizarSelecionados();
  }
});
