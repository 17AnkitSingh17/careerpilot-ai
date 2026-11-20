import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import multer from "multer";
import fs from "fs";
import pdf from "pdf-parse/lib/pdf-parse.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

// Gemini for Embeddings
const AI = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

// Groq for fast, high-limit Chat & Structured JSON
const GROQ_AI = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

const JOBS = JSON.parse(fs.readFileSync("./jobs.json", "utf-8"));
let cachedJobEmbeddings = null;
let currentResumeText = ""; // RAG context store
const gapCache = new Map(); // Cache skill-gap reports

// --- 1. EMBEDDINGS & SEMANTIC SEARCH ---
async function getEmbedding(text) {
  const res = await AI.embeddings.create({
    model: "gemini-embedding-001",
    input: text.slice(0, 8000),
  });
  return res.data[0].embedding;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function semanticJobSearch(query, topK = 5) {
  if (!cachedJobEmbeddings) {
    cachedJobEmbeddings = await Promise.all(
      JOBS.map(async (job) => ({
        ...job,
        embedding: await getEmbedding(`${job.title} ${job.skills.join(" ")} ${job.description}`),
      }))
    );
  }
  const queryVec = await getEmbedding(query);
  return cachedJobEmbeddings
    .map((job) => ({
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      stipend: job.stipend,
      skills: job.skills,
      description: job.description,
      matchScore: Math.round(cosineSimilarity(queryVec, job.embedding) * 100),
    }))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, topK);
}

// --- 2. UPLOAD RESUME + SEMANTIC MATCH ---
app.post("/api/upload-resume", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No PDF uploaded" });
    const dataBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdf(dataBuffer);
    fs.unlinkSync(req.file.path);

    currentResumeText = pdfData.text;
    const matchedJobs = await semanticJobSearch(currentResumeText, 5);
    res.json({ success: true, matchedJobs, resumePreview: currentResumeText.slice(0, 300) });
  } catch (err) {
    console.error("Upload Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- 3. STRUCTURED OUTPUT (SKILL GAP REPORT) ---
app.post("/api/analyze-gap", async (req, res) => {
  try {
    const { jobId } = req.body;
    const job = JOBS.find((j) => j.id === jobId);
    if (!job || !currentResumeText) {
      return res.status(400).json({ success: false, message: "Upload resume & select a valid job first." });
    }

    const cacheKey = `${jobId}_${currentResumeText.length}`;
    if (gapCache.has(cacheKey)) {
      return res.json({ success: true, report: gapCache.get(cacheKey), job });
    }

    const response = await GROQ_AI.chat.completions.create({
      model: "openai/gpt-oss-120b",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a technical recruiter. Return ONLY valid JSON with this exact schema:
          {
            "matchPercentage": number (0-100),
            "matchedSkills": string[],
            "missingSkills": string[],
            "prepPlan": string[] (exactly 3 concise actionable steps)
          }`,
        },
        {
          role: "user",
          content: `Job: ${job.title} at ${job.company}\nRequired Skills: ${job.skills.join(", ")}\nDescription: ${job.description}\n\nCandidate Resume:\n${currentResumeText.slice(0, 4000)}`,
        },
      ],
      temperature: 0.2,
    });

    const report = JSON.parse(response.choices[0].message.content);
    gapCache.set(cacheKey, report);
    res.json({ success: true, report, job });
  } catch (err) {
    console.error("Analyze Gap Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- 4. AI AGENT (TOOL CALLING + RAG + MEMORY) ---
app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    const systemPrompt = {
      role: "system",
      content: "You are CareerPilot AI, an agentic career assistant. Use tools to search jobs or read the user's resume before answering. Be concise and practical.",
    };
    const recentHistory = [systemPrompt, ...messages.slice(-10)];

    const tools = [
      {
        type: "function",
        function: {
          name: "search_jobs",
          description: "Semantically search and rank jobs by skills, role, or location.",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_resume_context",
          description: "Retrieve the user's uploaded resume text to answer questions or find skill gaps.",
          parameters: { type: "object", properties: {} },
        },
      },
    ];

    const firstRes = await GROQ_AI.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages: recentHistory,
      tools,
      tool_choice: "auto",
      temperature: 0.5,
    });

    const msg = firstRes.choices[0].message;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const toolMessages = [...recentHistory, msg];
      const toolsUsed = [];

      for (const tc of msg.tool_calls) {
        toolsUsed.push(tc.function.name);
        const args = JSON.parse(tc.function.arguments || "{}");
        let output = "";

        if (tc.function.name === "search_jobs") {
          output = JSON.stringify(await semanticJobSearch(args.query, 3));
        } else if (tc.function.name === "get_resume_context") {
          output = currentResumeText ? currentResumeText.slice(0, 4000) : "No resume uploaded yet.";
        }

        toolMessages.push({ role: "tool", tool_call_id: tc.id, content: output });
      }

      const finalRes = await GROQ_AI.chat.completions.create({
        model: "openai/gpt-oss-120b",
        messages: toolMessages,
        temperature: 0.5,
      });

      return res.json({ success: true, reply: finalRes.choices[0].message.content, toolsUsed });
    }

    res.json({ success: true, reply: msg.content, toolsUsed: [] });
  } catch (err) {
    console.error("Chat Agent Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(process.env.PORT || 5000, () => console.log("CareerPilot Backend running on port 5000"));