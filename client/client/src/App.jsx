import React, { useState } from "react";
import axios from "axios";

const API = "http://localhost:5000";

export default function App() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [matchedJobs, setMatchedJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [gapReport, setGapReport] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Hi! I'm CareerPilot AI. Upload your resume on the top-right, or ask me to search jobs and analyze skill gaps.",
      toolsUsed: [],
    },
  ]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // 1. Upload Resume & Semantic Search
  const handleUpload = async () => {
    if (!file) return alert("Pehle PDF resume select kar!");
    setUploading(true);
    const formData = new FormData();
    formData.append("resume", file);
    try {
      const { data } = await axios.post(`${API}/api/upload-resume`, formData);
      if (data.success) {
        setMatchedJobs(data.matchedJobs);
        setGapReport(null);
        setSelectedJob(null);
      }
    } catch (err) {
      alert("Upload error: " + (err.response?.data?.message || err.message));
    } finally {
      setUploading(false);
    }
  };

  // 2. Structured JSON Skill Gap Analysis
  const handleAnalyzeGap = async (job) => {
    setSelectedJob(job);
    setAnalyzing(true);
    setGapReport(null);
    try {
      const { data } = await axios.post(`${API}/api/analyze-gap`, { jobId: job.id });
      if (data.success) setGapReport(data.report);
    } catch (err) {
      alert("Analysis error: " + (err.response?.data?.message || err.message));
    } finally {
      setAnalyzing(false);
    }
  };

  // 3. Tool-Calling AI Agent Chat
  const sendMessage = async (customText = null) => {
    const text = typeof customText === "string" ? customText : input;
    if (!text.trim()) return;

    const updatedMessages = [...messages, { role: "user", content: text }];
    setMessages(updatedMessages);
    if (!customText) setInput("");
    setChatLoading(true);

    try {
      const historyPayload = updatedMessages.map(({ role, content }) => ({ role, content }));
      const { data } = await axios.post(`${API}/api/chat`, { messages: historyPayload });
      if (data.success) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.reply, toolsUsed: data.toolsUsed || [] },
        ]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6 font-sans">
      <header className="max-w-7xl mx-auto mb-6 flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-indigo-400">CareerPilot AI</h1>
          <p className="text-xs text-slate-400">
            Agentic Job Search • Semantic Embeddings • RAG • Structured JSON Outputs
          </p>
        </div>
        <div className="flex items-center gap-2 mt-3 md:mt-0">
          <input
            type="file"
            accept=".pdf"
            onChange={(e) => setFile(e.target.files[0])}
            className="text-xs text-slate-300 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-slate-800 file:text-indigo-300 hover:file:bg-slate-700"
          />
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="bg-indigo-600 hover:bg-indigo-500 px-4 py-1.5 rounded-md text-sm font-medium disabled:opacity-50"
          >
            {uploading ? "Matching..." : "Upload & Match"}
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT: Semantic Matches + Structured Report */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
              🔍 Top Semantic Job Matches (Vector Cosine Similarity)
            </h2>
            {matchedJobs.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">
                Upload your PDF resume above to run semantic search across the jobs index.
              </p>
            ) : (
              <div className="space-y-3">
                {matchedJobs.map((job) => (
                  <div
                    key={job.id}
                    onClick={() => handleAnalyzeGap(job)}
                    className={`p-3 rounded-lg border cursor-pointer transition ${
                      selectedJob?.id === job.id
                        ? "border-indigo-500 bg-indigo-950/30"
                        : "border-slate-800 bg-slate-950/60 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold text-slate-100">{job.title}</h3>
                        <p className="text-xs text-slate-400">
                          {job.company} • {job.location} • {job.stipend}
                        </p>
                      </div>
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
                        {job.matchScore}% Match
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {job.skills.map((s) => (
                        <span key={s} className="text-[11px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
              📊 Structured Skill-Gap Report (Strict JSON Output)
            </h2>
            {analyzing && <p className="text-sm text-indigo-400 animate-pulse">Analyzing resume vs job description...</p>}
            {!analyzing && !gapReport && (
              <p className="text-sm text-slate-500">Click any matched job above to generate a structured skill-gap report.</p>
            )}
            {gapReport && (
              <div className="space-y-4">
                <div className="flex items-center justify-between bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <span className="text-sm font-medium">{selectedJob.title} @ {selectedJob.company}</span>
                  <span className="text-lg font-bold text-indigo-400">{gapReport.matchPercentage}% Fit</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <p className="text-xs font-semibold text-emerald-400 mb-2">Matched Skills</p>
                    <div className="flex flex-wrap gap-1.5">
                      {gapReport.matchedSkills.map((s) => (
                        <span key={s} className="text-xs bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded border border-emerald-800">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <p className="text-xs font-semibold text-rose-400 mb-2">Missing Skills</p>
                    <div className="flex flex-wrap gap-1.5">
                      {gapReport.missingSkills.map((s) => (
                        <span key={s} className="text-xs bg-rose-950 text-rose-300 px-2 py-0.5 rounded border border-rose-800">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <p className="text-xs font-semibold text-indigo-400 mb-2">3-Step Actionable Prep Plan</p>
                  <ol className="list-decimal list-inside text-sm text-slate-300 space-y-1">
                    {gapReport.prepPlan.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Tool-Calling AI Agent */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl flex flex-col h-[620px]">
          <div className="p-3 border-b border-slate-800 flex justify-between items-center">
            <span className="text-sm font-semibold text-indigo-400">🤖 CareerPilot AI Agent (Tool Calling + Memory)</span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m, idx) => (
              <div key={idx} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                {m.toolsUsed && m.toolsUsed.length > 0 && (
                  <span className="text-[11px] bg-indigo-950 text-indigo-300 border border-indigo-800 px-2 py-0.5 rounded-full mb-1">
                    🛠️ Used Tool: {m.toolsUsed.join(", ")}
                  </span>
                )}
                <div
                  className={`max-w-[85%] rounded-lg px-3.5 py-2 text-sm whitespace-pre-wrap ${
                    m.role === "user" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-200"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {chatLoading && <p className="text-xs text-slate-400">Agent is thinking & running tools...</p>}
          </div>

          <div className="px-3 py-2 border-t border-slate-800 flex flex-wrap gap-1.5">
            <button
              onClick={() => sendMessage("Search for AI Agent and Node.js internships")}
              className="text-[11px] bg-slate-800 hover:bg-slate-700 text-indigo-300 px-2.5 py-1 rounded-full"
            >
              🔍 Search AI/Node Jobs
            </button>
            <button
              onClick={() => sendMessage("Read my uploaded resume and tell me my top 2 missing skills for Elip")}
              className="text-[11px] bg-slate-800 hover:bg-slate-700 text-indigo-300 px-2.5 py-1 rounded-full"
            >
              📄 RAG Resume Check
            </button>
          </div>

          <div className="p-3 border-t border-slate-800 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Ask the agent anything..."
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => sendMessage()}
              disabled={chatLoading}
              className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}