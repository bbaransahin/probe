import { apiJson, appConfirm, appPrompt, escapeHtml, initializeAppearance } from "./shared.js";

const state = {
  notes: [],
  directories: [],
  concepts: [],
  activeNoteId: null,
  activeDirectoryId: null,
  draftDirectoryId: null,
  expandedDirectoryIds: new Set(),
  status: "Idle"
};

const elements = {
  notesList: document.querySelector("#notes-list"),
  activeDirectoryLabel: document.querySelector("#active-directory-label"),
  conceptsList: document.querySelector("#concepts-list"),
  titleInput: document.querySelector("#title-input"),
  contentInput: document.querySelector("#content-input"),
  saveButton: document.querySelector("#save-button"),
  retryButton: document.querySelector("#retry-button"),
  newNoteButton: document.querySelector("#new-note-button"),
  newDirectoryButton: document.querySelector("#new-directory-button"),
  saveStatus: document.querySelector("#save-status"),
  errorMessage: document.querySelector("#error-message"),
  editorHeading: document.querySelector("#editor-heading")
};

async function initialize() {
  initializeAppearance();
  bindEvents();
  await refreshLibrary();
}

function bindEvents() {
  elements.saveButton.addEventListener("click", saveActiveNote);
  elements.retryButton.addEventListener("click", retryExtraction);
  elements.newNoteButton.addEventListener("click", createDraft);
  elements.newDirectoryButton.addEventListener("click", createDirectory);
  elements.notesList.addEventListener("keydown", handleTreeKeydown);
}

async function refreshLibrary() {
  const [notes, directories] = await Promise.all([
    apiJson("/api/notes"),
    apiJson("/api/directories")
  ]);
  state.notes = notes;
  state.directories = directories;
  renderLibrary();

  if (!state.activeNoteId) {
    if (state.notes[0]) {
      await selectNote(state.notes[0].id);
    } else {
      createDraft();
    }
    return;
  }

  const activeNote = state.notes.find((note) => note.id === state.activeNoteId);
  if (!activeNote) {
    createDraft();
    return;
  }

  state.activeDirectoryId = normalizeDirectoryId(activeNote.directoryId);
  state.draftDirectoryId = state.activeDirectoryId;
  expandAncestors(state.activeDirectoryId);
  hydrateEditor(activeNote);
  renderLibrary();
  await loadConcepts(activeNote.id);
}

function createDraft() {
  state.activeNoteId = null;
  state.draftDirectoryId = state.activeDirectoryId;
  elements.titleInput.value = "";
  elements.contentInput.value = "";
  elements.editorHeading.textContent = "Untitled note";
  state.concepts = [];
  setStatus("Idle");
  clearError();
  renderLibrary();
  renderConcepts();
}

async function createDirectory() {
  const name = await appPrompt({
    title: "New folder",
    label: "Folder name",
    confirmLabel: "Create folder"
  });

  if (!name || !name.trim()) {
    return;
  }

  clearError();

  try {
    const directory = await apiJson("/api/directories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        parentId: state.activeDirectoryId
      })
    });
    state.expandedDirectoryIds.add(normalizeDirectoryId(directory.parentId) || "root");
    state.expandedDirectoryIds.add(directory.id);
    state.activeDirectoryId = directory.id;
    state.draftDirectoryId = directory.id;
    state.activeNoteId = null;
    const [notes, directories] = await Promise.all([
      apiJson("/api/notes"),
      apiJson("/api/directories")
    ]);
    state.notes = notes;
    state.directories = directories;
    createDraft();
  } catch (error) {
    showError(error.message);
  }
}

