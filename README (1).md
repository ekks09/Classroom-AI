# ORIS - Smart Classroom AI

A comprehensive AI-powered classroom management system built with FastAPI, featuring real-time transcription, intelligent Q&A, adaptive quizzing, and advanced analytics.

## 🚀 Architecture

```
┌─────────────────┐      ngrok      ┌──────────────────┐
│   Vercel        │ ◄────────────── │  Your Machine    │
│  (Frontend)     │   HTTPS tunnel  │  (Backend + LLM) │
│  static/        │                 │  main.py         │
└─────────────────┘                 └──────────────────┘
```

- **Frontend**: Static HTML/CSS/JS deployed on Vercel
- **Backend**: FastAPI + your LLM running locally, exposed via ngrok
- **Database**: Supabase (PostgreSQL + pgvector)

## 📁 Project Structure

```
ORIS/
├── main.py                    # FastAPI backend
├── vercel.json               # Vercel deployment config
├── requirements.txt          # Python dependencies
├── static/                   # Frontend (deployed to Vercel)
│   ├── index.html            # Landing/Login page
│   ├── student.html          # Student dashboard
│   ├── teacher.html          # Teacher dashboard
│   ├── css/
│   │   └── oris.css         # Main stylesheet
│   └── js/
│       ├── config.js        # Backend URL config
│       ├── api.js           # REST API client
│       ├── auth.js          # JWT auth helpers
│       ├── socket.js        # Socket.IO wrapper
│       ├── mock.js          # Mock API (offline mode)
│       ├── mock-mode-ui.js  # Mock mode UI
│       ├── student.js       # Student dashboard logic
│       └── teacher.js       # Teacher dashboard logic
```

## 🔧 Setup

### 1. Backend (Your Machine)

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables
export SUPABASE_URL=your_supabase_url
export SUPABASE_KEY=your_supabase_key
export SUPABASE_SERVICE_KEY=your_service_key
export JWT_SECRET=your_jwt_secret

# Run backend
python main.py
```

### 2. Expose Backend via ngrok

```bash
# Install ngrok: https://ngrok.com/download
ngrok http 8000

# Copy the HTTPS URL (e.g., https://xxxx.ngrok-free.app)
```

### 3. Configure Frontend

Open `static/js/config.js` and set your ngrok URL:

```javascript
const NGROK_URL = 'https://xxxx.ngrok-free.app';
```

### 4. Deploy Frontend to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

## 🎨 Features

### For Students
- **AI Learning Assistant**: RAG-powered Q&A with Qwen 2.5
- **Adaptive Quizzing**: AI-generated personalized quizzes
- **Lecture Library**: Browse and search course materials
- **Live Sessions**: Join real-time classroom sessions
- **Study Planner**: AI-generated study schedules
- **Progress Tracking**: Quiz history and topic performance

### For Teachers
- **Lecture Management**: Upload PDF, DOCX, PPTX, TXT, MD
- **Live Sessions**: Create sessions with auto-transcription
- **AI Quiz Generation**: Generate MCQs from lecture content
- **Class Analytics**: System health and engagement metrics

## 🔒 Security

- JWT-based authentication
- Role-based access control (student/teacher/admin)
- CORS protection
- Input validation

## 📝 License

## Frontend on Vercel (important)

- Frontend files live in `static/`, but deployed URLs are `/`, `/student`, `/teacher`, `/js/*`, `/oris.css`.
- Use absolute asset paths in HTML (e.g. `/oris.css`, `/js/config.js`) so pages like `/student` donâ€™t try to load `/student/js/...`.

MIT License

## Frontend debugging (logs)

Static sites on Vercel donâ€™t have server logs for browser JavaScript. This project includes a client-side logger:

- Enable: open your site with `?debug=1` (one time) or press `Ctrl+Shift+L` to toggle the log panel
- Export: in the log panel click **Export** to download a JSON file
- Stored locally: logs are kept in your browser `localStorage` under `oris_logs_v1`

## Backend connection (Render/ngrok)

This frontend calls:

`BACKEND_BASE_URL` + `API_PREFIX` + endpoint path

- Default base URL is set in `static/js/config.js` (`DEFAULT_BACKEND_URL`)
- Default API prefix is `'/api'` (works with `main.py` in this repo)

If your backend exposes endpoints **without** the `/api` prefix (like `/health`, `/auth/login`), open your frontend once with:

- `?apiprefix=none`

Example:

- `https://YOUR_VERCEL_DOMAIN/?backend=https://YOUR_RENDER_OR_NGROK_URL&apiprefix=none`

### Render env vars (backend)

If you deploy `main.py` on Render, set these environment variables:

- `SUPABASE_URL`
- `SUPABASE_KEY`
- `SUPABASE_SERVICE_KEY`
- `JWT_SECRET` (optional, but recommended)

### Render setup (backend)

In Render create a **Web Service** (Python):

- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

If your backend is the notebook version (endpoints like `/health`), use `?apiprefix=none` on the frontend as described above.
