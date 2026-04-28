import { apiJson, escapeHtml, formatDate, initializeAppearance } from "./shared.js";

const state = {
  notes: [],
  concepts: [],
  activeNoteId: null,
  status: "Idle"
};

const elements = {
  notesList: document.querySelector("#notes-list"),
  noteCountLabel: document.querySelector("#note-count-label"),
  conceptsList: document.querySelector("#concepts-list"),
  titleInput: document.querySelector("#title-input"),
  contentInput: document.querySelector("#content-input"),
  saveButton: document.querySelector("#save-button"),
  retryButton: document.querySelector("#retry-button"),
  newNoteButton: document.querySelector("#new-note-button"),
  saveStatus: document.querySelector("#save-status"),
  errorMessage: document.querySelector("#error-message"),
  editorHeading: document.querySelector("#editor-heading")
};

async function initialize() {
  initializeAppearance();
  bindEvents();
  await refreshNotes();
}

function bindEvents() {
  elements.saveButton.addEventListener("click", saveActiveNote);
  elements.retryButton.addEventListener("click", retryExtraction);
  elements.newNoteButton.addEventListener("click", createDraft);
}

async function refreshNotes() {
  state.notes = await apiJson("/api/notes");
  renderNotes();

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

  hydrateEditor(activeNote);
  await loadConcepts(activeNote.id);
}

function createDraft() {
  state.activeNoteId = null;
  elements.titleInput.value = "";
  elements.contentInput.value = "";
  elements.editorHeading.textContent = "Untitled note";
  state.concepts = [];
  setStatus("Idle");
  clearError();
  renderNotes();
  renderConcepts();
}

async function selectNote(noteId) {
  state.activeNoteId = noteId;
  const note = state.notes.find((entry) => entry.id === noteId);

  if (!note) {
    createDraft();
    return;
  }

  hydrateEditor(note);
  clearError();
  renderNotes();
  await loadConcepts(noteId);
}

function hydrateEditor(note) {
  elements.titleInput.value = note.title;
  elements.contentInput.value = note.content;
  elements.editorHeading.textContent = note.title || "Untitled note";
}

function renderNotes() {
  elements.noteCountLabel.textContent = `${state.notes.length} note${state.notes.length === 1 ? "" : "s"}`;

  if (!state.notes.length) {
    elements.notesList.innerHTML =
      '<div class="empty-state">No notes yet. Create the first one.</div>';
    return;
  }

  elements.notesList.innerHTML = state.notes
    .map((note) => {
      const activeClass = note.id === state.activeNoteId ? "is-active" : "";
      return `
        <button class="note-item ${activeClass}" data-note-id="${note.id}" type="button">
          <h4>${escapeHtml(note.title || "Untitled note")}</h4>
          <div class="meta-text">${formatDate(note.updatedAt)}</div>
          <p class="note-snippet">${escapeHtml(note.content.slice(0, 96))}</p>
        </button>
      `;
    })
    .join("");

  for (const button of elements.notesList.querySelectorAll("[data-note-id]")) {
    button.addEventListener("click", () => selectNote(button.dataset.noteId));
  }
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
        content: elements.contentInput.value
      })
    });

    state.activeNoteId = savedNote.id;
    elements.editorHeading.textContent = savedNote.title || "Untitled note";

    await refreshNotes();
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
    await refreshNotes();
    setStatus("Saved");
  } catch (error) {
    setStatus("Error");
    showError(error.message);
  }
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
