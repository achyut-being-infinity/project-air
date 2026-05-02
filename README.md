# AIR (Am I Ready) — MVP

This repository contains a minimal prototype of AIR — a job readiness evaluator.

Backend: Node.js + Express (backend/index.js)
Frontend: React + TypeScript (frontend/)

Quick start

1. Backend

 - Create a `.env` file in `backend/` with `DATABASE_URL` pointing to your Postgres (Neon) connection string.
 - If you want Gemini-powered analysis, add `GEMINI_API_KEY` to the same `.env` file. Keep API keys on the backend only.
 - Install and run:

```bash
cd backend
npm install
npm run dev
```

Backend runs on `http://localhost:3000` and exposes endpoints:

- `POST /analyze` { resumeText, jdText } -> analysis JSON
- `POST /generate-pretest` { skills } -> pretest questions
- `POST /submit-results` -> saves test result to Postgres
- `GET /results` -> recent saved results

2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the Vite dev server URL (usually `http://localhost:5173`). The UI now supports:

- Resume upload as PDF.
- Job description paste or upload.
- Readiness score, strong skills, missing skills, weak areas.
- Pre-test generation and scoring.
- Recommended resources and a preparation roadmap.

Notes & Next steps

- This is an MVP prototype: no auth, no advanced resume parsing, and AI output still falls back to heuristics if `GEMINI_API_KEY` is missing.
- Tailwind/shadCN are not fully wired in this prototype. The UI uses handcrafted dark styling to stay runnable without extra setup.
