import { useMemo, useRef, useState, useEffect } from 'react'
import { GoogleGenerativeAI } from '@google/generative-ai'
import './App.css'

type AnalysisResponse = {
  matchedSkills: string[]
  missingSkills: string[]
  weakAreas: string[]
  strongSkills: string[]
  jdKeywords?: string[]
  resumeKeywords?: string[]
  resumeQuality: number
  skillMatchScore: number
  readinessScore: number
  resourceRecommendations: Array<{ title: string; url: string; reason: string }>
  roadmap: Array<{ step: string; title: string; details: string }>
  summary: string
}

type Question = {
  id: string
  skill: string
  question: string
  choices: string[]
  answerIndex: number
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

function App() {
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [jdFile, setJDFile] = useState<File | null>(null)
  const [jdText, setJDText] = useState('')
  const [loading, setLoading] = useState(false)
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [pretestScore, setPretestScore] = useState<number | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [activeTab, setActiveTab] = useState('hero')
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({})
  const [isGrading, setIsGrading] = useState(false)
  const [gradingQuestion, setGradingQuestion] = useState<string | null>(null)
  const [questionCorrectness, setQuestionCorrectness] = useState<Record<string, boolean>>({})
  const [companionMessage, setCompanionMessage] = useState('')
  const [showCompanion, setShowCompanion] = useState(false)
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('hard')

  const resumeInputRef = useRef<HTMLInputElement | null>(null)
  const jdInputRef = useRef<HTMLInputElement | null>(null)



  useEffect(() => {
    document.body.setAttribute('data-theme', theme)
  }, [theme])

  const sections = [
    { id: 'hero', label: 'Overview' },
    { id: 'upload', label: 'Upload' },
    { id: 'analysis', label: 'Analysis' },
    { id: 'practice', label: 'Practice' },
    { id: 'resources', label: 'Resources' },
    { id: 'roadmap', label: 'Roadmap' },
  ]

  function handleTabChange(id: string) {
    setActiveTab(id)
  }

  const heroStats = useMemo(() => {
    if (!analysis) {
      return [
        { label: 'Readiness', value: '—' },
        { label: 'Matched skills', value: '—' },
        { label: 'Missing skills', value: '—' },
      ]
    }

    return [
      { label: 'Readiness', value: `${analysis.readinessScore}%` },
      { label: 'Matched skills', value: String(analysis.matchedSkills.length) },
      { label: 'Missing skills', value: String(analysis.missingSkills.length) },
    ]
  }, [analysis])

  async function analyze() {
    if (!resumeFile || (!jdFile && !jdText.trim())) {
      setErrorMsg('Upload a resume PDF and paste or upload a job description first.')
      return
    }

    setLoading(true)
    setErrorMsg(null)
    setAnalysis(null)
    setQuestions([])
    setPretestScore(null)

    try {
      const formData = new FormData()
      formData.append('resumeFile', resumeFile)
      if (jdFile) formData.append('jdFile', jdFile)
      formData.append('jdText', jdText)

      const res = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Status ${res.status}: ${text}`)
      }

      const payload = (await res.json()) as AnalysisResponse
      setAnalysis(payload)
      setQuestions([])
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  function generateQuestions(skills: string[], diff: 'easy' | 'medium' | 'hard' = 'hard') {
    const picks = skills.length ? skills.slice(0, 5) : ['problem solving', 'communication', 'testing', 'apis', 'sql']
    return picks.map((skill, index) => {
      const question = diff === 'hard'
        ? `Discuss a core theoretical challenge in ${skill} and choose the best explanation.`
        : diff === 'medium'
        ? `Which approach best addresses a common real-world concern in ${skill}?`
        : `Which statement best describes ${skill}?`

      return {
        id: `q${index + 1}`,
        skill,
        question,
        choices: [
          `A best/most correct option about ${skill}`,
          `A plausible but suboptimal option about ${skill}`,
          `A wrong or outdated option about ${skill}`,
          'None of the above',
        ],
        answerIndex: 0,
      }
    })
  }

  async function genPretest() {
    const skills = analysis?.missingSkills || []
    const jdSkills = analysis?.jdKeywords?.slice(0, 8) || []

    try {
      const res = await fetch(`${API_BASE}/generate-pretest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills, jdSkills, difficulty }),
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Status ${res.status}: ${text}`)
      }

      const payload = await res.json()
      if (payload.questions?.length) {
        setQuestions(payload.questions)
      } else {
        setErrorMsg('AI could not generate concept-based questions this time. Please try again.')
      }
    } catch (err) {
      console.error(err)
      setErrorMsg('Failed to generate AI pretest from JD skills')
    }
  }

  function submitAnswer(questionId: string, choiceIndex: number) {
    setAnswers((current) => ({ ...current, [questionId]: choiceIndex }))
    // Trigger real-time grading
    gradeQuestionRealTime(questionId, choiceIndex)
  }

  async function gradeQuestionRealTime(questionId: string, userAnswerIndex: number) {
    const question = questions.find((q) => q.id === questionId)
    if (!question) return

    setGradingQuestion(questionId)
    setShowCompanion(true)

    try {
      const res = await fetch(`${API_BASE}/grade-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          userAnswerIndex,
        }),
      })

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`)
      }

      const data = await res.json()
      const sanitized = (data.feedback || '').replace(/\s+/g, ' ').trim()
      setFeedbacks((current) => ({ ...current, [questionId]: sanitized }))
      setQuestionCorrectness((current) => ({ ...current, [questionId]: data.isCorrect }))
      setCompanionMessage(sanitized)
      setShowCompanion(true)
      setTimeout(() => setShowCompanion(false), 6000)
    } catch (err) {
      console.error('Failed to grade question', err)
      setCompanionMessage('Oops! Let me think about that...')
    } finally {
      setGradingQuestion(null)
    }
  }

  async function gradePretest() {
    if (!questions.length) return
    setIsGrading(true)
    const correct = questions.filter((question) => answers[question.id] === question.answerIndex).length
    const score = Math.round((correct / questions.length) * 100)
    setPretestScore(score)

    try {
      const res = await fetch(`${API_BASE}/grade-pretest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions,
          answers,
        }),
      })

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`)
      }

      const data = await res.json()
      const raw = data.feedbacks || {}
      const cleaned: Record<string, string> = {}
      for (const k of Object.keys(raw)) {
        cleaned[k] = String(raw[k] || '').replace(/\s+/g, ' ').trim()
      }
      setFeedbacks(cleaned)
    } catch (err) {
      console.error('Failed to generate companion feedback', err)
      setErrorMsg('Could not fetch companion feedback. Score calculated though.')
    } finally {
      setIsGrading(false)
    }
  }

  async function submitResults() {
    try {
      const payload = {
        name: 'Demo User',
        email: null,
        jdTitle: 'Role Under Review',
        readinessScore: analysis?.readinessScore || 0,
        pretestScore: pretestScore ?? 0,
        details: {
          analysis,
          pretestScore,
          answers,
        },
      }

      const res = await fetch(`${API_BASE}/submit-results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const payloadResponse = await res.json()
      if (payloadResponse.saved) alert('Results saved')
      else setErrorMsg('Save failed')
    } catch (err) {
      console.error(err)
      setErrorMsg('Save failed: ' + (err as any).message)
    }
  }

  const readinessTone = analysis ? (analysis.readinessScore >= 75 ? 'ready' : analysis.readinessScore >= 50 ? 'close' : 'needs-work') : 'idle'

  return (
    <div className="app-shell">
      <header className="page-nav">
        <div>
          <div className="eyebrow compact">AIR · Sections</div>
          <div className="page-nav-note">Jump between the product pages below.</div>
        </div>
        <div className="page-nav-links">
          <button 
            className="page-link theme-toggle" 
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            title="Toggle Theme"
          >
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
          <div style={{width: '1px', background: 'var(--border)', margin: '0 4px'}}></div>
          {sections.map((section) => (
            <button key={section.id} className={`page-link ${activeTab === section.id ? 'active' : ''}`} onClick={() => handleTabChange(section.id)}>
              {section.label}
            </button>
          ))}
        </div>
      </header>

      {activeTab === 'hero' && (
      <section id="hero" className="hero-shell">
        <div className="hero-copy">
          <div className="eyebrow">AIR · Resume · JD · Pre-test</div>
          <h1>
            Check how ready you are for a role before you apply.
          </h1>
          <p>
            Upload your resume PDF and paste or upload a job description to compare skills, reveal gaps,
            score readiness, generate a quick pre-test, and get a simple prep roadmap.
          </p>

          <div className="hero-actions">
            <button className="btn primary" onClick={() => handleTabChange('upload')}>
              Go to Upload
            </button>
          </div>

          <div className="hero-stats">
            {heroStats.map((stat) => (
              <div key={stat.label} className="stat-card">
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className={`hero-panel tone-${readinessTone}`}>
          <div className="panel-header">
            <span>Job readiness snapshot</span>
            <span>local API ready</span>
          </div>
          <div className="ring-wrap">
            <div className="ring-value">{analysis?.readinessScore ?? 0}%</div>
            <div className="ring-caption">Readiness score</div>
          </div>
          <div className="mini-grid">
            <div>
              <span>Matched skills</span>
              <strong>{analysis?.strongSkills.length ?? 0}</strong>
            </div>
            <div>
              <span>Missing skills</span>
              <strong>{analysis?.weakAreas.length ?? 0}</strong>
            </div>
            <div>
              <span>Pre-test score</span>
              <strong>{pretestScore ?? '—'}</strong>
            </div>
          </div>
        </div>
      </section>
      )}

      {activeTab === 'upload' && (
      <section id="upload" className="workspace-grid section-block">
        <article className="card large">
          <div className="card-title">Resume upload</div>
          <p className="card-subtitle">Upload your resume as PDF. The backend extracts the text for analysis.</p>
          <input
            ref={resumeInputRef}
            type="file"
            accept="application/pdf"
            className="hidden-input"
            onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
          />
          <button className="btn upload-btn" onClick={() => resumeInputRef.current?.click()}>
            {resumeFile ? 'Replace resume PDF' : 'Choose resume PDF'}
          </button>
          <div className="file-meta">{resumeFile ? resumeFile.name : 'No resume selected yet'}</div>
        </article>

        <article className="card large">
          <div className="card-title">Job description</div>
          <p className="card-subtitle">Paste the JD or upload a PDF/TXT version.</p>
          <div className="stack">
            <textarea
              className="textarea dark"
              placeholder="Paste the job description here..."
              value={jdText}
              onChange={(e) => setJDText(e.target.value)}
            />
            <button className="btn upload-btn" onClick={() => jdInputRef.current?.click()}>
              {jdFile ? 'Replace JD file' : 'Upload JD file'}
            </button>
            <input
              ref={jdInputRef}
              type="file"
              accept="application/pdf,text/plain"
              className="hidden-input"
              onChange={(e) => setJDFile(e.target.files?.[0] || null)}
            />
          </div>
          <div className="file-meta">{jdFile ? jdFile.name : 'Paste JD or upload a file'}</div>

          <div className="action-row" style={{ marginTop: '24px' }}>
            <button className="btn primary" onClick={analyze} disabled={loading}>
              {loading ? 'Analyzing...' : 'Run analysis'}
            </button>
            {analysis && (
               <button className="btn" onClick={() => handleTabChange('analysis')}>
                 View Results
               </button>
            )}
          </div>
        </article>
      </section>
      )}

      {activeTab === 'practice' && (
      <section id="practice" className="dashboard-grid section-block">
        <div className="action-row" style={{ gridColumn: 'span 12' }}>
          <button className="btn" onClick={genPretest} disabled={!analysis}>
            Build pre-test
          </button>
          <label style={{display: 'flex', alignItems: 'center', gap: 8}}>
            <span style={{color: 'var(--muted)'}}>Difficulty</span>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as any)} style={{padding: '6px 8px', borderRadius: 8}}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <button className="btn primary" onClick={gradePretest} disabled={!questions.length || gradingQuestion !== null}>
            {gradingQuestion ? 'Grading...' : 'Grade all'}
          </button>
          <button className="btn" onClick={submitResults} disabled={!analysis}>
            Save results
          </button>
        </div>

        {questions.length > 0 && (
          <article className="dashboard-card wide" style={{ gridColumn: 'span 12', position: 'relative' }}>
            <div className="card-title">Pre-test practice</div>
            <div className="pretest-grid">
              {questions.map((question) => (
                <div key={question.id} className={`question-card ${answers[question.id] !== undefined ? (questionCorrectness[question.id] ? 'correct' : 'incorrect') : ''}`}>
                  <div className="question-title">{question.question}</div>
                  <div className="question-skill">Skill: {question.skill}</div>
                  <div className="choices">
                    {question.choices.map((choice: string, choiceIndex: number) => (
                      <button
                        key={choiceIndex}
                        className={`choice ${answers[question.id] === choiceIndex ? 'selected' : ''}`}
                        onClick={() => submitAnswer(question.id, choiceIndex)}
                        disabled={gradingQuestion === question.id}
                      >
                        {choice}
                      </button>
                    ))}
                  </div>
                  {gradingQuestion === question.id && (
                    <div className="companion-feedback" style={{ opacity: 0.6 }}>
                      <img src="https://img.fruugo.com/product/2/52/2268278522_0340_0340.jpg" alt="Study Buddy" className="robo-avatar" />
                      <div><em>Thinking...</em></div>
                    </div>
                  )}
                  {feedbacks[question.id] && gradingQuestion !== question.id && (
                    <div className={`companion-feedback ${questionCorrectness[question.id] ? 'correct-feedback' : 'incorrect-feedback'}`}>
                      <img src="https://img.fruugo.com/product/2/52/2268278522_0340_0340.jpg" alt="Study Buddy" className="robo-avatar" />
                      <div>
                        <strong>{questionCorrectness[question.id] ? '✨ Awesome!' : '🎯 Got it!'}</strong>
                        <p>{feedbacks[question.id]}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div className="score-strip">
                Score: {pretestScore ?? 'Not graded yet'} · Answered: {Object.keys(answers).length}/{questions.length}
              </div>
            </div>
          </article>
        )}

        {showCompanion && (
          <div className="companion-corner">
              <div className="companion-bubble">
                <img src="https://img.fruugo.com/product/2/52/2268278522_0340_0340.jpg" alt="Study Buddy" className="companion-avatar robo-avatar" />
                <div className="companion-content">
                  <div className="companion-name">Study Buddy</div>
                  <p>{companionMessage || 'Nice try! Keep going!'}</p>
                </div>
              </div>
          </div>
        )}
      </section>
      )}

      {errorMsg && <div className="error-banner">{errorMsg}</div>}

      {analysis && (
        <>
          {activeTab === 'analysis' && (
            <section id="analysis" className="dashboard-grid section-block">
              <article className="dashboard-card score-card">
                <div className="card-title">Readiness score</div>
                <div className="big-score">{analysis.readinessScore}</div>
                <div className="score-caption">Skill match: {analysis.skillMatchScore}% · Resume quality: {analysis.resumeQuality}%</div>
                <div className="summary-box">{analysis.summary}</div>
              </article>

              <article className="dashboard-card">
                <div className="card-title">Strong skills</div>
                <div className="chip-list">
                  {analysis.strongSkills.length ? analysis.strongSkills.map((skill) => <span key={skill} className="chip">{skill}</span>) : <span className="muted">No strong skills detected yet.</span>}
                </div>
              </article>

              <article className="dashboard-card">
                <div className="card-title">Missing skills</div>
                <div className="list-box">
                  {analysis.missingSkills.length ? analysis.missingSkills.map((skill) => <div key={skill} className="list-item">{skill}</div>) : <div className="muted">No major gaps detected.</div>}
                </div>
              </article>

              <article className="dashboard-card">
                <div className="card-title">Weak areas</div>
                <div className="list-box">
                  {analysis.weakAreas.length ? analysis.weakAreas.map((skill) => <div key={skill} className="list-item">{skill}</div>) : <div className="muted">Resume looks balanced.</div>}
                </div>
              </article>

              
            </section>
          )}

          {activeTab === 'resources' && (
            <section id="resources" className="dashboard-grid section-block">
              <article className="dashboard-card wide">
                <div className="card-title">Recommended resources</div>
                <div className="section-hint">Exact links are curated first; search links are used only when no curated match exists.</div>
                <div className="resource-grid">
                  {(analysis.resourceRecommendations || []).map((resource) => (
                    <a key={resource.title} className="resource-card" href={resource.url} target="_blank" rel="noreferrer">
                      <strong>{resource.title}</strong>
                      <span>{resource.reason}</span>
                    </a>
                  ))}
                </div>
              </article>
            </section>
          )}

          {activeTab === 'roadmap' && (
            <section id="roadmap" className="dashboard-grid section-block">
              <article className="dashboard-card wide">
                <div className="card-title">AI learning roadmap</div>
                <div className="section-hint">A step-by-step prep plan generated from your gaps and the role focus.</div>
                <div className="roadmap-list">
                  {(analysis.roadmap || []).map((step) => (
                    <div key={step.step} className="roadmap-item">
                      <div className="roadmap-step">{step.step}</div>
                      <div>
                        <strong>{step.title}</strong>
                        <p>{step.details}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          )}
        </>
      )}
    </div>
  )
}

export default App
