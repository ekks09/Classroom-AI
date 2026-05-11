# ORIS - Smart Classroom AI

A comprehensive AI-powered classroom management system built with FastAPI, featuring real-time transcription, intelligent Q&A, adaptive quizzing, and advanced analytics.

## 🚀 Features

### For Students
- **AI Learning Assistant**: Get instant help with course material through natural language Q&A
- **Adaptive Quizzing**: Take personalized quizzes that adapt to your learning style and progress
- **Lecture Access**: Study uploaded materials with AI-powered search and summarization
- **Live Sessions**: Join real-time classroom sessions with live transcription
- **Progress Tracking**: Monitor your learning journey with detailed analytics

### For Teachers
- **Lecture Management**: Upload and organize course materials (PDF, Word, PowerPoint, etc.)
- **Live Sessions**: Create and manage real-time classroom sessions with automatic transcription
- **Student Analytics**: Track class performance, engagement, and individual progress
- **AI Quiz Generation**: Automatically generate quizzes from lecture content
- **Teaching Assistant**: Get AI help with lesson planning and student support

### Core AI Features
- **Smart Q&A**: Context-aware question answering using RAG (Retrieval-Augmented Generation)
- **Live Transcription**: Real-time speech-to-text with speaker identification
- **Adaptive Learning**: Personalized content based on student learning styles
- **Intelligent Summarization**: Automatic content summarization and key point extraction
- **Quiz Generation**: AI-powered multiple-choice question creation

## 🏗️ Architecture

### Backend (FastAPI)
- **Authentication**: JWT-based auth with role-based access control
- **Database**: Supabase (PostgreSQL + pgvector) for data and embeddings
- **AI Engine**: Qwen2.5-3B-Instruct model for natural language processing
- **File Processing**: Support for PDF, DOCX, PPTX, TXT, and Markdown files
- **Real-time**: Socket.IO for live session management
- **Vector Search**: FAISS for efficient document similarity search

### Frontend (Vanilla JavaScript)
- **Responsive Design**: Modern, mobile-friendly interface
- **Real-time Updates**: Live session transcription and chat
- **File Upload**: Drag-and-drop file upload with progress tracking
- **Interactive Quizzes**: Dynamic quiz generation and submission
- **Analytics Dashboard**: Comprehensive performance metrics

## 📁 Project Structure

```
ORIS/
├── main.py                 # FastAPI application
├── vercel.json            # Vercel deployment configuration
├── requirements.txt       # Python dependencies
├── static/                # Frontend files
│   ├── index.html         # Landing/Login page
│   ├── student.html       # Student dashboard
│   ├── teacher.html       # Teacher dashboard
│   ├── oris.css          # Main stylesheet
│   └── js/
│       ├── student.js     # Student dashboard logic
│       └── teacher.js     # Teacher dashboard logic
└── README.md             # This file
```

## 🚀 Deployment

### Vercel (Recommended)
1. **Prerequisites**:
   - Vercel account
   - Supabase project with database and storage
   - Environment variables configured

2. **Environment Variables**:
   ```bash
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_KEY=your_supabase_service_key
   JWT_SECRET=your_jwt_secret
   ```

3. **Deploy**:
   ```bash
   vercel --prod
   ```

### Local Development
1. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Set environment variables**:
   ```bash
   export SUPABASE_URL=your_supabase_url
   export SUPABASE_KEY=your_supabase_key
   export SUPABASE_SERVICE_KEY=your_service_key
   export JWT_SECRET=your_jwt_secret
   ```

3. **Run the application**:
   ```bash
   python main.py
   ```

4. **Access the application**:
   - Frontend: http://localhost:8000/static/
   - API: http://localhost:8000/api/
   - API Docs: http://localhost:8000/docs

## 🗄️ Database Schema

### Core Tables
- **users**: User accounts with roles and profiles
- **lectures**: Uploaded course materials
- **lecture_chunks**: Vectorized content chunks for RAG
- **sessions**: Live classroom sessions
- **live_transcripts**: Real-time transcription data
- **quiz_results**: Student quiz performance

### Supabase Setup
1. Create a new Supabase project
2. Enable pgvector extension
3. Run the SQL migrations in `database/migrations/`
4. Configure authentication and storage buckets

## 🤖 AI Models

### Primary LLM
- **Model**: Qwen/Qwen2.5-3B-Instruct
- **Purpose**: General Q&A, quiz generation, teaching assistance
- **Quantization**: 4-bit for efficient deployment

### Embedding Model
- **Model**: all-MiniLM-L6-v2
- **Purpose**: Text vectorization for semantic search
- **Dimensions**: 384

### Speech Recognition
- **Model**: Faster Whisper (base)
- **Purpose**: Real-time speech-to-text transcription

## 🔧 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user info

### Lectures
- `POST /api/lectures/upload` - Upload lecture material
- `GET /api/lectures` - List lectures

### AI Features
- `POST /api/ask` - General Q&A
- `POST /api/quiz/generate` - Generate quizzes
- `POST /api/quiz/submit` - Submit quiz answers

### Sessions
- `POST /api/sessions` - Create live session
- `GET /api/sessions` - List sessions
- `DELETE /api/sessions/{id}` - End session

## 🎨 Frontend Components

### Student Dashboard
- **Lecture Viewer**: Interactive study interface
- **AI Chat**: Context-aware Q&A system
- **Quiz Interface**: Adaptive testing system
- **Progress Analytics**: Learning progress visualization

### Teacher Dashboard
- **Lecture Management**: File upload and organization
- **Session Control**: Live session management
- **Analytics**: Student performance metrics
- **AI Assistant**: Teaching support tools

## 🔒 Security

- **JWT Authentication**: Secure token-based authentication
- **Role-based Access**: Different permissions for students and teachers
- **Input Validation**: Comprehensive input sanitization
- **CORS Protection**: Configured cross-origin policies

## 📊 Monitoring

- **Health Checks**: `/api/health` endpoint for system status
- **Logging**: Structured logging with configurable levels
- **Error Handling**: Comprehensive error responses
- **Performance Metrics**: Response time and usage analytics

## 🚧 Current Limitations

### Vercel Deployment
- **Model Size**: Large AI models may not fit Vercel limits
- **Persistent Storage**: Limited file storage capabilities
- **Real-time Features**: WebSocket support may be limited

### Development Status
- **Live Transcription**: Mock implementation (requires audio processing setup)
- **Advanced Analytics**: Basic metrics (can be extended)
- **Mobile App**: Web-only (PWA possible)

## 🔄 Future Enhancements

- **Mobile Applications**: React Native or Flutter apps
- **Advanced Analytics**: Machine learning-based insights
- **Integration APIs**: LMS platform integrations
- **Multi-language Support**: Internationalization
- **Offline Mode**: Progressive Web App features

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

For questions or support, please open an issue on GitHub or contact the development team.

---

**ORIS** - Transforming education through AI-powered intelligence.