"""
ORIS - Smart Classroom AI Backend
FastAPI application for Vercel deployment
"""

import os
import json
import uuid
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, Header, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import jwt
from jwt import ExpiredSignatureError, InvalidTokenError
import bcrypt
from supabase import create_client, Client
import aiofiles
from pathlib import Path

# Configuration
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
JWT_SECRET = os.environ.get("JWT_SECRET", secrets.token_hex(32))

VALID_ROLES = frozenset({"teacher", "student", "admin"})
TOKEN_EXPIRY = timedelta(hours=24)

# Initialize Supabase
supabase: Optional[Client] = None

def get_supabase() -> Client:
    global supabase
    if not supabase:
        if not all([SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_KEY]):
            raise RuntimeError("Supabase credentials not configured")
        supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return supabase

# Pydantic Models
class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str = Field(..., min_length=5)
    password: str = Field(..., min_length=8)
    role: str = Field("student")
    learning_style: str = Field("visual")

class LoginRequest(BaseModel):
    username: str
    password: str

class ChatRequest(BaseModel):
    message: str
    mode: str = "general"
    session_id: Optional[str] = None
    lecture_id: Optional[str] = None
    max_tokens: int = Field(512, ge=64, le=2048)
    temperature: float = Field(0.7, ge=0.0, le=1.0)

class QuizRequest(BaseModel):
    lecture_id: str
    num_questions: int = Field(5, ge=1, le=20)
    difficulty: str = "medium"

class QuizSubmitRequest(BaseModel):
    lecture_id: Optional[str] = None
    questions: list
    answers: list
    difficulty: str = "medium"

class SessionCreateRequest(BaseModel):
    title: str = "Live Lecture"
    course_id: Optional[str] = None

# Auth Manager
class AuthManager:
    def __init__(self, db_client: Client):
        self.db = db_client
        self.secret = JWT_SECRET

    @staticmethod
    def hash_password(pw: str) -> str:
        return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(12)).decode()

    @staticmethod
    def verify_password(pw: str, hashed: str) -> bool:
        try:
            return bcrypt.checkpw(pw.encode(), hashed.encode())
        except Exception:
            return False

    def register_user(self, username: str, email: str, password: str, role: str, learning_style: str = "visual") -> tuple[Optional[str], Optional[str]]:
        if role not in VALID_ROLES:
            return None, f"Invalid role '{role}'."
        if len(password) < 8:
            return None, "Password must be ≥ 8 characters."
        if self.db.table("users").select("id").eq("username", username).execute().data:
            return None, f"Username '{username}' already taken."

        uid = str(uuid.uuid4())
        try:
            data = {
                "id": user_id,
                "username": username,
                "email": email,
                "password_hash": self.hash_password(password),
                "role": role,
                "profile": {"learning_style": learning_style, "level": "beginner", "preferences": {}},
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            self.db.table("users").insert(data).execute()
            return uid, None
        except Exception as e:
            return None, f"Database error: {str(e)}"

    def authenticate(self, username: str, password: str) -> tuple[Optional[Dict], Optional[str]]:
        try:
            user = self.db.table("users").select("*").eq("username", username).execute().data
            if not user:
                return None, "Invalid username or password."

            user = user[0]
            dummy_hash = "$2b$12$invalidhashfortimingneutralityonly....................."
            candidate = user["password_hash"] if user else dummy_hash

            if not self.verify_password(password, candidate) or not user:
                return None, "Invalid username or password."

            # Update last login
            self.db.table("users").update({
                "last_login": datetime.now(timezone.utc).isoformat()
            }).eq("id", user["id"]).execute()

            return {
                "id": user["id"],
                "username": user["username"],
                "email": user["email"],
                "role": user["role"],
                "profile": user.get("profile", {}),
            }, None
        except Exception as e:
            return None, f"Authentication error: {str(e)}"

    def generate_token(self, user_data: Dict) -> str:
        now = datetime.now(timezone.utc)
        return jwt.encode(
            {
                "user_id": user_data["id"],
                "username": user_data["username"],
                "role": user_data["role"],
                "iat": now,
                "exp": now + TOKEN_EXPIRY,
            },
            self.secret,
            algorithm="HS256",
        )

    def verify_token(self, token: str) -> tuple[Optional[Dict], Optional[str]]:
        try:
            payload = jwt.decode(token, self.secret, algorithms=["HS256"])
            return payload, None
        except ExpiredSignatureError:
            return None, "Token expired."
        except InvalidTokenError:
            return None, "Invalid token."
        except Exception as e:
            return None, f"Token verification failed: {str(e)}"

# Auth dependency
async def get_current_user(authorization: Optional[str] = Header(None)) -> Dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or malformed Authorization header.")

    token = authorization.split(" ", 1)[1]
    auth_manager = AuthManager(get_supabase())
    payload, error = auth_manager.verify_token(token)
    if error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=error)
    return payload

def require_role(*roles: str):
    async def _dep(user: Dict = Depends(get_current_user)) -> Dict:
        if user.get("role") not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Role '{user.get('role')}' is not permitted. Required: {list(roles)}")
        return user
    return _dep

# FastAPI App
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    try:
        get_supabase()
        print("✅ Supabase connected")
    except Exception as e:
        print(f"⚠️ Supabase connection failed: {e}")

    yield
    # Shutdown

app = FastAPI(
    title="ORIS - Smart Classroom AI",
    version="1.0.0",
    description="AI-powered classroom assistant with RAG, live STT, and adaptive quizzing.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Health check
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "services": {
            "supabase": "connected" if supabase else "disconnected"
        }
    }

