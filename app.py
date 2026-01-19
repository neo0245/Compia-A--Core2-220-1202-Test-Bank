import base64
import json
import os
import random
from datetime import datetime, timezone
from flask import Flask, jsonify, render_template, request, abort

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
SESSIONS_PATH = os.path.join(DATA_DIR, "sessions.b64")
HISTORY_PATH = os.path.join(DATA_DIR, "history.b64")
NOTES_PATH = os.path.join(DATA_DIR, "notes.b64")

QUESTION_BANKS = {
    "comptia": os.path.join(BASE_DIR, "comptia_questions_real.b64"),
    "quiz": os.path.join(BASE_DIR, "quiz_questions.b64"),
}

app = Flask(__name__)


def ensure_data_files():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(SESSIONS_PATH):
        save_json(SESSIONS_PATH, {})
    if not os.path.exists(HISTORY_PATH):
        save_json(HISTORY_PATH, [])
    if not os.path.exists(NOTES_PATH):
        save_json(NOTES_PATH, {})


def load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, "rb") as f:
        encoded = f.read()
    if not encoded:
        return default
    decoded = base64.b64decode(encoded)
    return json.loads(decoded.decode("utf-8"))


def save_json(path, payload):
    raw = json.dumps(payload, ensure_ascii=True, indent=2).encode("utf-8")
    encoded = base64.b64encode(raw)
    with open(path, "wb") as f:
        f.write(encoded)


def load_questions(bank_id):
    path = QUESTION_BANKS.get(bank_id)
    if not path or not os.path.exists(path):
        abort(404, description="Question bank not found")
    with open(path, "rb") as f:
        encoded = f.read()
    decoded = base64.b64decode(encoded)
    raw = json.loads(decoded.decode("utf-8"))
    questions = []
    for idx, item in enumerate(raw):
        questions.append(
            {
                "id": idx,
                "question_no": item.get("question_no"),
                "question_field": item.get("question_field"),
                "question_type": item.get("question_type"),
                "question_text": item.get("question_text"),
                "options": item.get("options", []),
                "answer": item.get("answer"),
                "explanation": item.get("explanation"),
            }
        )
    return questions


def now_label():
    return datetime.now().strftime("%Y-%m-%d_%H-%M-%S")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def make_session_id(bank_id):
    return f"{now_label()}_{bank_id}"


def parse_answer_letter(option_text):
    if not option_text:
        return ""
    trimmed = option_text.strip()
    if "." in trimmed:
        return trimmed.split(".", 1)[0].strip()
    return trimmed[:1]


def get_banks():
    banks = []
    for bank_id, path in QUESTION_BANKS.items():
        if os.path.exists(path):
            questions = load_questions(bank_id)
            label = "CompTIA A+" if bank_id == "comptia" else "Quiz"
            banks.append({"id": bank_id, "label": label, "count": len(questions)})
    return banks


def load_sessions():
    return load_json(SESSIONS_PATH, {})


def save_sessions(sessions):
    save_json(SESSIONS_PATH, sessions)


def load_history():
    return load_json(HISTORY_PATH, [])


def save_history(records):
    save_json(HISTORY_PATH, records)


def load_notes():
    return load_json(NOTES_PATH, {})


def save_notes(notes):
    save_json(NOTES_PATH, notes)


def session_notes_payload(session):
    notes_store = load_notes()
    bank_notes = notes_store.get(session["bank"], {})
    merged = {}
    for idx, question_id in enumerate(session["questions"]):
        idx_str = str(idx)
        note = session.get("notes", {}).get(idx_str)
        if not note:
            note = bank_notes.get(str(question_id))
        if note:
            merged[idx_str] = note
    return merged


def session_summary(session):
    return {
        "id": session["id"],
        "bank": session["bank"],
        "created_at": session["created_at"],
        "start_time": session.get("start_time"),
        "current_index": session["current_index"],
        "total": len(session["questions"]),
        "terminated": session.get("terminated", False),
        "completed": session.get("completed", False),
    }


