const state = {
  sessionId: null,
  session: null,
  status: { answers: {}, flags: {}, notes: {} },
  question: null,
  sessionStart: null,
  allowFullscreenExit: false,
  fontScale: 1,
  noteSaveTimer: null,
};

const elements = {
  homeView: document.getElementById("home-view"),
  examView: document.getElementById("exam-view"),
  bankSelect: document.getElementById("bank-select"),
  reviewSourceWrap: document.getElementById("review-source-wrap"),
  reviewSource: document.getElementById("review-source"),
  startExam: document.getElementById("start-exam"),
  sessionList: document.getElementById("session-list"),
  historyList: document.getElementById("history-list"),
  modeFull: document.getElementById("mode-full"),
  modeReview: document.getElementById("mode-review"),
  questionNumber: document.getElementById("question-number"),
  questionField: document.getElementById("question-field"),
  questionText: document.getElementById("question-text"),
  options: document.getElementById("options"),
  noteInput: document.getElementById("note-input"),
  noteSection: document.getElementById("note-section"),
  correctAnswer: document.getElementById("correct-answer"),
  prevQuestion: document.getElementById("prev-question"),
  nextQuestion: document.getElementById("next-question"),
  skipQuestion: document.getElementById("skip-question"),
  flagQuestion: document.getElementById("flag-question"),
  finishExam: document.getElementById("finish-exam"),
  exitExam: document.getElementById("exit-exam"),
  backHome: document.getElementById("back-home"),
  progressFill: document.getElementById("progress-fill"),
  statusButton: document.getElementById("status-button"),
  statusModal: document.getElementById("status-modal"),
  statusGrid: document.getElementById("status-grid"),
  closeStatus: document.getElementById("close-status"),
  currentTime: document.getElementById("current-time"),
  sessionTime: document.getElementById("session-time"),
  fullscreenToggle: document.getElementById("fullscreen-toggle"),
  fontReset: document.getElementById("font-reset"),
  fontSmaller: document.getElementById("font-smaller"),
  fontLarger: document.getElementById("font-larger"),
};

const formatTime = (date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const formatDuration = (seconds) => {
  const hrs = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const mins = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");
  return `${hrs}:${mins}:${secs}`;
};

const fetchJSON = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Request failed");
  }
  return response.json();
};

const showView = (view) => {
  elements.homeView.classList.toggle("active", view === "home");
  elements.examView.classList.toggle("active", view === "exam");
};

const setFontScale = (value) => {
  state.fontScale = Math.max(0.85, Math.min(1.3, value));
  document.documentElement.style.setProperty("--font-scale", state.fontScale);
  localStorage.setItem("fontScale", state.fontScale);
};

const parseAnswerLetter = (text) => {
  if (!text) return "";
  const trimmed = text.trim();
  if (trimmed.includes(".")) {
    return trimmed.split(".", 1)[0].trim();
  }
  return trimmed.charAt(0);
};

const loadBanks = async () => {
  const data = await fetchJSON("/api/banks");
  elements.bankSelect.innerHTML = "";
  data.banks.forEach((bank) => {
    const option = document.createElement("option");
    option.value = bank.id;
    option.textContent = `${bank.label} (${bank.count})`;
    elements.bankSelect.appendChild(option);
  });
};

const loadSessions = async () => {
  const data = await fetchJSON("/api/sessions");
  elements.sessionList.innerHTML = "";
  if (data.sessions.length === 0) {
    elements.sessionList.textContent = "No active sessions.";
    return;
  }
  data.sessions.forEach((session) => {
    const card = document.createElement("div");
    card.className = "list-item";
    card.innerHTML = `
      <strong>${session.id}</strong>
      <small>${session.bank} · ${session.current_index + 1}/${session.total}</small>
    `;
    const actions = document.createElement("div");
    actions.className = "list-actions";
    const resume = document.createElement("button");
    resume.className = "button primary";
    resume.textContent = "Resume";
    resume.addEventListener("click", () => loadSession(session.id));
    const remove = document.createElement("button");
    remove.className = "button danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      if (!confirm("Delete this session?")) return;
      await fetchJSON(`/api/sessions/${session.id}`, { method: "DELETE" });
      await loadSessions();
    });
    actions.appendChild(resume);
    actions.appendChild(remove);
    card.appendChild(actions);
    elements.sessionList.appendChild(card);
  });
};