async function renameDirectory(directoryId) {
  const directory = state.directories.find((entry) => entry.id === directoryId);

  if (!directory) {
    return;
  }

  const name = await appPrompt({
    title: "Rename folder",
    label: "Folder name",
    value: directory.name,
    confirmLabel: "Rename folder"
  });

  if (!name || !name.trim()) {
    return;
  }

  clearError();

  try {
    await apiJson(`/api/directories/${encodeURIComponent(directoryId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    await refreshLibrary();
  } catch (error) {
    showError(error.message);
  }
}

async function deleteDirectory(directoryId) {
  const directory = state.directories.find((entry) => entry.id === directoryId);

  if (!directory) {
    return;
  }

  const shouldDelete = await appConfirm({
    title: `Delete "${directory.name}"?`,
    message: "Notes and folders inside will move up one level.",
    confirmLabel: "Delete folder",
    destructive: true
  });

  if (!shouldDelete) {
    return;
  }

  clearError();

  try {
    await apiJson(`/api/directories/${encodeURIComponent(directoryId)}`, {
      method: "DELETE"
    });

    if (state.activeDirectoryId === directoryId) {
      state.activeDirectoryId = normalizeDirectoryId(directory.parentId);
      state.draftDirectoryId = state.activeDirectoryId;
    }

    state.expandedDirectoryIds.delete(directoryId);
    await refreshLibrary();
  } catch (error) {
    showError(error.message);
  }
}

function selectDirectory(directoryId) {
  state.activeDirectoryId = normalizeDirectoryId(directoryId);
  state.draftDirectoryId = state.activeDirectoryId;
  expandAncestors(state.activeDirectoryId);
  renderLibrary();
}

async function selectNote(noteId) {
  state.activeNoteId = noteId;
  const note = state.notes.find((entry) => entry.id === noteId);

  if (!note) {
    createDraft();
    return;
  }

  state.activeDirectoryId = normalizeDirectoryId(note.directoryId);
  state.draftDirectoryId = state.activeDirectoryId;
  expandAncestors(state.activeDirectoryId);
  hydrateEditor(note);
  clearError();
  renderLibrary();
  await loadConcepts(noteId);
}

function hydrateEditor(note) {
  elements.titleInput.value = note.title;
  elements.contentInput.value = note.content;
  elements.editorHeading.textContent = note.title || "Untitled note";
}

function renderLibrary() {
  elements.activeDirectoryLabel.textContent = getDirectoryName(state.activeDirectoryId);

  const childrenByParent = groupDirectoriesByParent();
  const notesByDirectory = groupNotesByDirectory();
  const html = renderDirectoryBranch({
    directory: null,
    childrenByParent,
    notesByDirectory,
    depth: 0
  });

  elements.notesList.innerHTML = html;
  bindLibraryEvents();
}

function renderDirectoryBranch({ directory, childrenByParent, notesByDirectory, depth }) {
  const directoryId = directory?.id || null;
  const directoryKey = directoryId || "root";
  const isExpanded = directoryId ? state.expandedDirectoryIds.has(directoryId) : true;
  const isActive = normalizeDirectoryId(state.activeDirectoryId) === directoryId;
  const childDirectories = childrenByParent.get(directoryKey) || [];
  const childNotes = notesByDirectory.get(directoryKey) || [];
  const canToggle = childDirectories.length || childNotes.length;
  const rowClass = `directory-row library-drop-target ${isActive ? "is-active" : ""}`;
  const label = directory ? directory.name : "Inbox";
  const actions = directory
    ? `
        <button class="directory-action" data-rename-directory-id="${directory.id}" type="button" aria-label="Rename ${escapeHtml(label)}">Rename</button>
        <button class="directory-action" data-delete-directory-id="${directory.id}" type="button" aria-label="Delete ${escapeHtml(label)}">Delete</button>
      `
    : "";

  return `
    <div class="directory-group" style="--depth: ${depth}">
      <div
        class="${rowClass}"
        role="treeitem"
        aria-level="${depth + 1}"
        aria-selected="${isActive ? "true" : "false"}"
        aria-expanded="${canToggle ? (isExpanded ? "true" : "false") : "false"}"
        tabindex="${getTreeNodeTabIndex("directory", directoryId)}"
        data-node-type="directory"
        data-tree-node
        data-directory-id="${directoryId || ""}"
        data-can-toggle="${canToggle ? "true" : "false"}"
        draggable="${directory ? "true" : "false"}"
      >
        <button class="directory-toggle" data-toggle-directory-id="${directoryId || ""}" type="button" aria-label="${isExpanded ? "Collapse" : "Expand"} ${escapeHtml(label)}">
          <span class="tree-caret ${isExpanded ? "is-expanded" : ""}" aria-hidden="true"></span>
        </button>
        <button class="directory-select" data-select-directory-id="${directoryId || ""}" type="button">
          <span class="directory-icon" aria-hidden="true"></span>
          <span>${escapeHtml(label)}</span>
        </button>
        <div class="directory-actions">${actions}</div>
      </div>
      ${
        isExpanded
          ? `
              <div class="directory-contents" role="group">
                ${childDirectories
                  .map((child) =>
                    renderDirectoryBranch({
                      directory: child,
                      childrenByParent,
                      notesByDirectory,
                      depth: depth + 1
                    })
                  )
                  .join("")}
                ${childNotes.map((note) => renderNoteItem(note, depth + 1)).join("")}
                ${
                  !childDirectories.length && !childNotes.length && !directory
                    ? '<div class="empty-state">No notes yet. Create the first one.</div>'
                    : ""
                }
              </div>
            `
          : ""
      }
    </div>
  `;
}

function renderNoteItem(note, depth) {
  const activeClass = note.id === state.activeNoteId ? "is-active" : "";

  return `
    <button
      class="note-item ${activeClass}"
      role="treeitem"
      aria-level="${depth + 1}"
      aria-selected="${note.id === state.activeNoteId ? "true" : "false"}"
      tabindex="${getTreeNodeTabIndex("note", note.id)}"
      data-node-type="note"
      data-tree-node
      data-note-id="${note.id}"
      draggable="true"
      style="--depth: ${depth}"
      type="button"
    >
      <span class="note-file-icon" aria-hidden="true"></span>
      <span class="note-title">${escapeHtml(note.title || "Untitled note")}</span>
    </button>
  `;
}

function getTreeNodeTabIndex(type, id) {
  if (state.activeNoteId) {
    return type === "note" && id === state.activeNoteId ? "0" : "-1";
  }

  if (type === "directory" && normalizeDirectoryId(id) === state.activeDirectoryId) {
    return "0";
  }

  return "-1";
}

function bindLibraryEvents() {
  for (const button of elements.notesList.querySelectorAll("[data-note-id]")) {
    button.addEventListener("click", () => selectNote(button.dataset.noteId));
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(
        "application/json",
        JSON.stringify({ type: "note", id: button.dataset.noteId })
      );
    });
  }

  for (const row of elements.notesList.querySelectorAll(".directory-row")) {
    row.addEventListener("dragstart", (event) => {
      if (!row.dataset.directoryId) {
        event.preventDefault();
        return;
      }

      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(
        "application/json",
        JSON.stringify({ type: "directory", id: row.dataset.directoryId })
      );
    });
  }

  for (const button of elements.notesList.querySelectorAll("[data-select-directory-id]")) {
    button.addEventListener("click", () => {
      const directoryId = normalizeDirectoryId(button.dataset.selectDirectoryId);
      const row = button.closest(".directory-row");
      selectDirectory(directoryId);

      if (directoryId && row?.dataset.canToggle === "true") {
        toggleDirectory(directoryId);
      }
    });
  }

  for (const button of elements.notesList.querySelectorAll("[data-toggle-directory-id]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const directoryId = button.dataset.toggleDirectoryId;

      if (!directoryId || button.closest(".directory-row")?.dataset.canToggle !== "true") {
        return;
      }

      toggleDirectory(directoryId);
    });
  }

  for (const button of elements.notesList.querySelectorAll("[data-rename-directory-id]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      renameDirectory(button.dataset.renameDirectoryId);
    });
  }

  for (const button of elements.notesList.querySelectorAll("[data-delete-directory-id]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteDirectory(button.dataset.deleteDirectoryId);
    });
  }

  for (const target of elements.notesList.querySelectorAll(".library-drop-target")) {
    target.addEventListener("dragover", (event) => {
      event.preventDefault();
      target.classList.add("is-drop-target");
    });
    target.addEventListener("dragleave", () => {
      target.classList.remove("is-drop-target");
    });
    target.addEventListener("drop", async (event) => {
      event.preventDefault();
      target.classList.remove("is-drop-target");
      await handleDrop(event, normalizeDirectoryId(target.dataset.directoryId));
    });
  }
}

function handleTreeKeydown(event) {
  const currentNode = event.target.closest("[data-tree-node]");

  if (!currentNode || !elements.notesList.contains(currentNode)) {
    return;
  }

  const visibleNodes = [...elements.notesList.querySelectorAll("[data-tree-node]")];
  const currentIndex = visibleNodes.indexOf(currentNode);

  if (currentIndex < 0) {
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusTreeNode(visibleNodes[currentIndex + 1] || visibleNodes[0]);
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    focusTreeNode(visibleNodes[currentIndex - 1] || visibleNodes[visibleNodes.length - 1]);
    return;
  }

  if (event.key === "Home") {
    event.preventDefault();
    focusTreeNode(visibleNodes[0]);
    return;
  }

  if (event.key === "End") {
    event.preventDefault();
    focusTreeNode(visibleNodes[visibleNodes.length - 1]);
    return;
  }

  if (event.key === "ArrowRight" && currentNode.dataset.nodeType === "directory") {
    event.preventDefault();

    if (currentNode.dataset.canToggle === "true" && currentNode.getAttribute("aria-expanded") !== "true") {
      toggleDirectory(normalizeDirectoryId(currentNode.dataset.directoryId), true);
      focusRenderedDirectory(currentNode.dataset.directoryId);
      return;
    }

    const nextNode = visibleNodes[currentIndex + 1];

    if (nextNode && Number(nextNode.getAttribute("aria-level")) > Number(currentNode.getAttribute("aria-level"))) {
      focusTreeNode(nextNode);
    }

    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();

    if (
      currentNode.dataset.nodeType === "directory" &&
      currentNode.dataset.canToggle === "true" &&
      currentNode.getAttribute("aria-expanded") === "true" &&
      currentNode.dataset.directoryId
    ) {
      toggleDirectory(currentNode.dataset.directoryId, false);
      focusRenderedDirectory(currentNode.dataset.directoryId);
      return;
    }

    focusParentTreeNode(currentNode, visibleNodes, currentIndex);
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activateTreeNode(currentNode);
  }
}

function focusTreeNode(node) {
  if (!node) {
    return;
  }

  for (const treeNode of elements.notesList.querySelectorAll("[data-tree-node]")) {
    treeNode.tabIndex = treeNode === node ? 0 : -1;
  }

  node.focus();
}

function focusRenderedDirectory(directoryId) {
  requestAnimationFrame(() => {
    focusTreeNode(
      elements.notesList.querySelector(
        `[data-node-type="directory"][data-directory-id="${CSS.escape(directoryId || "")}"]`
      )
    );
  });
}

function focusParentTreeNode(currentNode, visibleNodes, currentIndex) {
  const currentLevel = Number(currentNode.getAttribute("aria-level"));

  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const candidate = visibleNodes[index];

    if (Number(candidate.getAttribute("aria-level")) < currentLevel) {
      focusTreeNode(candidate);
      return;
    }
  }
}

function activateTreeNode(node) {
  if (node.dataset.nodeType === "note") {
    selectNote(node.dataset.noteId);
    return;
  }

  const directoryId = normalizeDirectoryId(node.dataset.directoryId);
  selectDirectory(directoryId);

  if (directoryId && node.dataset.canToggle === "true") {
    toggleDirectory(directoryId);
  }
}

function toggleDirectory(directoryId, forceExpanded = null) {
  if (!directoryId) {
    return;
  }

  if (forceExpanded === true) {
    state.expandedDirectoryIds.add(directoryId);
  } else if (forceExpanded === false) {
    state.expandedDirectoryIds.delete(directoryId);
  } else {
    if (state.expandedDirectoryIds.has(directoryId)) {
      state.expandedDirectoryIds.delete(directoryId);
    } else {
      state.expandedDirectoryIds.add(directoryId);
    }
  }

  renderLibrary();
}

async function handleDrop(event, targetDirectoryId) {
  const payload = parseDragPayload(event);

  if (!payload) {
    return;
  }

  clearError();

  try {
    if (payload.type === "note") {
      await moveNote(payload.id, targetDirectoryId);
      return;
    }

    if (payload.type === "directory") {
      await moveDirectory(payload.id, targetDirectoryId);
    }
  } catch (error) {
    showError(error.message);
  }
}

function parseDragPayload(event) {
  try {
    return JSON.parse(event.dataTransfer.getData("application/json"));
  } catch {
    return null;
  }
}

async function moveNote(noteId, directoryId) {
  const note = state.notes.find((entry) => entry.id === noteId);

  if (!note || normalizeDirectoryId(note.directoryId) === directoryId) {
    return;
  }

  await apiJson(`/api/notes/${encodeURIComponent(noteId)}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ directoryId })
  });
  state.activeDirectoryId = directoryId;
  state.draftDirectoryId = directoryId;
  expandAncestors(directoryId);
  await refreshLibrary();
}

