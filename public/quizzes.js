import { apiJson, escapeHtml, formatDate, initializeAppearance } from "./shared.js";

const state = {
  quizzes: [],
  activeQuizId: null,
  quizStatus: "Idle"
};

const elements = {
  quizCountInput: document.querySelector("#quiz-count-input"),
  generateQuizButton: document.querySelector("#generate-quiz-button"),
  quizzesList: document.querySelector("#quizzes-list"),
  quizWorkspace: document.querySelector("#quiz-workspace"),
  quizStatus: document.querySelector("#quiz-status"),
  quizErrorMessage: document.querySelector("#quiz-error-message")
};

async function initialize() {
  initializeAppearance();
  bindEvents();
  await refreshQuizzes();
}

function bindEvents() {
  elements.generateQuizButton.addEventListener("click", generateQuiz);
  elements.quizWorkspace.addEventListener("click", (event) => {
    if (event.target.id === "submit-quiz-button") {
      submitActiveQuiz();
    }
  });
}

async function refreshQuizzes() {
  state.quizzes = await apiJson("/api/quizzes");

  if (!state.activeQuizId && state.quizzes[0]) {
    state.activeQuizId = state.quizzes[0].id;
  }

  renderQuizzes();
}

function renderQuizzes() {
  renderQuizzesList();
  renderQuizWorkspace();
}

function renderQuizzesList() {
  if (!state.quizzes.length) {
    elements.quizzesList.innerHTML =
      '<div class="empty-state">No quiz sessions yet. Generate one from your concepts.</div>';
    return;
  }

  elements.quizzesList.innerHTML = state.quizzes
    .map((quiz) => {
      const activeClass = quiz.id === state.activeQuizId ? "is-active" : "";
      return `
        <button class="quiz-item ${activeClass}" data-quiz-id="${quiz.id}" type="button">
          <div class="quiz-item-topline">
            <h4>${escapeHtml(quiz.noteTitle || "Mixed concepts")}</h4>
            <span class="status-chip ${quiz.status === "completed" ? "is-complete" : ""}">
              ${escapeHtml(quiz.status)}
            </span>
          </div>
          <div class="meta-text">${formatDate(quiz.updatedAt)}</div>
          <p class="note-snippet">${quiz.items.length} prompt${quiz.items.length === 1 ? "" : "s"}</p>
        </button>
      `;
    })
    .join("");

  for (const button of elements.quizzesList.querySelectorAll("[data-quiz-id]")) {
    button.addEventListener("click", () => {
      state.activeQuizId = button.dataset.quizId;
      renderQuizzes();
    });
  }
}

function renderQuizWorkspace() {
  const activeQuiz = state.quizzes.find((quiz) => quiz.id === state.activeQuizId);

  if (!activeQuiz) {
    elements.quizWorkspace.innerHTML =
      '<div class="empty-state">Generate a quiz and answer it here.</div>';
    return;
  }

  if (activeQuiz.status === "completed") {
    elements.quizWorkspace.innerHTML = `
      <div class="quiz-session-summary">
        <div class="meta-text">Completed ${formatDate(activeQuiz.completedAt)}</div>
      </div>
      <div class="quiz-question-list">
        ${activeQuiz.items
          .map((item) => {
            const response = activeQuiz.responses.find((entry) => entry.itemId === item.id);
            return `
              <article class="quiz-question-card">
                <div class="quiz-question-header">
                  <span class="status-chip">${escapeHtml(item.questionType)}</span>
                </div>
                <h4>${escapeHtml(item.prompt)}</h4>
                <div class="quiz-answer-block">
                  <strong>Your answer</strong>
                  <p>${escapeHtml(response?.answerText || "")}</p>
                </div>
                <div class="quiz-answer-block">
                  <strong>Reference answer</strong>
                  <p>${escapeHtml(item.answer)}</p>
                </div>
                <div class="meta-text">Self-rating: ${escapeHtml(String(response?.selfRating || "-"))}/5</div>
              </article>
            `;
          })
          .join("")}
      </div>
    `;
    return;
  }

  elements.quizWorkspace.innerHTML = `
    <div class="quiz-session-summary">
      <div class="meta-text">Created ${formatDate(activeQuiz.createdAt)}</div>
      <div class="meta-text">${activeQuiz.items.length} active prompts</div>
    </div>
    <div class="quiz-question-list">
      ${activeQuiz.items
        .map(
          (item, index) => `
            <article class="quiz-question-card">
              <div class="quiz-question-header">
                <span class="status-chip">${escapeHtml(item.questionType)}</span>
                <span class="meta-text">Prompt ${index + 1}</span>
              </div>
              <h4>${escapeHtml(item.prompt)}</h4>
              <label class="field-label" for="answer-${item.id}">Your answer</label>
              <textarea
                id="answer-${item.id}"
                class="editor-input quiz-answer"
                data-item-id="${item.id}"
                placeholder="Answer from memory first, then submit and compare."
              ></textarea>
              <label class="field-label" for="rating-${item.id}">Self-rating</label>
              <select id="rating-${item.id}" class="text-input quiz-rating" data-item-id="${item.id}">
                <option value="1">1 - Missed it</option>
                <option value="2">2 - Weak recall</option>
                <option value="3" selected>3 - Partial recall</option>
                <option value="4">4 - Mostly right</option>
                <option value="5">5 - Strong recall</option>
              </select>
            </article>
          `
        )
        .join("")}
    </div>
    <button id="submit-quiz-button" class="primary-button" type="button">
      Submit quiz
    </button>
  `;
}

async function generateQuiz() {
  clearQuizError();
  setQuizStatus("Generating");

  try {
    const count = Number.parseInt(elements.quizCountInput.value, 10) || 5;
    const quiz = await apiJson("/api/quizzes/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count })
    });

    state.activeQuizId = quiz.id;
    await refreshQuizzes();
    setQuizStatus("Ready");
  } catch (error) {
    setQuizStatus("Error");
    showQuizError(error.message);
  }
}

async function submitActiveQuiz() {
  const activeQuiz = state.quizzes.find((quiz) => quiz.id === state.activeQuizId);

  if (!activeQuiz) {
    return;
  }

  clearQuizError();
  setQuizStatus("Submitting");

  try {
    const payload = await apiJson(`/api/quizzes/${activeQuiz.id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        responses: activeQuiz.items.map((item) => ({
          itemId: item.id,
          answerText:
            elements.quizWorkspace.querySelector(`.quiz-answer[data-item-id="${item.id}"]`)
              ?.value || "",
          selfRating:
            elements.quizWorkspace.querySelector(`.quiz-rating[data-item-id="${item.id}"]`)
              ?.value || 3
        }))
      })
    });

    const quizIndex = state.quizzes.findIndex((quiz) => quiz.id === payload.quiz.id);
    if (quizIndex >= 0) {
      state.quizzes[quizIndex] = payload.quiz;
    }

    await refreshQuizzes();
    setQuizStatus("Completed");
  } catch (error) {
    setQuizStatus("Error");
    showQuizError(error.message);
  }
}

function setQuizStatus(status) {
  state.quizStatus = status;
  elements.quizStatus.textContent = status;
}

function showQuizError(message) {
  elements.quizErrorMessage.hidden = false;
  elements.quizErrorMessage.textContent = message;
}

function clearQuizError() {
  elements.quizErrorMessage.hidden = true;
  elements.quizErrorMessage.textContent = "";
}

initialize().catch((error) => {
  setQuizStatus("Error");
  showQuizError(error.message);
});