const loadHistory = async () => {
  const data = await fetchJSON("/api/history");
  elements.historyList.innerHTML = "";
  elements.reviewSource.innerHTML = "";
  if (data.history.length === 0) {
    elements.historyList.textContent = "No history records yet.";
    return;
  }
  data.history.forEach((record) => {
    const card = document.createElement("div");
    card.className = "list-item";
    card.innerHTML = `
      <strong>${record.name}</strong>
      <small>${record.bank} · ${record.correct}/${record.total} correct</small>
    `;
    const actions = document.createElement("div");
    actions.className = "list-actions";

    const reviewBtn = document.createElement("button");
    reviewBtn.className = "button outline";
    reviewBtn.textContent = "Review";
    reviewBtn.addEventListener("click", () => startReview(record.id));

    const renameBtn = document.createElement("button");
    renameBtn.className = "button ghost";
    renameBtn.textContent = "Rename";
    renameBtn.addEventListener("click", async () => {
      const name = prompt("New name", record.name);
      if (!name) return;
      await fetchJSON(`/api/history/${record.id}/rename`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      await loadHistory();
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "button danger";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      if (!confirm("Delete this record?")) return;
      await fetchJSON(`/api/history/${record.id}`, { method: "DELETE" });
      await loadHistory();
    });

    actions.appendChild(reviewBtn);
    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    card.appendChild(actions);
    elements.historyList.appendChild(card);

    const option = document.createElement("option");
    option.value = record.id;
    option.textContent = record.name;
    elements.reviewSource.appendChild(option);
  });
};

const startExam = async (mode = "full", reviewSource = null) => {
  const bank = elements.bankSelect.value;
  const payload = { bank, mode };
  if (mode === "review") payload.review_source = reviewSource;
  const data = await fetchJSON("/api/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  await loadSession(data.session.id);
};

const startReview = async (recordId) => {
  elements.modeReview.classList.add("selected");
  elements.modeFull.classList.remove("selected");
  elements.reviewSourceWrap.classList.remove("hidden");
  elements.reviewSource.value = recordId;
  await startExam("review", recordId);
};

const loadSession = async (sessionId) => {
  const data = await fetchJSON(`/api/sessions/${sessionId}`);
  state.sessionId = sessionId;
  state.session = data.session;
  state.status = data.status;
  state.question = data.question;
  state.sessionStart = new Date(data.session.start_time || data.session.created_at);
  showView("exam");
  renderQuestion();
  updateProgress();
};

const updateProgress = () => {
  if (!state.session) return;
  const total = state.session.total || 1;
  const current = state.session.current_index + 1;
  const percent = Math.round((current / total) * 100);
  elements.progressFill.style.width = `${percent}%`;
};

const updateTimers = () => {
  elements.currentTime.textContent = formatTime(new Date());
  if (state.sessionStart) {
    const elapsed = Math.floor((Date.now() - state.sessionStart.getTime()) / 1000);
    elements.sessionTime.textContent = formatDuration(Math.max(0, elapsed));
  }
};

const renderOptions = () => {
  elements.options.innerHTML = "";
  const answerKey = state.status.answers[String(state.session.current_index)];

  state.question.options.forEach((optionText) => {
    const option = document.createElement("button");
    option.className = "option";
    option.type = "button";
    option.textContent = optionText;

    const letter = parseAnswerLetter(optionText);
    if (answerKey && letter === answerKey) {
      option.classList.add("selected");
    }

    option.addEventListener("click", async () => {
      const response = await fetchJSON(`/api/sessions/${state.sessionId}/answer`, {
        method: "POST",
        body: JSON.stringify({
          question_index: state.session.current_index,
          answer: letter,
        }),
      });
      state.status.answers[String(state.session.current_index)] = letter;
      updateOptionsFeedback(response.correct, letter, response.correct_answer);
      updateNoteState();
    });

    elements.options.appendChild(option);
  });

  applyCurrentAnswerStyle();
};

const applyCurrentAnswerStyle = async () => {
  const answerKey = state.status.answers[String(state.session.current_index)];
  if (!answerKey) return;
  const response = await fetchJSON(`/api/sessions/${state.sessionId}/status`);
  const currentStatus = response.statuses[state.session.current_index];
  updateOptionsFeedback(currentStatus.correct, answerKey, currentStatus.correct_answer);
};

const updateOptionsFeedback = (isCorrect, answerLetter, correctLetter) => {
  const optionButtons = elements.options.querySelectorAll(".option");
  optionButtons.forEach((button) => {
    const letter = parseAnswerLetter(button.textContent);
    button.classList.remove("correct", "wrong");
    if (letter === answerLetter) {
      if (isCorrect === true) {
        button.classList.add("correct");
      } else if (isCorrect === false) {
        button.classList.add("wrong");
      }
    }
    if (isCorrect === false && correctLetter && letter === correctLetter) {
      button.classList.add("correct");
    }
  });
  setCorrectAnswerDisplay(correctLetter);
};

const setCorrectAnswerDisplay = (correctLetter) => {
  if (!correctLetter) return;
  const matched = state.question.options.find(
    (optionText) => parseAnswerLetter(optionText) === correctLetter
  );
  const text = matched || correctLetter;
  elements.correctAnswer.textContent = `Correct answer: ${text}`;
  elements.noteSection.classList.remove("hidden");
};

const renderQuestion = () => {
  if (!state.session || !state.question) return;
  const currentIndex = state.session.current_index;
  elements.questionNumber.textContent = `Question ${currentIndex + 1} of ${state.session.total}`;
  elements.questionField.textContent = state.question.question_field || "";
  elements.questionText.textContent = state.question.question_text || "";
  renderOptions();
  updateFlagButton();
  updateNoteState();
};

const updateNoteState = () => {
  const idx = String(state.session.current_index);
  const answered = idx in state.status.answers;
  elements.noteSection.classList.toggle("hidden", !answered);
  elements.noteInput.disabled = !answered;
  elements.noteInput.value = state.status.notes[idx] || "";
  if (!answered) {
    elements.correctAnswer.textContent = "";
  }
};

const saveCurrentNote = async () => {
  if (!state.session) return;
  const idx = String(state.session.current_index);
  if (!(idx in state.status.answers)) return;
  const note = elements.noteInput.value;
  if (state.status.notes[idx] === note) return;
  await fetchJSON(`/api/sessions/${state.sessionId}/note`, {
    method: "POST",
    body: JSON.stringify({ question_index: idx, note }),
  });
  state.status.notes[idx] = note;
};

const updateFlagButton = () => {
  const idx = String(state.session.current_index);
  const flagged = state.status.flags[idx];
  elements.flagQuestion.textContent = flagged ? "Unflag" : "Flag";
};

const navigateTo = async (index) => {
  await saveCurrentNote();
  const data = await fetchJSON(`/api/sessions/${state.sessionId}/navigate`, {
    method: "POST",
    body: JSON.stringify({ question_index: index }),
  });
  state.session.current_index = index;
  state.question = data.question;
  if (typeof data.note === "string") {
    const idx = String(index);
    if (data.note) {
      state.status.notes[idx] = data.note;
    } else {
      delete state.status.notes[idx];
    }
  }
  renderQuestion();
  updateProgress();
};

const showStatusGrid = async () => {
  const data = await fetchJSON(`/api/sessions/${state.sessionId}/status`);
  elements.statusGrid.innerHTML = "";
  data.statuses.forEach((status) => {
    const item = document.createElement("button");
    item.className = "status-item";
    item.textContent = status.index + 1;
    if (status.flagged) {
      item.classList.add("flagged");
    } else if (status.correct === true) {
      item.classList.add("correct");
    } else if (status.correct === false && status.answered) {
      item.classList.add("wrong");
    }
    item.addEventListener("click", () => {
      elements.statusModal.classList.add("hidden");
      navigateTo(status.index);
    });
    elements.statusGrid.appendChild(item);
  });
};

const exitSession = async () => {
  if (!state.sessionId) return;
  await fetchJSON(`/api/sessions/${state.sessionId}/terminate`, { method: "POST" });
  state.sessionId = null;
  state.session = null;
  state.question = null;
  state.status = { answers: {}, flags: {}, notes: {} };
  state.allowFullscreenExit = true;
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  }
  showView("home");
  await loadSessions();
};

const returnToHome = async () => {
  await saveCurrentNote();
  state.allowFullscreenExit = true;
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  }
  state.sessionId = null;
  state.session = null;
  state.question = null;
  state.status = { answers: {}, flags: {}, notes: {} };
  showView("home");
  await loadSessions();
};

