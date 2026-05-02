const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("AIR Backend Running");
});

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

function extractKeywords(text) {
  if (!text) return [];
  const stop = new Set([
    "the","and","for","with","that","this","from","will","are","have","your","you","a","an","to","in","on","of","as","be","is","by","or","we","our","us"
  ]);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  // return most frequent words as candidate skills
  const freq = {};
  tokens.forEach((t) => (freq[t] = (freq[t] || 0) + 1));
  const arr = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);
  return arr.slice(0, 40);
}

app.post("/analyze", async (req, res) => {
  try {
    const { resumeText, jdText } = req.body;
    const jdKeywords = extractKeywords(jdText);
    const resumeKeywords = extractKeywords(resumeText);

    const matched = jdKeywords.filter((k) => resumeKeywords.includes(k));
    const missing = jdKeywords.filter((k) => !resumeKeywords.includes(k));

    // simple resume quality heuristics
    const resumeLength = (resumeText || "").length;
    let resumeQuality = 50;
    if (resumeLength > 2000) resumeQuality = 90;
    else if (resumeLength > 1000) resumeQuality = 75;
    else if (resumeLength > 500) resumeQuality = 60;

    // readiness score combines skill match and resume quality
    const skillMatchScore = jdKeywords.length ? Math.round((matched.length / jdKeywords.length) * 100) : 0;
    const readinessScore = Math.round((skillMatchScore * 0.6) + (resumeQuality * 0.4));

    res.json({
      matchedSkills: matched.slice(0, 50),
      missingSkills: missing.slice(0, 50),
      resumeQuality,
      skillMatchScore,
      readinessScore,
      jdKeywords: jdKeywords.slice(0, 50),
      resumeKeywords: resumeKeywords.slice(0, 50),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "analysis failed" });
  }
});

// generate a simple pre-test (5 MCQs) based on missing skills
app.post("/generate-pretest", async (req, res) => {
  try {
    const { skills } = req.body; // array of skill strings
    const questions = [];
    const picks = (skills && skills.length) ? skills.slice(0, 5) : ["algorithms","data structures","testing","api","sql"];
    for (let i = 0; i < picks.length; i++) {
      const s = picks[i];
      questions.push({
        id: `q${i + 1}`,
        skill: s,
        question: `Which statement best describes ${s}?`,
        choices: [
          `A common definition/example of ${s}`,
          `An unrelated concept similar to ${s}`,
          `A wrong choice about ${s}`,
          `None of the above`
        ],
        answerIndex: 0,
      });
    }
    res.json({ questions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to generate pretest" });
  }
});

app.post("/submit-results", async (req, res) => {
  try {
    const { name, email, jdTitle, readinessScore, pretestScore, details } = req.body;
    const client = await pool.connect();
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
    `);
    const result = await client.query(
      `INSERT INTO test_results(name,email,jd_title,readiness_score,pretest_score,details) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name || null, email || null, jdTitle || null, readinessScore || null, pretestScore || null, details || {}]
    );
    client.release();
    res.json({ saved: true, row: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to save results" });
  }
});

app.get("/results", async (req, res) => {
  try {
    const client = await pool.connect();
    const r = await client.query(`SELECT * FROM test_results ORDER BY created_at DESC LIMIT 50`);
    client.release();
    res.json({ rows: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to fetch results" });
  }
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});