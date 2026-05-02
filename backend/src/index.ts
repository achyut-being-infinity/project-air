import express, { Request, Response } from 'express'
import dotenv from 'dotenv'
import { Pool } from 'pg'

const multer = require('multer')
const cors = require('cors')
const pdfParse = require('pdf-parse')

dotenv.config()

const app = express()
const upload = multer({ storage: multer.memoryStorage() })
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
  : true

app.use(cors({ origin: allowedOrigins }))
app.use(express.json({ limit: '2mb' }))

app.get('/', (_req: Request, res: Response) => {
  res.send('AIR Backend Running')
})

type UploadFile = Express.Multer.File

type AnalysisResult = {
  matchedSkills: string[]
  missingSkills: string[]
  weakAreas: string[]
  strongSkills: string[]
  resumeQuality: number
  skillMatchScore: number
  readinessScore: number
  resourceRecommendations: Array<{ title: string; url: string; reason: string }>
  roadmap: Array<{ step: string; title: string; details: string }>
  summary: string
}

type QuizQuestion = {
  id: string
  skill: string
  question: string
  choices: string[]
  answerIndex: number
}

function extractKeywords(text?: string): string[] {
  if (!text) return []
  const stop = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'will', 'are', 'have', 'your', 'you',
    'a', 'an', 'to', 'in', 'on', 'of', 'as', 'be', 'is', 'by', 'or', 'we', 'our', 'us', 'job',
    'role', 'team', 'work', 'experience', 'skills', 'skill', 'responsibilities', 'required'
  ])

  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stop.has(word))

  const freq: Record<string, number> = {}
  for (const token of tokens) {
    freq[token] = (freq[token] || 0) + 1
  }

  return Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 40)
}

async function parseUploadToText(file?: UploadFile): Promise<string> {
  if (!file) return ''

  const mime = file.mimetype || ''
  if (mime.includes('pdf') || file.originalname.toLowerCase().endsWith('.pdf')) {
    const parsed = await pdfParse(file.buffer)
    return parsed.text || ''
  }

  return file.buffer.toString('utf8')
}

const curatedVideoLinks: Record<string, { title: string; url: string; reason: string }[]> = {
  javascript: [
    {
      title: 'JavaScript Crash Course For Beginners',
      url: 'https://www.youtube.com/watch?v=hdI2bqOjy3c',
      reason: 'Best quick foundation for JavaScript interview prep.',
    },
  ],
  react: [
    {
      title: 'React JS Crash Course',
      url: 'https://www.youtube.com/watch?v=w7ejDZ8SWv8',
      reason: 'Great walkthrough for core React concepts.',
    },
  ],
  sql: [
    {
      title: 'SQL Tutorial - Full Course for Beginners',
      url: 'https://www.youtube.com/watch?v=HXV3zeQKqGY',
      reason: 'Strong SQL foundation for database roles.',
    },
  ],
  git: [
    {
      title: 'Git & GitHub Crash Course',
      url: 'https://www.youtube.com/watch?v=RGOj5yH7evk',
      reason: 'Fast practical overview of Git workflows.',
    },
  ],
  html: [
    {
      title: 'HTML Crash Course For Absolute Beginners',
      url: 'https://www.youtube.com/watch?v=UB1O30fR-EE',
      reason: 'Useful for frontend basics and interviews.',
    },
  ],
  python: [
    {
      title: 'Python Tutorial for Beginners',
      url: 'https://www.youtube.com/watch?v=_uQrJ0TkZlc',
      reason: 'Good starting point for Python fundamentals.',
    },
  ],
  node: [
    {
      title: 'Node.js Crash Course',
      url: 'https://www.youtube.com/watch?v=fBNz5xF-Kx4',
      reason: 'Useful if the role expects backend JavaScript skills.',
    },
  ],
}