async function moveDirectory(directoryId, parentId) {
  const directory = state.directories.find((entry) => entry.id === directoryId);

  if (
    !directory ||
    directoryId === parentId ||
    normalizeDirectoryId(directory.parentId) === parentId ||
    isDescendantDirectory(parentId, directoryId)
  ) {
    return;
  }

  await apiJson(`/api/directories/${encodeURIComponent(directoryId)}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parentId })
  });
  state.activeDirectoryId = directoryId;
  state.draftDirectoryId = directoryId;
  state.expandedDirectoryIds.add(directoryId);
  expandAncestors(parentId);
  await refreshLibrary();
}

function renderConcepts() {
  if (!state.concepts.length) {
    elements.conceptsList.innerHTML =
      '<div class="empty-state">No extracted concepts for this note yet.</div>';
    return;
  }

  elements.conceptsList.innerHTML = state.concepts
    .map(
      (concept) => `
        <article class="concept-card">
          <h4>${escapeHtml(concept.name)}</h4>
          <p>${escapeHtml(concept.summary)}</p>
          <div class="meta-text">Category: ${escapeHtml(concept.category)}</div>
          <div class="meta-text">Confidence: ${Math.round(concept.confidenceScore * 100)}%</div>
          <div class="meta-text">Recalls: ${escapeHtml(String(concept.recallCount))}</div>
          <div class="meta-text">Source: ${escapeHtml(concept.sourceSpan)}</div>
        </article>
      `
    )
    .join("");
}

async function loadConcepts(noteId) {
  state.concepts = await apiJson(`/api/concepts?noteId=${encodeURIComponent(noteId)}`);
  renderConcepts();
}

async function saveActiveNote() {
  clearError();
  setStatus("Saving");

  try {
    const savedNote = await apiJson("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: state.activeNoteId,
        title: elements.titleInput.value,
        content: elements.contentInput.value,
        directoryId: state.activeNoteId ? getActiveNoteDirectoryId() : state.draftDirectoryId
      })
    });

    state.activeNoteId = savedNote.id;
    state.activeDirectoryId = normalizeDirectoryId(savedNote.directoryId);
    state.draftDirectoryId = state.activeDirectoryId;
    expandAncestors(state.activeDirectoryId);
    elements.editorHeading.textContent = savedNote.title || "Untitled note";

    await refreshLibrary();
    setStatus("Extracting");
    await extractConcepts(savedNote.id);
    setStatus("Saved");
  } catch (error) {
    setStatus("Error");
    showError(error.message);
  }
}

async function extractConcepts(noteId) {
  const payload = await apiJson(`/api/notes/${noteId}/extract`, {
    method: "POST"
  });

  state.concepts = payload.concepts;
  renderConcepts();
}

async function retryExtraction() {
  if (!state.activeNoteId) {
    showError("Save the note before retrying extraction.");
    return;
  }

  clearError();
  setStatus("Extracting");

  try {
    await extractConcepts(state.activeNoteId);
    await refreshLibrary();
    setStatus("Saved");
  } catch (error) {
    setStatus("Error");
    showError(error.message);
  }
}

function groupDirectoriesByParent() {
  const groups = new Map([["root", []]]);

  for (const directory of state.directories) {
    const parentKey = normalizeDirectoryId(directory.parentId) || "root";

    if (!groups.has(parentKey)) {
      groups.set(parentKey, []);
    }

    groups.get(parentKey).push(directory);
  }

  for (const directories of groups.values()) {
    directories.sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    );
  }

  return groups;
}

function groupNotesByDirectory() {
  const directoryIds = new Set(state.directories.map((directory) => directory.id));
  const groups = new Map([["root", []]]);

  for (const note of state.notes) {
    const directoryId = normalizeDirectoryId(note.directoryId);
    const key = directoryId && directoryIds.has(directoryId) ? directoryId : "root";

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(note);
  }

  return groups;
}

function expandAncestors(directoryId) {
  if (!directoryId) {
    return;
  }

  let directory = state.directories.find((entry) => entry.id === directoryId);

  while (directory) {
    state.expandedDirectoryIds.add(directory.id);
    directory = state.directories.find((entry) => entry.id === directory.parentId);
  }
}

function getActiveNoteDirectoryId() {
  const activeNote = state.notes.find((note) => note.id === state.activeNoteId);
  return normalizeDirectoryId(activeNote?.directoryId);
}

function getDirectoryName(directoryId) {
  if (!directoryId) {
    return "Inbox";
  }

  return state.directories.find((directory) => directory.id === directoryId)?.name || "Inbox";
}

function normalizeDirectoryId(directoryId) {
  return typeof directoryId === "string" && directoryId ? directoryId : null;
}

function isDescendantDirectory(possibleDescendantId, ancestorId) {
  if (!possibleDescendantId) {
    return false;
  }

  let directory = state.directories.find((entry) => entry.id === possibleDescendantId);
  const visited = new Set();

  while (directory) {
    if (directory.id === ancestorId) {
      return true;
    }

    if (!directory.parentId || visited.has(directory.id)) {
      return false;
    }

    visited.add(directory.id);
    directory = state.directories.find((entry) => entry.id === directory.parentId);
  }

  return false;
}

function setStatus(status) {
  state.status = status;
  elements.saveStatus.textContent = status;
}

function showError(message) {
  elements.errorMessage.hidden = false;
  elements.errorMessage.textContent = message;
}

function clearError() {
  elements.errorMessage.hidden = true;
  elements.errorMessage.textContent = "";
}

initialize().catch((error) => {
  setStatus("Error");
  showError(error.message);
});
