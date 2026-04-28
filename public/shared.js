function applyTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem("probe-theme", theme);
}

function applyAccent(accent) {
  document.documentElement.style.setProperty("--accent", accent);
  localStorage.setItem("probe-accent", accent);
}

function initializeAppearance() {
  const theme = localStorage.getItem("probe-theme") || "light";
  const accent = localStorage.getItem("probe-accent") || "#d97706";
  const themeToggle = document.querySelector("#theme-toggle");
  const accentInput = document.querySelector("#accent-input");
  const settingsButton = document.querySelector("#settings-button");
  const closeSettingsButton = document.querySelector("#close-settings-button");
  const settingsPopup = document.querySelector("#settings-popup");
  const settingsOverlay = document.querySelector("#settings-overlay");

  applyTheme(theme);

  if (accentInput) {
    accentInput.value = accent;
  }

  applyAccent(accent);

  themeToggle?.addEventListener("click", () => {
    applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
  });

  accentInput?.addEventListener("input", (event) => {
    applyAccent(event.target.value);
  });

  function closeSettings() {
    if (!settingsPopup || settingsPopup.hidden) {
      return;
    }

    settingsPopup.hidden = true;
    settingsOverlay?.setAttribute("hidden", "");
    settingsButton?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("settings-open");
  }

  function openSettings() {
    if (!settingsPopup) {
      return;
    }

    settingsPopup.hidden = false;
    settingsOverlay?.removeAttribute("hidden");
    settingsButton?.setAttribute("aria-expanded", "true");
    document.body.classList.add("settings-open");
  }

  settingsButton?.addEventListener("click", () => {
    if (settingsPopup?.hidden) {
      openSettings();
      return;
    }

    closeSettings();
  });

  closeSettingsButton?.addEventListener("click", closeSettings);
  settingsOverlay?.addEventListener("click", closeSettings);

  document.addEventListener("click", (event) => {
    if (
      settingsPopup?.hidden ||
      settingsPopup?.contains(event.target) ||
      settingsButton?.contains(event.target)
    ) {
      return;
    }

    closeSettings();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSettings();
    }
  });
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function apiJson(url, options) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Request failed.");
  }

  return response.json();
}

export { apiJson, escapeHtml, formatDate, initializeAppearance };