def question_payload(bank_id, question_id):
    questions = load_questions(bank_id)
    question = questions[question_id]
    return {
        "id": question["id"],
        "question_no": question.get("question_no"),
        "question_field": question.get("question_field"),
        "question_text": question.get("question_text"),
        "options": question.get("options"),
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/banks", methods=["GET"])
def api_banks():
    return jsonify({"banks": get_banks()})


@app.route("/api/sessions", methods=["GET"])
def api_sessions_list():
    sessions = load_sessions()
    summaries = [session_summary(s) for s in sessions.values() if not s.get("terminated")]
    summaries.sort(key=lambda s: s["created_at"], reverse=True)
    return jsonify({"sessions": summaries})


@app.route("/api/sessions", methods=["POST"])
def api_sessions_create():
    payload = request.get_json(force=True)
    bank_id = payload.get("bank")
    mode = payload.get("mode", "full")
    review_source = payload.get("review_source")

    questions = load_questions(bank_id)
    question_ids = list(range(len(questions)))

    if mode == "review":
        history = load_history()
        record = next((r for r in history if r["id"] == review_source), None)
        if not record:
            abort(400, description="Review source not found")
        question_ids = record.get("incorrect_ids", [])
        if not question_ids:
            abort(400, description="No incorrect questions to review")

    random.shuffle(question_ids)

    session_id = make_session_id(bank_id)
    session = {
        "id": session_id,
        "bank": bank_id,
        "created_at": now_iso(),
        "current_index": 0,
        "questions": question_ids,
        "answers": {},
        "flags": {},
        "notes": {},
        "terminated": False,
        "completed": False,
        "start_time": now_iso(),
        "last_active": now_iso(),
    }

    sessions = load_sessions()
    sessions[session_id] = session
    save_sessions(sessions)

    return jsonify({"session": session_summary(session)})


@app.route("/api/sessions/<session_id>", methods=["GET"])
def api_session_detail(session_id):
    sessions = load_sessions()
    session = sessions.get(session_id)
    if not session:
        abort(404)
    session["last_active"] = now_iso()
    save_sessions(sessions)

    idx = session["current_index"]
    if idx < 0 or idx >= len(session["questions"]):
        idx = 0
        session["current_index"] = idx
        save_sessions(sessions)
    question_id = session["questions"][idx]

    return jsonify(
        {
            "session": session_summary(session),
            "question": question_payload(session["bank"], question_id),
            "status": {
                "answers": session.get("answers", {}),
                "flags": session.get("flags", {}),
                "notes": session_notes_payload(session),
            },
        }
    )


@app.route("/api/sessions/<session_id>/navigate", methods=["POST"])
def api_session_navigate(session_id):
    payload = request.get_json(force=True)
    target_index = int(payload.get("question_index", 0))

    sessions = load_sessions()
    session = sessions.get(session_id)
    if not session:
        abort(404)

    if target_index < 0 or target_index >= len(session["questions"]):
        abort(400, description="Invalid question index")

    session["current_index"] = target_index
    session["last_active"] = now_iso()
    sessions[session_id] = session
    save_sessions(sessions)

    question_id = session["questions"][target_index]
    notes_store = load_notes()
    bank_notes = notes_store.get(session["bank"], {})
    note = session.get("notes", {}).get(str(target_index)) or bank_notes.get(str(question_id)) or ""
    return jsonify({"question": question_payload(session["bank"], question_id), "note": note})


@app.route("/api/sessions/<session_id>/answer", methods=["POST"])
def api_session_answer(session_id):
    payload = request.get_json(force=True)
    question_index = str(payload.get("question_index"))
    answer = payload.get("answer", "").strip()

    sessions = load_sessions()
    session = sessions.get(session_id)
    if not session:
        abort(404)

    try:
        idx = int(question_index)
    except ValueError:
        abort(400)

    if idx < 0 or idx >= len(session["questions"]):
        abort(400)

    question_id = session["questions"][idx]
    questions = load_questions(session["bank"])
    question = questions[question_id]

    correct_letter = str(question.get("answer", "")).strip()

    session.setdefault("answers", {})[question_index] = answer
    session["last_active"] = now_iso()
    sessions[session_id] = session
    save_sessions(sessions)

    return jsonify({"correct": answer == correct_letter, "correct_answer": correct_letter})


@app.route("/api/sessions/<session_id>/flag", methods=["POST"])
def api_session_flag(session_id):
    payload = request.get_json(force=True)
    question_index = str(payload.get("question_index"))
    flagged = bool(payload.get("flagged"))

    sessions = load_sessions()
    session = sessions.get(session_id)
    if not session:
        abort(404)

    session.setdefault("flags", {})[question_index] = flagged
    session["last_active"] = now_iso()
    sessions[session_id] = session
    save_sessions(sessions)

    return jsonify({"flagged": flagged})


@app.route("/api/sessions/<session_id>/note", methods=["POST"])
def api_session_note(session_id):
    payload = request.get_json(force=True)
    question_index = str(payload.get("question_index"))
    raw_note = payload.get("note", "")
    note = raw_note.strip()

    sessions = load_sessions()
    session = sessions.get(session_id)
    if not session:
        abort(404)

    answers = session.get("answers", {})
    if question_index not in answers:
        abort(400, description="Answer required before note")

    try:
        idx = int(question_index)
    except ValueError:
        abort(400)
    if idx < 0 or idx >= len(session["questions"]):
        abort(400)

    question_id = session["questions"][idx]
    notes_store = load_notes()
    bank_notes = notes_store.setdefault(session["bank"], {})

    if note:
        session.setdefault("notes", {})[question_index] = raw_note
        bank_notes[str(question_id)] = raw_note
    else:
        session.get("notes", {}).pop(question_index, None)
        bank_notes.pop(str(question_id), None)
    save_notes(notes_store)
    session["last_active"] = now_iso()
    sessions[session_id] = session
    save_sessions(sessions)

    return jsonify({"note": raw_note})


@app.route("/api/sessions/<session_id>/finish", methods=["POST"])
def api_session_finish(session_id):
    sessions = load_sessions()
    session = sessions.get(session_id)
    if not session:
        abort(404)

    bank_id = session["bank"]
    questions = load_questions(bank_id)

    incorrect_ids = []
    correct_count = 0
    for idx, question_id in enumerate(session["questions"]):
        idx_str = str(idx)
        user_answer = session.get("answers", {}).get(idx_str)
        if user_answer is None:
            continue
        correct_answer = str(questions[question_id].get("answer", "")).strip()
        if user_answer == correct_answer:
            correct_count += 1
        else:
            incorrect_ids.append(question_id)

    total = len(session["questions"])
    record_id = f"{now_label()}_{bank_id}"
    record = {
        "id": record_id,
        "name": record_id,
        "created_at": now_iso(),
        "bank": bank_id,
        "total": total,
        "correct": correct_count,
        "incorrect_ids": incorrect_ids,
        "answers": session.get("answers", {}),
        "notes": session.get("notes", {}),
    }

    history = load_history()
    history.insert(0, record)
    save_history(history)

    session["terminated"] = True
    session["completed"] = True
    session["last_active"] = now_iso()
    sessions[session_id] = session
    save_sessions(sessions)

    return jsonify({"record": record})


@app.route("/api/sessions/<session_id>/terminate", methods=["POST"])
def api_session_terminate(session_id):
    sessions = load_sessions()
    session = sessions.get(session_id)
    if not session:
        abort(404)
    session["terminated"] = True
    session["last_active"] = now_iso()
    sessions[session_id] = session
    save_sessions(sessions)
    return jsonify({"terminated": True})


@app.route("/api/sessions/<session_id>", methods=["DELETE"])
def api_session_delete(session_id):
    sessions = load_sessions()
    if session_id not in sessions:
        abort(404)
    del sessions[session_id]
    save_sessions(sessions)
    return jsonify({"deleted": True})


@app.route("/api/sessions/<session_id>/status", methods=["GET"])
def api_session_status(session_id):
    sessions = load_sessions()
    session = sessions.get(session_id)
    if not session:
        abort(404)

    questions = load_questions(session["bank"])
    statuses = []
    for idx, question_id in enumerate(session["questions"]):
        idx_str = str(idx)
        answer = session.get("answers", {}).get(idx_str)
        correct_answer = str(questions[question_id].get("answer", "")).strip()
        flagged = bool(session.get("flags", {}).get(idx_str))
        statuses.append(
            {
                "index": idx,
                "answered": answer is not None,
                "correct": answer == correct_answer if answer is not None else None,
                "flagged": flagged,
                "correct_answer": correct_answer,
            }
        )

    return jsonify({"statuses": statuses})


@app.route("/api/history", methods=["GET"])
def api_history_list():
    history = load_history()
    return jsonify({"history": history})


@app.route("/api/history/<record_id>/rename", methods=["POST"])
def api_history_rename(record_id):
    payload = request.get_json(force=True)
    name = payload.get("name", "").strip()
    if not name:
        abort(400)

    history = load_history()
    record = next((r for r in history if r["id"] == record_id), None)
    if not record:
        abort(404)

    record["name"] = name
    save_history(history)
    return jsonify({"record": record})


@app.route("/api/history/<record_id>", methods=["DELETE"])
def api_history_delete(record_id):
    history = load_history()
    history = [r for r in history if r["id"] != record_id]
    save_history(history)
    return jsonify({"deleted": True})


if __name__ == "__main__":
    ensure_data_files()
    app.run(host="0.0.0.0", port=5002, debug=True)
