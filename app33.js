// direito.love — app.js (versão mínima com Gemini)
// Funcionalidades: busca, renderização, botão Gemini

const $ = (s) => document.querySelector(s);

const els = {
  form: $("#searchForm"),
  q: $("#searchInput"),
  stack: $("#resultsStack"),
  spinner: $("#searchSpinner"),
};

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function escHTML(s) {
  return (s || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function buildPromptQuery(item) {
  const prefix = "Explique o conteúdo abaixo com profundidade:";
  const title = item.title || "";
  const body = item.text || "";
  const full = `${prefix}

### ${title}

${body}`;
  const trimmed = full.replace(/\s+/g, " ").trim();
  return encodeURIComponent(trimmed.length > 4800 ? trimmed.slice(0, 4800) : trimmed);
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

function renderCard(item) {
  const card = document.createElement("article");
  card.className = "card";
  card.innerHTML = `
    <div class="body">${escHTML(item.text || "")}</div>
    <div class="actions">
      <button class="round-btn" title="Estudar com Gemini" aria-label="Estudar com Gemini">
        <img src="icons/ai-gemini4.png" alt="Gemini">
      </button>
    </div>
  `;
  card.querySelector(".round-btn").addEventListener("click", () => {
    const q = buildPromptQuery(item);
    openExternal(`https://www.google.com/search?q=${q}&udm=50`);
  });
  return card;
}

// Busca simulada para teste (mock)
function doSearch() {
  els.stack.innerHTML = "";
  const exemplo = {
    title: "Art. 5º — Direitos Fundamentais",
    text: "Todos são iguais perante a lei, sem distinção de qualquer natureza..."
  };
  const bloco = document.createElement("section");
  bloco.className = "block";
  bloco.innerHTML = `<div class="block-title">Resultado</div>`;
  bloco.appendChild(renderCard(exemplo));
  els.stack.appendChild(bloco);
}

els.form?.addEventListener("submit", (e) => { e.preventDefault(); doSearch(); });
els.q?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } });