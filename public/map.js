import { apiJson, escapeHtml, initializeAppearance } from "./shared.js";

const canvasSize = { width: 1600, height: 1000 };
const mapNodeSize = 132;

const state = {
  concepts: [],
  nodes: [],
  connections: [],
  positions: new Map(),
  selectedConceptId: null,
  dragging: null
};

const elements = {
  mapStatus: document.querySelector("#map-status"),
  conceptInspector: document.querySelector("#concept-inspector"),
  sourceConceptSelect: document.querySelector("#source-concept-select"),
  targetConceptSelect: document.querySelector("#target-concept-select"),
  connectionStrengthInput: document.querySelector("#connection-strength-input"),
  saveConnectionButton: document.querySelector("#save-connection-button"),
  rebuildMapButton: document.querySelector("#rebuild-map-button"),
  mapErrorMessage: document.querySelector("#map-error-message"),
  conceptCountLabel: document.querySelector("#concept-count-label"),
  connectionCountLabel: document.querySelector("#connection-count-label"),
  mapCanvas: document.querySelector("#map-canvas"),
  mapEdges: document.querySelector("#map-edges"),
  mapNodes: document.querySelector("#map-nodes")
};

async function initialize() {
  initializeAppearance();
  bindEvents();
  await refreshMap();
}

function bindEvents() {
  elements.saveConnectionButton.addEventListener("click", saveConnection);
  elements.rebuildMapButton.addEventListener("click", rebuildMap);
  elements.sourceConceptSelect.addEventListener("change", () => {
    state.selectedConceptId = elements.sourceConceptSelect.value || state.selectedConceptId;
    render();
  });
}

async function refreshMap() {
  clearError();
  setStatus("Loading");

  try {
    const payload = await apiJson("/api/map");
    state.concepts = payload.concepts;
    state.nodes = payload.nodes;
    state.connections = payload.connections;
    hydratePositions();

    if (!state.selectedConceptId && state.concepts[0]) {
      state.selectedConceptId = state.concepts[0].id;
    }

    render();
    setStatus("Ready");
  } catch (error) {
    setStatus("Error");
    showError(error.message);
  }
}

function hydratePositions() {
  state.positions = new Map();

  for (const node of state.nodes) {
    state.positions.set(node.conceptId, { x: node.x, y: node.y });
  }

  state.concepts.forEach((concept, index) => {
    if (state.positions.has(concept.id)) {
      return;
    }

    state.positions.set(concept.id, fallbackPosition(index, state.concepts.length));
  });
}

function fallbackPosition(index, total) {
  const columns = Math.ceil(Math.sqrt(Math.max(1, total)));
  const spacingX = 260;
  const spacingY = 180;
  const column = index % columns;
  const row = Math.floor(index / columns);

  return {
    x: 120 + column * spacingX,
    y: 120 + row * spacingY
  };
}

function render() {
  renderSummary();
  renderSelectors();
  renderEdges();
  renderNodes();
  renderInspector();
}

function renderSummary() {
  elements.conceptCountLabel.textContent = `${state.concepts.length} concept${state.concepts.length === 1 ? "" : "s"}`;
  elements.connectionCountLabel.textContent = `${state.connections.length} connection${state.connections.length === 1 ? "" : "s"}`;
}

function renderSelectors() {
  const options = state.concepts
    .map(
      (concept) =>
        `<option value="${concept.id}">${escapeHtml(concept.name || "Untitled concept")}</option>`
    )
    .join("");

  elements.sourceConceptSelect.innerHTML = options;
  elements.targetConceptSelect.innerHTML = options;

  if (state.selectedConceptId) {
    elements.sourceConceptSelect.value = state.selectedConceptId;
  }

  const firstTarget = state.concepts.find(
    (concept) => concept.id !== elements.sourceConceptSelect.value
  );

  if (
    !elements.targetConceptSelect.value ||
    elements.targetConceptSelect.value === elements.sourceConceptSelect.value
  ) {
    elements.targetConceptSelect.value = firstTarget?.id || "";
  }
}

function renderEdges() {
  elements.mapEdges.setAttribute("viewBox", `0 0 ${canvasSize.width} ${canvasSize.height}`);
  elements.mapEdges.innerHTML = state.connections
    .map((connection) => {
      const source = state.positions.get(connection.sourceConceptId);
      const target = state.positions.get(connection.targetConceptId);

      if (!source || !target) {
        return "";
      }

      const selectedClass =
        connection.sourceConceptId === state.selectedConceptId ||
        connection.targetConceptId === state.selectedConceptId
          ? "is-selected"
          : "";

      return `
        <line
          class="map-edge ${selectedClass}"
          x1="${source.x + mapNodeSize / 2}"
          y1="${source.y + mapNodeSize / 2}"
          x2="${target.x + mapNodeSize / 2}"
          y2="${target.y + mapNodeSize / 2}"
          stroke-width="${2 + connection.strength}"
        />
      `;
    })
    .join("");
}

function renderNodes() {
  if (!state.concepts.length) {
    elements.mapNodes.innerHTML =
      '<div class="empty-state map-empty-state">No concepts yet. Save a note to extract concepts first.</div>';
    return;
  }

  elements.mapNodes.innerHTML = state.concepts
    .map((concept) => {
      const position = state.positions.get(concept.id);
      const selectedClass = concept.id === state.selectedConceptId ? "is-selected" : "";
      const confidence = Math.round((concept.confidenceScore || 0) * 100);

      return `
        <button
          class="map-node ${selectedClass}"
          type="button"
          data-concept-id="${concept.id}"
          style="left: ${position.x}px; top: ${position.y}px;"
        >
          <span class="map-node-name">${escapeHtml(concept.name)}</span>
          <span class="map-node-meta">${escapeHtml(concept.category)} · ${confidence}%</span>
        </button>
      `;
    })
    .join("");

  for (const node of elements.mapNodes.querySelectorAll("[data-concept-id]")) {
    node.addEventListener("click", () => selectConcept(node.dataset.conceptId));
    node.addEventListener("pointerdown", startDrag);
  }
}

function renderInspector() {
  const concept = conceptById(state.selectedConceptId);

  if (!concept) {
    elements.conceptInspector.innerHTML =
      '<div class="empty-state">Select a concept bubble to inspect it.</div>';
    return;
  }

  const relatedConnections = state.connections.filter(
    (connection) =>
      connection.sourceConceptId === concept.id || connection.targetConceptId === concept.id
  );

  elements.conceptInspector.innerHTML = `
    <article class="map-detail-card">
      <h4>${escapeHtml(concept.name)}</h4>
      <p>${escapeHtml(concept.summary || "")}</p>
      <div class="meta-text">Category: ${escapeHtml(concept.category || "general")}</div>
      <div class="meta-text">Confidence: ${Math.round((concept.confidenceScore || 0) * 100)}%</div>
      <div class="meta-text">Source: ${escapeHtml(concept.sourceSpan || "")}</div>
    </article>
    <div class="map-connection-list">
      ${
        relatedConnections.length
          ? relatedConnections.map(renderConnectionControl).join("")
          : '<div class="empty-state">No connections for this concept yet.</div>'
      }
    </div>
  `;

  for (const input of elements.conceptInspector.querySelectorAll("[data-strength-id]")) {
    input.addEventListener("change", () => updateConnectionStrength(input.dataset.strengthId, input.value));
  }

  for (const button of elements.conceptInspector.querySelectorAll("[data-delete-id]")) {
    button.addEventListener("click", () => deleteConnection(button.dataset.deleteId));
  }
}

function renderConnectionControl(connection) {
  const otherConceptId =
    connection.sourceConceptId === state.selectedConceptId
      ? connection.targetConceptId
      : connection.sourceConceptId;
  const otherConcept = conceptById(otherConceptId);

  return `
    <div class="map-connection-item">
      <div>
        <strong>${escapeHtml(otherConcept?.name || "Unknown concept")}</strong>
        <div class="meta-text">${escapeHtml(connection.origin)} relation</div>
      </div>
      <select class="text-input map-strength-select" data-strength-id="${connection.id}">
        ${[1, 2, 3, 4, 5]
          .map(
            (strength) =>
              `<option value="${strength}" ${strength === connection.strength ? "selected" : ""}>${strength}</option>`
          )
          .join("")}
      </select>
      <button class="ghost-button" type="button" data-delete-id="${connection.id}">
        Delete
      </button>
    </div>
  `;
}

function selectConcept(conceptId) {
  state.selectedConceptId = conceptId;
  render();
}

