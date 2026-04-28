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

function ensureDialogElements() {
  let overlay = document.querySelector("#app-dialog-overlay");
  let dialog = document.querySelector("#app-dialog");

  if (overlay && dialog) {
    return { overlay, dialog };
  }

  overlay = document.createElement("div");
  overlay.id = "app-dialog-overlay";
  overlay.className = "app-dialog-overlay";
  overlay.hidden = true;

  dialog = document.createElement("div");
  dialog.id = "app-dialog";
  dialog.className = "app-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.hidden = true;

  document.body.append(overlay, dialog);

  return { overlay, dialog };
}

function closeDialog({ overlay, dialog, previousFocus, onClose }, value) {
  document.removeEventListener("keydown", onClose);
  overlay.hidden = true;
  dialog.hidden = true;
  dialog.innerHTML = "";
  document.body.classList.remove("dialog-open");

  if (previousFocus instanceof HTMLElement) {
    previousFocus.focus();
  }

  return value;
}

function appConfirm({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false
}) {
  const { overlay, dialog } = ensureDialogElements();
  const previousFocus = document.activeElement;

  return new Promise((resolve) => {
    const dialogId = `app-dialog-title-${Date.now()}`;
    const messageId = `app-dialog-message-${Date.now()}`;
    let settled = false;

    function finish(value) {
      if (settled) {
        return;
      }

      settled = true;
      overlay.removeEventListener("click", onOverlayClick);
      resolve(closeDialog({ overlay, dialog, previousFocus, onClose }, value));
    }

    function onClose(event) {
      if (event.key === "Escape") {
        finish(false);
      }
    }

    function onOverlayClick() {
      finish(false);
    }

    dialog.setAttribute("aria-labelledby", dialogId);
    dialog.setAttribute("aria-describedby", messageId);
    dialog.innerHTML = `
      <div class="app-dialog-header">
        <div>
          <p class="eyebrow">${destructive ? "Approval" : "Confirm"}</p>
          <h2 id="${dialogId}">${escapeHtml(title)}</h2>
        </div>
      </div>
      <p id="${messageId}" class="app-dialog-message">${escapeHtml(message)}</p>
      <div class="app-dialog-actions">
        <button class="ghost-button" data-dialog-cancel type="button">${escapeHtml(cancelLabel)}</button>
        <button class="primary-button ${destructive ? "danger-button" : ""}" data-dialog-confirm type="button">${escapeHtml(confirmLabel)}</button>
      </div>
    `;

    dialog.querySelector("[data-dialog-cancel]").addEventListener("click", () => finish(false));
    dialog.querySelector("[data-dialog-confirm]").addEventListener("click", () => finish(true));
    overlay.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onClose);

    overlay.hidden = false;
    dialog.hidden = false;
    document.body.classList.add("dialog-open");
    dialog.querySelector("[data-dialog-confirm]").focus();
  });
}

function appPrompt({
  title,
  label,
  value = "",
  confirmLabel = "Save",
  cancelLabel = "Cancel"
}) {
  const { overlay, dialog } = ensureDialogElements();
  const previousFocus = document.activeElement;

  return new Promise((resolve) => {
    const dialogId = `app-dialog-title-${Date.now()}`;
    const inputId = `app-dialog-input-${Date.now()}`;
    let settled = false;

    function finish(result) {
      if (settled) {
        return;
      }

      settled = true;
      overlay.removeEventListener("click", onOverlayClick);
      resolve(closeDialog({ overlay, dialog, previousFocus, onClose }, result));
    }

    function submit() {
      const input = dialog.querySelector("[data-dialog-input]");
      finish(input.value);
    }

    function onClose(event) {
      if (event.key === "Escape") {
        finish(null);
      }
    }

    function onOverlayClick() {
      finish(null);
    }

    dialog.setAttribute("aria-labelledby", dialogId);
    dialog.removeAttribute("aria-describedby");
    dialog.innerHTML = `
      <form class="app-dialog-form" data-dialog-form>
        <div class="app-dialog-header">
          <div>
            <p class="eyebrow">Entry</p>
            <h2 id="${dialogId}">${escapeHtml(title)}</h2>
          </div>
        </div>
        <label class="field-label" for="${inputId}">${escapeHtml(label)}</label>
        <input id="${inputId}" class="text-input" data-dialog-input type="text" value="${escapeHtml(value)}" />
        <div class="app-dialog-actions">
          <button class="ghost-button" data-dialog-cancel type="button">${escapeHtml(cancelLabel)}</button>
          <button class="primary-button" type="submit">${escapeHtml(confirmLabel)}</button>
        </div>
      </form>
    `;

    dialog.querySelector("[data-dialog-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });
    dialog.querySelector("[data-dialog-cancel]").addEventListener("click", () => finish(null));
    overlay.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onClose);

    overlay.hidden = false;
    dialog.hidden = false;
    document.body.classList.add("dialog-open");

    const input = dialog.querySelector("[data-dialog-input]");
    input.focus();
    input.select();
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

export { apiJson, appConfirm, appPrompt, escapeHtml, formatDate, initializeAppearance };