function buildResourceRecommendations(skills: string[]) {
  const recommendations: Array<{ title: string; url: string; reason: string }> = []

  for (const skill of skills.slice(0, 4)) {
    const normalized = skill.toLowerCase()
    const matchedKey = Object.keys(curatedVideoLinks).find((key) => normalized.includes(key))
    if (matchedKey) {
      recommendations.push(curatedVideoLinks[matchedKey][0])
    } else {
      recommendations.push({
        title: `${skill} tutorial search`,
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(skill + ' tutorial')}`,
        reason: `Search the most relevant current tutorials for ${skill}.`,
      })
    }
  }

  return recommendations
}

function buildRoadmap(missingSkills: string[]) {
  const base = missingSkills.slice(0, 5)
  return base.length > 0
    ? base.map((skill, index) => ({
        step: `${index + 1}`,
        title: `Close gap: ${skill}`,
        details: `Spend focused time on ${skill}, then test yourself with a small project or quiz.`,
      }))
    : [
        {
          step: '1',
          title: 'Refine your resume',
          details: 'Tailor achievements to the JD and keep impact-focused bullets.',
        },
        {
          step: '2',
          title: 'Practice core interview topics',
          details: 'Review projects, fundamentals, and role-specific concepts.',
        },
        {
          step: '3',
          title: 'Apply with confidence',
          details: 'Use the readiness score and results to target the right roles.',
        },
      ]
}

function buildFallbackAnalysis(resumeText: string, jdText: string): AnalysisResult {
  const jdKeywords = extractKeywords(jdText)
  const resumeKeywords = extractKeywords(resumeText)
  const matchedSkills = jdKeywords.filter((keyword) => resumeKeywords.includes(keyword))
  const missingSkills = jdKeywords.filter((keyword) => !resumeKeywords.includes(keyword))
  const weakAreas = missingSkills.slice(0, 6)

  const resumeLength = resumeText.length
  let resumeQuality = 50
  if (resumeLength > 2500) resumeQuality = 90
  else if (resumeLength > 1400) resumeQuality = 78
  else if (resumeLength > 700) resumeQuality = 64

  const skillMatchScore = jdKeywords.length ? Math.round((matchedSkills.length / jdKeywords.length) * 100) : 0
  const readinessScore = Math.round(skillMatchScore * 0.6 + resumeQuality * 0.4)

  const strongSkills = matchedSkills.slice(0, 8)
  const resources = buildResourceRecommendations(missingSkills.length ? missingSkills : jdKeywords)
  const roadmap = buildRoadmap(missingSkills)

  return {
    matchedSkills,
    missingSkills,
    weakAreas,
    strongSkills,
    resumeQuality,
    skillMatchScore,
    readinessScore,
    resourceRecommendations: resources,
    roadmap,
    summary:
      readinessScore >= 75
        ? 'You look job-ready with only minor polish needed.'
        : readinessScore >= 50
          ? 'You are close, but there are a few skill gaps to close first.'
          : 'This role needs prep work. Focus on the missing skills and revise the resume.',
  }
}

async function callGeminiAnalysis(resumeText: string, jdText: string): Promise<AnalysisResult | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  const prompt = `You are AIR, an assistant that compares a resume against a job description.
Return only valid JSON with these keys:
matchedSkills, missingSkills, weakAreas, strongSkills, resumeQuality, skillMatchScore, readinessScore, resourceRecommendations, roadmap, summary.

Rules:
- matchedSkills, missingSkills, weakAreas, strongSkills are string arrays.
- resourceRecommendations is an array of objects with title, url, reason.
- roadmap is an array of objects with step, title, details.
- readinessScore and skillMatchScore are integers 0-100.
- summary should be one sentence.

Resume:
${resumeText}

Job Description:
${jdText}`

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    }
  )

  if (!response.ok) return null

  const data = await response.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || '').join('') || ''
  if (!text) return null

  try {
    const parsed = JSON.parse(text)
    return {
      matchedSkills: Array.isArray(parsed.matchedSkills) ? parsed.matchedSkills : [],
      missingSkills: Array.isArray(parsed.missingSkills) ? parsed.missingSkills : [],
      weakAreas: Array.isArray(parsed.weakAreas) ? parsed.weakAreas : [],
      strongSkills: Array.isArray(parsed.strongSkills) ? parsed.strongSkills : [],
      resumeQuality: Number(parsed.resumeQuality) || 50,
      skillMatchScore: Number(parsed.skillMatchScore) || 0,
      readinessScore: Number(parsed.readinessScore) || 0,
      resourceRecommendations: Array.isArray(parsed.resourceRecommendations) ? parsed.resourceRecommendations : [],
      roadmap: Array.isArray(parsed.roadmap) ? parsed.roadmap : [],
      summary: typeof parsed.summary === 'string' ? parsed.summary : 'Analysis complete.',
    }
  } catch {
    return null
  }
}

async function callGeminiQuiz(skills: string[], difficulty: 'easy' | 'medium' | 'hard' = 'hard'): Promise<QuizQuestion[] | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey || skills.length === 0) return null

  // Map difficulty to instruction tone
  const difficultyInstruction = difficulty === 'hard'
    ? 'Produce rigorous, theory-heavy, and deep technical questions that evaluate conceptual understanding, trade-offs, and edge cases.'
    : difficulty === 'medium'
    ? 'Produce intermediate-level questions that test applied understanding and common design considerations.'
    : 'Produce basic definition and applied questions suitable for beginners.'

  const prompt = `You are an expert technical interviewer. For each of the requested skills/topics, create one focused, concept-level multiple-choice question that checks understanding of a specific concept, API behavior, configuration detail, or common pitfall.
Skills/topics: ${skills.slice(0, 5).join(', ')}.

${difficultyInstruction}

Important: produce concrete question stems and realistic answer options (no placeholders like "A best option about X"). Each choice must be a full sentence or clear technical statement.

Return only valid JSON with this shape:
{
  "questions": [
    {
      "id": "q1",
      "skill": "topic",
      "question": "question text that targets a specific concept or behavior",
      "choices": [
        "Concrete option A with technical detail",
        "Concrete option B with technical detail",
        "Concrete option C with technical detail",
        "Concrete option D with technical detail"
      ],
      "answerIndex": 0,
      "explanation": "(optional) one-sentence rationale for the correct answer"
    }
  ]
}

Example (do not include this example in the output; follow the JSON structure exactly):
{
  "questions": [
    {
      "id": "q1",
      "skill": "Spring Cloud Config",
      "question": "When using Spring Cloud Config with a Git backend, which approach ensures secure access to private repositories for runtime config retrieval?",
      "choices": [
        "Provide repository credentials in plain text in application.yml",
        "Use an SSH deploy key configured on the Git host and referenced by the Config Server",
        "Embed personal access tokens in the client application",
        "Disable authentication and rely on network ACLs"
      ],
      "answerIndex": 1,
      "explanation": "Using an SSH deploy key keeps credentials manageable and avoids embedding tokens in client apps."
    }
  ]
}

Rules:
- Create exactly 5 distinct questions, one per topic when possible.
- Each question must be specific and concrete (1-3 sentences) and include domain-specific details.
- Each of the 4 choices must be plausible; at least one distractor should reflect a common misconception.
- Provide answerIndex as 0-based integer and optionally explanation.
- Output must be pure JSON only (no surrounding markdown or commentary).`

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: difficulty === 'hard' ? 0.3 : 0.2,
          responseMimeType: 'application/json',
          maxOutputTokens: 900,
        },
      }),
    }
  )

  if (!response.ok) return null

  const data = await response.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || '').join('') || ''
  if (!text) return null

  // Gemini can still return fenced JSON or surrounding text even with JSON mime type.
  const normalized = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = normalized.indexOf('{')
  const end = normalized.lastIndexOf('}')
  const jsonText = start !== -1 && end !== -1 && end > start ? normalized.slice(start, end + 1) : normalized

  try {
    const parsed = JSON.parse(jsonText)
    if (!Array.isArray(parsed.questions)) return null

    const mapped = parsed.questions.slice(0, 5).map((question: any, index: number) => ({
      id: typeof question.id === 'string' ? question.id : `q${index + 1}`,
      skill: typeof question.skill === 'string' ? question.skill : skills[index] || 'general',
      question: typeof question.question === 'string' ? question.question : 'Question unavailable.',
      choices: Array.isArray(question.choices) ? question.choices.slice(0, 4) : [],
      answerIndex: Number.isFinite(Number(question.answerIndex)) ? Number(question.answerIndex) : 0,
    }))

    // Reject placeholder-style outputs so we don't render generic template questions.
    const hasPlaceholderContent = mapped.some((q: QuizQuestion) => {
      const questionLooksGeneric = /best option|plausible but|wrong choice|none of the above/i.test(q.question)
      const choicesLookGeneric = q.choices.some((c: string) => /best option|plausible but|wrong choice|about\s+[a-z0-9\s()/-]+$/i.test(c))
      return questionLooksGeneric || choicesLookGeneric || q.choices.length !== 4
    })

    if (hasPlaceholderContent) return null

    return mapped
  } catch (e) {
    console.error('Failed to parse quiz JSON from Gemini:', e)
    return null
  }
}

async function getAnalysis(resumeText: string, jdText: string): Promise<AnalysisResult> {
  const gemini = await callGeminiAnalysis(resumeText, jdText)
  return gemini || buildFallbackAnalysis(resumeText, jdText)
}

app.post(
  '/analyze',
  upload.fields([
    { name: 'resumeFile', maxCount: 1 },
    { name: 'jdFile', maxCount: 1 },
  ]),
  async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, string>
      const files = req.files as Record<string, UploadFile[]> | undefined

      const resumeFile = files?.resumeFile?.[0]
      const jdFile = files?.jdFile?.[0]

      const resumeText = (body.resumeText || '').trim() || (await parseUploadToText(resumeFile))
      const jdText = (body.jdText || '').trim() || (await parseUploadToText(jdFile))

      if (!resumeText) {
        return res.status(400).json({ error: 'Resume text or resume PDF is required.' })
      }

      if (!jdText) {
        return res.status(400).json({ error: 'Job description text or file is required.' })
      }

      const analysis = await getAnalysis(resumeText, jdText)
      res.json({
        ...analysis,
        jdKeywords: extractKeywords(jdText),
        resumeKeywords: extractKeywords(resumeText),
      })
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: 'analysis failed' })
    }
  }
)

app.post('/generate-pretest', async (req: Request, res: Response) => {
  try {
    const { skills, jdSkills, difficulty } = req.body as { skills?: string[]; jdSkills?: string[]; difficulty?: string }
    const primarySkills = jdSkills && jdSkills.length ? jdSkills : skills
    const picks = primarySkills && primarySkills.length ? primarySkills.slice(0, 5) : ['algorithms', 'data structures', 'testing', 'api', 'sql']
    const diff = difficulty === 'medium' ? 'medium' : difficulty === 'easy' ? 'easy' : 'hard'

    const geminiQuestions = await callGeminiQuiz(picks, diff as any)
    const questions = geminiQuestions || picks.map((skill, index) => {
      const qText = diff === 'hard'
        ? `Explain a core theoretical challenge in ${skill} and choose the best mitigation.`
        : diff === 'medium'
        ? `Which of the following describes a practical consideration when working with ${skill}?`
        : `Which statement best describes ${skill}?`

      return {
        id: `q${index + 1}`,
        skill,
        question: qText,
        choices: [
          `A correct or best option for ${skill}`,
          `A plausible but incorrect option for ${skill}`,
          `A wrong choice about ${skill}`,
          'None of the above',
        ],
        answerIndex: 0,
      }
    })

    res.json({ questions })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'failed to generate pretest' })
  }
})

app.post('/grade-question', async (req: Request, res: Response) => {
  try {
    const { question, userAnswerIndex } = req.body as any;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'No API key' });
    }

    const isCorrect = userAnswerIndex === question.answerIndex;
    const userAnswer = userAnswerIndex !== -1 ? question.choices[userAnswerIndex] : 'No answer provided';

    const prompt = `You are a cute, encouraging AI robot companion (think of a cheerful, supportive mentor).
Grade this one question and provide enthusiastic real-time feedback.

Question: ${question.question}
Correct answer: ${question.choices[question.answerIndex]}
User's answer: ${userAnswer}
Result: ${isCorrect ? 'CORRECT ✓' : 'INCORRECT ✗'}

Provide feedback in 1-2 sentences that:
- If correct: Celebrate enthusiastically and briefly explain why that's right
- If incorrect: Gently correct them, explain the right answer, and be encouraging
- Include a personality: be warm, supportive, and like a friend coaching them
- Use emojis sparingly if it fits your personality

Respond naturally as if you're right there with them. Make it feel personal and encouraging!`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
          },
        }),
      }
    );

    if (!response.ok) {
       return res.status(500).json({ error: 'Gemini API failed' });
    }

    const data = await response.json();
    const feedback = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Great effort!';
    
    res.json({ 
      feedback,
      isCorrect,
      correctAnswer: question.choices[question.answerIndex]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to grade question via Gemini' });
  }
});

