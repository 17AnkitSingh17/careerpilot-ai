import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs";

dotenv.config();

const GEMINI_AI = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

const GROQ_AI = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

const JOBS = JSON.parse(fs.readFileSync("./jobs.json", "utf-8"));

async function getEmbedding(text) {
  const res = await GEMINI_AI.embeddings.create({
    model: "gemini-embedding-001",
    input: text,
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

async function runEvals() {
  console.log("🚀 Running CareerPilot AI Evaluation Suite...\n");

  const embeddedJobs = await Promise.all(
    JOBS.map(async (job) => ({
      ...job,
      embedding: await getEmbedding(`${job.title} ${job.skills.join(" ")} ${job.description}`),
    }))
  );

  // 1. Semantic Search Recall@3
  const searchTests = [
    { query: "Node.js, LLM agents, RAG, tool calling, semantic search", expectedId: "job_1" },
    { query: "C++, WebSockets, SQL, distributed backend systems", expectedId: "job_3" },
    { query: "React, Tailwind CSS, frontend UI dashboard", expectedId: "job_5" },
    { query: "Python, LangChain, Vector DB, LLM evaluations", expectedId: "job_4" },
  ];

  let searchPassed = 0;
  for (const test of searchTests) {
    const qVec = await getEmbedding(test.query);
    const top3 = embeddedJobs
      .map((j) => ({ id: j.id, score: cosineSimilarity(qVec, j.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((j) => j.id);

    const hit = top3.includes(test.expectedId);
    if (hit) searchPassed++;
    console.log(`[Search] "${test.query.slice(0, 35)}..." -> Top 3: [${top3.join(", ")}] | ${hit ? "✅ PASS" : "❌ FAIL"}`);
  }

  // 2. Structured JSON Schema Adherence (Groq)
  const schemaTests = [
    "Resume: B.Tech student skilled in C++, Node.js, Express, React, MongoDB, Socket.io.",
    "Resume: Python developer experienced in LangChain, embeddings, Docker, and FastAPI.",
  ];

  let schemaPassed = 0;
  for (const resume of schemaTests) {
    try {
      const res = await GROQ_AI.chat.completions.create({
        model: "openai/gpt-oss-120b",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Return ONLY valid JSON: { "matchPercentage": number, "matchedSkills": string[], "missingSkills": string[], "prepPlan": string[] }`,
          },
          { role: "user", content: `Evaluate for AI Engineer role (Node.js, RAG, LLMs):\n${resume}` },
        ],
        temperature: 0.2,
      });

      const parsed = JSON.parse(res.choices[0].message.content);
      const isValid =
        typeof parsed.matchPercentage === "number" &&
        Array.isArray(parsed.matchedSkills) &&
        Array.isArray(parsed.missingSkills) &&
        Array.isArray(parsed.prepPlan);

      if (isValid) schemaPassed++;
      console.log(`[Schema] Valid JSON & Types: ${isValid ? "✅ PASS" : "❌ FAIL"}`);
    } catch(err) {
     console.log(`[Schema] Error: ${err.message}`);
    }
  }

  console.log("\n📊 FINAL EVAL REPORT");
  console.log(`- Semantic Search Recall@3: ${(searchPassed / searchTests.length) * 100}% (${searchPassed}/${searchTests.length})`);
  console.log(`- JSON Schema Adherence:    ${(schemaPassed / schemaTests.length) * 100}% (${schemaPassed}/${schemaTests.length})`);
}

runEvals();