function startDrag(event) {
  const conceptId = event.currentTarget.dataset.conceptId;
  const current = state.positions.get(conceptId);

  if (!current) {
    return;
  }

  state.dragging = {
    conceptId,
    pointerId: event.pointerId,
    offsetX: pointerCanvasX(event) - current.x,
    offsetY: pointerCanvasY(event) - current.y
  };
  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.addEventListener("pointermove", moveDrag);
  event.currentTarget.addEventListener("pointerup", endDrag, { once: true });
  event.currentTarget.addEventListener("pointercancel", endDrag, { once: true });
}

function moveDrag(event) {
  if (!state.dragging || event.pointerId !== state.dragging.pointerId) {
    return;
  }

  const position = {
    x: Math.max(
      0,
      Math.min(canvasSize.width - mapNodeSize, pointerCanvasX(event) - state.dragging.offsetX)
    ),
    y: Math.max(
      0,
      Math.min(canvasSize.height - mapNodeSize, pointerCanvasY(event) - state.dragging.offsetY)
    )
  };
  state.positions.set(state.dragging.conceptId, position);
  renderEdges();

  const node = elements.mapNodes.querySelector(
    `[data-concept-id="${state.dragging.conceptId}"]`
  );

  if (node) {
    node.style.left = `${position.x}px`;
    node.style.top = `${position.y}px`;
  }
}

async function endDrag(event) {
  if (!state.dragging || event.pointerId !== state.dragging.pointerId) {
    return;
  }

  const conceptId = state.dragging.conceptId;
  const position = state.positions.get(conceptId);
  event.currentTarget.removeEventListener("pointermove", moveDrag);
  state.dragging = null;

  if (!position) {
    return;
  }

  try {
    await apiJson(`/api/map/nodes/${encodeURIComponent(conceptId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(position)
    });
  } catch (error) {
    showError(error.message);
  }
}

async function saveConnection() {
  clearError();
  setStatus("Saving");

  try {
    await apiJson("/api/map/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceConceptId: elements.sourceConceptSelect.value,
        targetConceptId: elements.targetConceptSelect.value,
        strength: elements.connectionStrengthInput.value
      })
    });
    await refreshMap();
    setStatus("Ready");
  } catch (error) {
    setStatus("Error");
    showError(error.message);
  }
}

async function updateConnectionStrength(connectionId, strength) {
  const connection = state.connections.find((entry) => entry.id === connectionId);

  if (!connection) {
    return;
  }

  try {
    await apiJson("/api/map/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceConceptId: connection.sourceConceptId,
        targetConceptId: connection.targetConceptId,
        strength
      })
    });
    await refreshMap();
  } catch (error) {
    showError(error.message);
  }
}

async function deleteConnection(connectionId) {
  clearError();

  try {
    await apiJson(`/api/map/connections/${encodeURIComponent(connectionId)}`, {
      method: "DELETE"
    });
    await refreshMap();
  } catch (error) {
    showError(error.message);
  }
}

async function rebuildMap() {
  clearError();

  if (!window.confirm("Rebuild all connections from scratch? Manual links will be forgotten.")) {
    return;
  }

  setStatus("Rebuilding");

  try {
    const payload = await apiJson("/api/map/rebuild", { method: "POST" });
    state.concepts = payload.concepts;
    state.nodes = payload.nodes;
    state.connections = payload.connections;
    hydratePositions();
    render();
    setStatus("Ready");
  } catch (error) {
    setStatus("Error");
    showError(error.message);
  }
}

function conceptById(conceptId) {
  return state.concepts.find((concept) => concept.id === conceptId);
}

function pointerCanvasX(event) {
  const rect = elements.mapCanvas.getBoundingClientRect();
  return event.clientX - rect.left + elements.mapCanvas.scrollLeft;
}

function pointerCanvasY(event) {
  const rect = elements.mapCanvas.getBoundingClientRect();
  return event.clientY - rect.top + elements.mapCanvas.scrollTop;
}

function setStatus(status) {
  elements.mapStatus.textContent = status;
}

function showError(message) {
  elements.mapErrorMessage.hidden = false;
  elements.mapErrorMessage.textContent = message;
}

function clearError() {
  elements.mapErrorMessage.hidden = true;
  elements.mapErrorMessage.textContent = "";
}

initialize().catch((error) => {
  setStatus("Error");
  showError(error.message);
});