const finishSession = async () => {
  if (!state.sessionId) return;
  await fetchJSON(`/api/sessions/${state.sessionId}/finish`, { method: "POST" });
  await exitSession();
  await loadHistory();
};

const requestFullscreen = async () => {
  if (document.fullscreenElement) return;
  try {
    await document.documentElement.requestFullscreen();
  } catch (error) {
    console.warn("Fullscreen not available", error);
  }
};

const init = async () => {
  const savedScale = parseFloat(localStorage.getItem("fontScale"));
  if (!Number.isNaN(savedScale)) {
    setFontScale(savedScale);
  }

  await loadBanks();
  await loadSessions();
  await loadHistory();
  showView("home");
  updateTimers();
  setInterval(updateTimers, 1000);
};

// Event bindings

elements.modeFull.addEventListener("click", () => {
  elements.modeFull.classList.add("selected");
  elements.modeReview.classList.remove("selected");
  elements.reviewSourceWrap.classList.add("hidden");
});

elements.modeReview.addEventListener("click", () => {
  elements.modeReview.classList.add("selected");
  elements.modeFull.classList.remove("selected");
  elements.reviewSourceWrap.classList.remove("hidden");
});

elements.startExam.addEventListener("click", async () => {
  const mode = elements.modeReview.classList.contains("selected") ? "review" : "full";
  const reviewSource = elements.reviewSource.value;
  try {
    await startExam(mode, reviewSource);
  } catch (error) {
    alert(error.message || "Unable to start exam");
  }
});

