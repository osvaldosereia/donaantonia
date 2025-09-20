// Alterna o menu do botão +
function toggleFabMenu(btn) {
  const menu = btn.parentElement.querySelector(".fab-menu");
  document.querySelectorAll(".fab-menu").forEach(m => {
    if (m !== menu) m.style.display = "none";
  });
  menu.style.display = menu.style.display === "flex" ? "none" : "flex";
}

// Alterna submenu de salvar em pasta
function toggleSaveMenu(btn) {
  const saveMenu = btn.parentElement.querySelector(".save-menu");
  if (saveMenu) {
    saveMenu.style.display = saveMenu.style.display === "flex" ? "none" : "flex";
  } else {
    const newMenu = document.createElement("div");
    newMenu.className = "save-menu";
    newMenu.innerHTML = `
      <button>+ Criar nova pasta</button>
      <button>📂 Penal</button>
      <button>📂 Direito Constitucional</button>
    `;
    btn.parentElement.appendChild(newMenu);
  }
}

// Abre modal full-screen
function openModal(title, text) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalText").textContent = text;
  document.getElementById("modalOverlay").classList.add("open");
}

// Fecha modal
function closeModal() {
  document.getElementById("modalOverlay").classList.remove("open");
}

// Fecha modal clicando fora
document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("modalOverlay");
  if (overlay) {
    overlay.addEventListener("click", function (e) {
      if (e.target === this) {
        closeModal();
      }
    });
  }
});
