# CompTIA A+ Exam Engine

A Python + Flask web exam engine with a macOS-inspired liquid glass UI. It loads Base64-encoded question banks, supports full exams and review-only sessions, persists progress across devices, and tracks history with notes.

## Features
- Two separate test banks (CompTIA A+ and Quiz)
- Randomized question order per session
- Full exam or review-only mode (incorrect answers only)
- Persistent sessions across devices until terminated
- Notes per question (available after answering)
- Flag/unflag questions and skip navigation
- Status grid with color-coded results
- Session + history stored Base64-encoded
- Responsive design optimized for Safari/iOS

## Requirements
- Python 3.10+
- pip

## Install

```bash
pip install -r requirements.txt
```

## Run

```bash
python app.py
```

Then open `http://localhost:5002`.

## Files
- `app.py` Flask backend
- `templates/index.html` UI layout
- `static/styles.css` glassmorphism styles
- `static/app.js` client logic
- `comptia_questions_real.b64` Base64 question bank
- `quiz_questions.b64` Base64 question bank
- `data/sessions.b64` Base64 sessions store
- `data/history.b64` Base64 history store

## Notes
- Fullscreen mode is enforced while an exam session is active. Use the Exit button to terminate.
- Review mode only includes questions answered incorrectly; unanswered are ignored.