elements.prevQuestion.addEventListener("click", () => {
  if (!state.session) return;
  const target = Math.max(0, state.session.current_index - 1);
  navigateTo(target);
});

elements.nextQuestion.addEventListener("click", () => {
  if (!state.session) return;
  const target = Math.min(state.session.total - 1, state.session.current_index + 1);
  navigateTo(target);
});

elements.skipQuestion.addEventListener("click", () => {
  if (!state.session) return;
  const target = Math.min(state.session.total - 1, state.session.current_index + 1);
  navigateTo(target);
});

elements.flagQuestion.addEventListener("click", async () => {
  const idx = String(state.session.current_index);
  const flagged = !state.status.flags[idx];
  await fetchJSON(`/api/sessions/${state.sessionId}/flag`, {
    method: "POST",
    body: JSON.stringify({ question_index: idx, flagged }),
  });
  state.status.flags[idx] = flagged;
  updateFlagButton();
});

elements.noteInput.addEventListener("input", () => {
  if (!state.session) return;
  if (state.noteSaveTimer) {
    clearTimeout(state.noteSaveTimer);
  }
  state.noteSaveTimer = setTimeout(() => {
    saveCurrentNote().catch(() => {});
  }, 500);
});

elements.noteInput.addEventListener("blur", () => {
  saveCurrentNote().catch(() => {});
});

elements.statusButton.addEventListener("click", async () => {
  await showStatusGrid();
  elements.statusModal.classList.remove("hidden");
});

elements.closeStatus.addEventListener("click", () => {
  elements.statusModal.classList.add("hidden");
});

elements.finishExam.addEventListener("click", async () => {
  if (!confirm("Finish and record this exam?")) return;
  await finishSession();
});

elements.exitExam.addEventListener("click", async () => {
  if (!confirm("Exit the session? Unsaved progress will remain unless terminated.")) return;
  await exitSession();
});

elements.backHome.addEventListener("click", async () => {
  await returnToHome();
});

elements.fullscreenToggle.addEventListener("click", async () => {
  state.allowFullscreenExit = false;
  await requestFullscreen();
});

elements.fontSmaller.addEventListener("click", () => {
  setFontScale(state.fontScale - 0.05);
});

elements.fontLarger.addEventListener("click", () => {
  setFontScale(state.fontScale + 0.05);
});

elements.fontReset.addEventListener("click", () => {
  setFontScale(1);
});

document.addEventListener("fullscreenchange", async () => {
  if (!document.fullscreenElement && state.sessionId && !state.allowFullscreenExit) {
    await requestFullscreen();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (state.sessionId) {
    event.preventDefault();
    event.returnValue = "";
  }
});

init();