# Auth endpoints
@app.post("/api/auth/register", status_code=201)
async def register(body: RegisterRequest):
    auth_manager = AuthManager(get_supabase())
    uid, err = auth_manager.register_user(
        body.username, body.email, body.password, body.role, body.learning_style
    )
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"user_id": uid, "username": body.username, "role": body.role}

@app.post("/api/auth/login")
async def login(body: LoginRequest):
    auth_manager = AuthManager(get_supabase())
    user, err = auth_manager.authenticate(body.username, body.password)
    if err:
        raise HTTPException(status_code=401, detail=err)
    token = auth_manager.generate_token(user)
    return {"access_token": token, "token_type": "bearer", "user": user}

@app.get("/api/auth/me")
async def me(user: Dict = Depends(get_current_user)):
    return user

# Lecture endpoints
@app.post("/api/lectures/upload", status_code=201)
async def upload_lecture(
    file: UploadFile = File(...),
    title: Optional[str] = Query(None),
    course_id: Optional[str] = Query(None),
    user: Dict = Depends(require_role("teacher", "admin")),
):
    # For Vercel, we'll store files in Supabase storage or similar
    # For now, just create a mock lecture entry
    lecture_id = str(uuid.uuid4())

    try:
        # In a real implementation, you'd upload to Supabase storage
        # and process the file content
        data = {
            "id": lecture_id,
            "title": title or file.filename,
            "course_id": course_id,
            "uploaded_by": user["user_id"],
            "file_type": Path(file.filename).suffix.lower().lstrip('.'),
            "file_path": f"mock_path/{lecture_id}",
            "metadata": {"filename": file.filename, "size": 0},
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        get_supabase().table("lectures").insert(data).execute()
        return {"lecture_id": lecture_id, "title": title or file.filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.get("/api/lectures")
async def list_lectures(
    course_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    user: Dict = Depends(get_current_user),
):
    try:
        query = get_supabase().table("lectures").select(
            "id, title, course_id, uploaded_by, file_type, metadata, created_at"
        ).order("created_at", desc=True).limit(limit)

        if course_id:
            query = query.eq("course_id", course_id)

        result = query.execute()
        return result.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch lectures: {str(e)}")

# Chat/Q&A endpoint (simplified for Vercel)
@app.post("/api/ask")
async def ask(body: ChatRequest, user: Dict = Depends(get_current_user)):
    # Simplified response - in real implementation, this would use the LLM
    uid = user["user_id"]

    if body.lecture_id:
        # Mock RAG response
        return {
            "answer": f"This is a mock response for lecture {body.lecture_id}. In the full implementation, this would use RAG to provide context-aware answers.",
            "sources": [{"content": "Mock source content", "similarity": 0.85}],
            "confidence": 0.85
        }
    else:
        # Mock general chat response
        responses = [
            "I'm here to help you learn! What would you like to know?",
            "That's an interesting question. Let me think about that.",
            "Great question! Here's what I understand about that topic...",
            "I can help explain that concept. Would you like me to break it down step by step?"
        ]
        import random
        return {"answer": random.choice(responses)}

# Quiz endpoints (simplified)
@app.post("/api/quiz/generate")
async def generate_quiz(body: QuizRequest, user: Dict = Depends(get_current_user)):
    # Mock quiz generation
    mock_questions = [
        {
            "question": "What is the capital of France?",
            "options": ["London", "Berlin", "Paris", "Madrid"],
            "correct": 2,
            "explanation": "Paris is the capital and largest city of France."
        },
        {
            "question": "What is 2 + 2?",
            "options": ["3", "4", "5", "6"],
            "correct": 1,
            "explanation": "2 + 2 equals 4."
        }
    ]

    return {
        "questions": mock_questions[:body.num_questions],
        "lecture_id": body.lecture_id,
        "difficulty": body.difficulty
    }

@app.post("/api/quiz/submit")
async def submit_quiz(body: QuizSubmitRequest, user: Dict = Depends(get_current_user)):
    if len(body.questions) != len(body.answers):
        raise HTTPException(status_code=400, detail="Questions/answers length mismatch.")

    correct = sum(1 for q, a in zip(body.questions, body.answers) if isinstance(q, dict) and q.get("correct") == a)
    score = (correct / len(body.questions)) * 100 if body.questions else 0.0

    # In real implementation, save to database
    return {"score": round(score, 1), "correct": correct, "total": len(body.questions)}

# Session endpoints (simplified)
@app.post("/api/sessions", status_code=201)
async def create_session(body: SessionCreateRequest, user: Dict = Depends(require_role("teacher", "admin"))):
    session_id = str(uuid.uuid4())

    try:
        data = {
            "session_id": session_id,
            "title": body.title,
            "teacher_id": user["user_id"],
            "course_id": body.course_id,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "status": "active",
        }
        get_supabase().table("sessions").insert(data).execute()
        return {"session_id": session_id, "title": body.title}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create session: {str(e)}")

@app.get("/api/sessions")
async def list_sessions(user: Dict = Depends(get_current_user)):
    try:
        result = get_supabase().table("sessions").select("*").order("started_at", desc=True).limit(20).execute()
        return result.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch sessions: {str(e)}")

# Root endpoint serves the main page
@app.get("/")
async def root():
    return {"message": "ORIS - Smart Classroom AI", "docs": "/docs", "health": "/api/health"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))