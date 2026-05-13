# ORIS - Smart Classroom AI

A comprehensive AI-powered classroom management system built with FastAPI, featuring real-time transcription, intelligent Q&A, adaptive quizzing, and advanced analytics.

## 🚀 Architecture

```
┌─────────────────────┐      ngrok      ┌─────────────────────────────┐
│   Render            │ ◄────────────── │  Google Colab                 │
│  (Frontend)         │   HTTPS tunnel  │  (Backend + LLM + Notebook) │
│  static/            │                 │  Classroom_Backend.ipynb      │
└─────────────────────┘                 └─────────────────────────────┘
```

- **Frontend**: Static HTML/CSS/JS deployed on Render as a static site
- **Backend**: FastAPI + LLM running in Google Colab notebook (Classroom_Backend.ipynb), exposed via ngrok tunnel
- **Database**: Supabase (PostgreSQL + pgvector)

## 📁 Project Structure

```
ORIS/
├── Classroom_Backend.ipynb   # Jupyter notebook backend (runs on Google Colab)
├── render.yaml               # Render deployment configuration (frontend only)
├── requirements.txt          # Python dependencies (for reference)
└── static/                   # Frontend (deployed to Render)
    ├── index.html            # Landing/Login page
    ├── student.html          # Student dashboard
    ├── teacher.html          # Teacher dashboard
    ├── css/
    │   └── oris.css         # Main stylesheet
    └── js/
        ├── config.js        # Backend URL config (supports BACKEND_URL env var)
        ├── api.js           # REST API client
        ├── auth.js          # JWT auth helpers
        ├── socket.js        # Socket.IO wrapper
        ├── mock.js          # Mock API (offline mode)
        ├── mock-mode-ui.js  # Mock mode UI
        ├── student.js       # Student dashboard logic
        └── teacher.js       # Teacher dashboard logic
```

## 🔧 Setup

### 1. Backend (Google Colab)

1. Upload `Classroom_Backend.ipynb` to Google Colab
2. Set the following secrets in Colab's Secrets pane (🔑 key icon):
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_KEY`: Supabase anon/public key
   - `SUPABASE_SERVICE_KEY`: Supabase service role key (bypasses RLS)
   - `NGROK_AUTH_TOKEN`: From your ngrok.com dashboard (Auth Token)
   - `JWT_SECRET` (optional): If not set, a random one is generated (tokens reset on restart)
3. Run all cells in the notebook sequentially
4. Wait for the LLM to load asynchronously (check logs for "LLM loading in background thread…")
5. When the server starts, note the ngrok URL displayed (e.g., `https://xxxxxxxx.ngrok-free.dev`)

### 2. Frontend (Render)

1. Fork or clone this repository
2. In Render, create a new **Web Service**:
   - Environment: Docker (or use the static site option if available)
   - However, since we have a `render.yaml` that defines a static service, you can use the Render Blueprint:
     - Click "New" → "Blueprint"
     - Connect your repository
     - Render will detect `render.yaml` and create two services:
       - `classroom-ai-frontend` (static site)
       - (Note: The backend is NOT deployed on Render; it runs on Colab)
3. The frontend service will automatically build and deploy from the `static/` directory
4. **Critical**: Configure the frontend to point to your backend:
   - Option A (Recommended): Set the `BACKEND_URL` environment variable in the Render frontend service:
     - Go to your frontend service in Render → Environment → Add Variable
       - Key: `BACKEND_URL`
       - Value: Your ngrok URL from step 1.5 (e.g., `https://xxxxxxxx.ngrok-free.dev`)
   - Option B: Override via URL parameter (temporary, for testing):
     - Visit your Render frontend URL with `?backend=https://YOUR_NGROK_URL`
     - Example: `https://classroom-ai-frontend.onrender.com/?backend=https://xxxxxxxx.ngrok-free.dev`
     - This stores the URL in localStorage and persists until cleared

### 3. Verify Connection

- After setting the backend URL, reload the frontend
- Open browser DevTools → Application → Local Storage
- Check that `oris_backend_url` matches your ngrok URL
- Try logging in (use the default admin: admin / Admin1234! – change password after first login)
- Navigate to student/teacher dashboards and test core features

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
- Secure password hashing (bcrypt)
- Environment-based configuration (no hardcoded secrets in frontend)

## 📝 License

MIT License

## 🛠️ Technical Notes

### Frontend Configuration (`static/js/config.js`)
- The frontend reads the backend URL from:
  1. Environment variable `BACKEND_URL` (set in Render)
  2. localStorage key `oris_backend_url` (set via `?backend=` URL parameter or API)
  3. Fallback hardcoded URL (for development only)
- API prefix defaults to `/api` (matches the FastAPI routes in the notebook)
- Mock mode can be toggled via `?mock=1` or the UI for offline testing

### Backend Endpoints (provided by the Colab notebook)
The backend exposes the following endpoints (all prefixed with `/api` unless noted):
- **Auth**: 
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `GET /api/auth/me`
- **Lectures**:
  - `POST /api/lectures/upload`
  - `GET /api/lectures`
- **Chat / RAG**:
  - `POST /api/ask`
  - `POST /api/ask/stream`
- **Quiz**:
  - `POST /api/quiz/generate`
  - `POST /api/quiz/submit`
- **Sessions**:
  - `POST /api/sessions` (create)
  - `GET /api/sessions` (list)
  - `GET /api/sessions/:session_id`
  - `DELETE /api/sessions/:session_id` (end)
- **Socket.IO**: Real-time communication for live transcription and chat (mounted at root)
- **Health**: `GET /api/health` (returns system status)

### Deploying Backend to Render (Alternative)
If you prefer to host the backend on Render instead of Colab:
1. Extract the FastAPI code from `Classroom_Backend.ipynb` into a `main.py` file
2. Add a `Dockerfile` or use Render's Python service
3. Set the same environment variables (SUPABASE_URL, etc.) in the Render backend service
4. Update the frontend `BACKEND_URL` to point to your Render backend URL
5. Note: The LLM (Qwen 2.5-3B) requires significant GPU resources; ensure your Render plan includes a GPU if needed, or use a smaller model.

## ⚠️ Known Limitations
- **Colab Backend**: 
  - Sessions may disconnect after ~90 minutes of inactivity or 12 hours maximum
  - Free tier ngrok has bandwidth limitations
  - First LLM load may take several minutes
- **Frontend**:
  - Static site on Render cannot set HTTP-only cookies; JWT is stored in localStorage (XSS risk mitigated by HttpOnly-like usage patterns)
  - Requires modern browser with ES6+ support
- **Database**:
  - Supabase free tier has row limits; monitor usage

## 💡 Tips for Smooth Operation
- Keep the Colab notebook tab active to prevent idle disconnects
- Consider upgrading to ngrok Pro for reserved domains and higher limits
- For production use, migrate backend to a dedicated GPU instance (RunPod, Lambda Labs, or similar)
- Regularly backup Supabase data
- Use the mock mode (`?mock=1`) for frontend development without backend

---


Last updated: May 2026