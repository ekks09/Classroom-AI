/* ============================================================
   js/mock.js — Mock API responses for offline/demo mode
   ============================================================ */

'use strict';

const MockAPI = (() => {

  // ── MOCK DATA STORE ───────────────────────────────────────

  const LECTURES = [
    {
      id: 'mock-l1',
      title: 'Introduction to Machine Learning',
      subject: 'Artificial Intelligence · Year 3',
      description: 'Foundations of supervised and unsupervised learning.',
      chunk_count: 42,
      created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
      file_type: 'pdf',
    },
    {
      id: 'mock-l2',
      title: 'Neural Networks & Deep Learning',
      subject: 'Artificial Intelligence · Year 3',
      description: 'Perceptrons, backpropagation, CNNs, RNNs.',
      chunk_count: 67,
      created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
      file_type: 'pdf',
    },
    {
      id: 'mock-l3',
      title: 'Thermodynamics — Laws & Applications',
      subject: 'Physics · Year 2',
      description: 'First and second laws, entropy, heat engines.',
      chunk_count: 31,
      created_at: new Date(Date.now() - 86400000).toISOString(),
      file_type: 'docx',
    },
    {
      id: 'mock-l4',
      title: 'Data Structures & Algorithms',
      subject: 'Computer Science · Year 1',
      description: 'Arrays, trees, graphs, sorting, searching.',
      chunk_count: 55,
      created_at: new Date().toISOString(),
      file_type: 'pdf',
    },
  ];

  const SESSIONS = [
    {
      id: 'mock-s1',
      title: 'Live ML Introduction',
      lecture_id: 'mock-l1',
      status: 'active',
      student_count: 18,
      created_at: new Date().toISOString(),
    },
  ];

  const QUIZ_TEMPLATES = (n) => Array.from({ length: n }, (_, i) => ({
    question: `Question ${i + 1}: Which of the following best describes a neural network?`,
    options: [
      'A) A biological brain cell',
      'B) A computational model inspired by biological neurons',
      'C) A type of database',
      'D) A programming language',
    ],
    correct: 'B) A computational model inspired by biological neurons',
    explanation: 'Neural networks are computational systems loosely modelled on the human brain, consisting of layers of interconnected nodes.',
  }));

  const PROGRESS = {
    total_quizzes: 12,
    avg_score: 74,
    study_streak: 5,
    top_topic: 'Machine Learning',
    quiz_history: [
      { lecture: 'ML Introduction', score: 80, date: '2024-01-15', questions: 5 },
      { lecture: 'Neural Networks', score: 70, date: '2024-01-14', questions: 5 },
      { lecture: 'Data Structures', score: 90, date: '2024-01-13', questions: 10 },
    ],
  };

  // ── CHAT RESPONSES ────────────────────────────────────────

  const CHAT_RESPONSES = [
    'Based on the lecture material, this concept refers to the process of training a model on labelled data to make predictions on unseen inputs.',
    'Great question! Neural networks consist of input, hidden, and output layers. Each connection has a weight that is adjusted during training via backpropagation.',
    'The key difference here is that supervised learning uses labelled examples, while unsupervised learning finds patterns in unlabelled data.',
    'Think of it this way: a decision tree is like a flowchart of yes/no questions that leads to a classification. Each branch represents a decision boundary.',
    'According to the lecture, entropy in thermodynamics measures the degree of disorder in a system. Higher entropy means more disorder.',
  ];

  let _chatIdx = 0;

  function getMockChat() {
    const resp = CHAT_RESPONSES[_chatIdx % CHAT_RESPONSES.length];
    _chatIdx++;
    return resp;
  }

  // Simulate streaming
  async function* streamMockChat(prompt) {
    const full   = getMockChat();
    const words  = full.split(' ');

    for (const word of words) {
      yield word + ' ';
      await sleep(40 + Math.random() * 60);
    }
  }

  // ── PUBLIC MOCK HANDLERS ──────────────────────────────────

  return {
    getLectures:   () => ({ lectures: LECTURES }),
    getSessions:   () => ({ sessions: SESSIONS }),
    getProgress:   () => PROGRESS,
    getQuiz:       (n) => ({ questions: QUIZ_TEMPLATES(n) }),
    getChat:       getMockChat,
    streamChat:    streamMockChat,

    getAnalytics: () => ({
      total_sessions:  8,
      total_lectures:  LECTURES.length,
      active_students: 34,
      total_insights:  56,
      system: {
        llm_loaded:      true,
        db_connected:    true,
        embedding_dim:   384,
        active_sessions: 1,
        total_chunks:    195,
      },
      sessions: [
        { title: 'ML Introduction',  student_count: 18, insight_count: 12, duration: '45:23' },
        { title: 'Neural Networks',  student_count: 22, insight_count: 8,  duration: '52:11' },
        { title: 'Thermodynamics',   student_count: 15, insight_count: 6,  duration: '38:05' },
      ],
    }),

    // Insight simulation
    simulateInsights(onLecChunk, onLecDone, onStuChunk, onStuDone) {
      const lecId = 'mock-li-' + Date.now();
      const stuId = 'mock-si-' + Date.now();

       const lecText = 'Lecturer Insight: Consider pausing here to check comprehension. The concept of backpropagation can be reinforced with a quick diagram on the board. Try asking: "Can someone explain what a gradient is?"';
       const stuText = 'Student Insight: Backpropagation is how a neural network learns from its mistakes. Think of it like correcting a wrong answer on a test — the network adjusts its internal weights to reduce errors next time.';

      async function stream(text, id, chunkFn, doneFn) {
        const words = text.split(' ');
        for (const w of words) {
          await sleep(50 + Math.random() * 80);
          chunkFn(id, w + ' ');
        }
        doneFn(id);
      }

      stream(lecText, lecId, onLecChunk, onLecDone);
      setTimeout(() => {
        stream(stuText, stuId, onStuChunk, onStuDone);
      }, 300);

      return { lecId, stuId };
    },
  };

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

})();

window.MockAPI = MockAPI;