app.post('/grade-pretest', async (req: Request, res: Response) => {
  try {
    const { questions, answers } = req.body as any;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'No API key' });
    }

    const prompt = `You are a motivating, helpful AI companion for a user practicing interview skills. 
Here are the pre-test questions the user answered.
Provide a short (1-2 sentences), encouraging piece of feedback for EACH question.
If they got it right, praise them and explain briefly why it's right.
If they got it wrong, gently correct them and explain why the correct answer is better.
Return a JSON object where keys are the question IDs (e.g. "q1", "q2") and values are your feedback string.
Make sure the response is purely valid JSON without markdown wrapping.

Questions and Answers:
${JSON.stringify(questions.map((q: any) => ({
  id: q.id,
  question: q.question,
  options: q.choices,
  correctOptionIndex: q.answerIndex,
  correctOptionText: q.choices[q.answerIndex],
  userAnswerIndex: answers[q.id] ?? -1,
  userAnswerText: answers[q.id] !== undefined ? q.choices[answers[q.id]] : "No answer provided"
})))}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (!response.ok) {
       return res.status(500).json({ error: 'Gemini API failed' });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || '').join('') || '';
    
    const cleanedText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const feedbacks = JSON.parse(cleanedText);
    
    res.json({ feedbacks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to grade pretest via Gemini' });
  }
});

app.post('/submit-results', async (req: Request, res: Response) => {
  try {
    const { name, email, jdTitle, readinessScore, pretestScore, details } = req.body as any
    const client = await pool.connect()
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_results (
        id SERIAL PRIMARY KEY,
        name TEXT,
        email TEXT,
        jd_title TEXT,
        readiness_score INT,
        pretest_score INT,
        details JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)

    const result = await client.query(
      `INSERT INTO test_results(name, email, jd_title, readiness_score, pretest_score, details)
       VALUES($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name || null, email || null, jdTitle || null, readinessScore || null, pretestScore || null, details || {}]
    )

    client.release()
    res.json({ saved: true, row: result.rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'failed to save results' })
  }
})

app.get('/results', async (_req: Request, res: Response) => {
  try {
    const client = await pool.connect()
    const result = await client.query(`SELECT * FROM test_results ORDER BY created_at DESC LIMIT 50`)
    client.release()
    res.json({ rows: result.rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'failed to fetch results' })
  }
})

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
