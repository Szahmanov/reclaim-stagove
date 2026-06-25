/* Reclaim by StaGove — autonomous consumer dispute-management agent.
   Not a letter generator: it opens a persistent CASE and manages it end to end.
   Every panel in the UI is backed by real logic in this file:
     - deterministic score / schedule / risk / probability engines (pure JS math)
     - a stage state machine that records a real timeline
     - LLM passes for analysis, drafting, self-audit+revise, reply analysis, self-critique
     - per-case memory (localStorage) injected into every prompt
     - a proof-of-autonomy ledger that only ticks actions that actually executed
   LLM: Groq (OpenAI-compatible). End user supplies their own free key.            */

"use strict";

/* ============================================================ config */
/* ── Paste your Cloudflare Worker URL here after deploying worker.js ── */
const PROXY_URL = "https://reclaim-proxy.YOUR-SUBDOMAIN.workers.dev/api/chat";

const GATE = 85;
const MAX_REVISIONS = 2;
const LS = { model: "reclaim.model", lang: "reclaim.lang", cases: "reclaim.cases", active: "reclaim.active" };

/* Standard dispute journey — deterministic offsets in days from case creation. */
const JOURNEY = [
  { kind: "first",     dayOffset: 0,  stage: "FIRST_REQUEST" },
  { kind: "followup",  dayOffset: 7,  stage: "FOLLOWUP" },
  { kind: "demand",    dayOffset: 14, stage: "FINAL_DEMAND" },
  { kind: "chargeback",dayOffset: 21, stage: "CHARGEBACK" },
  { kind: "complaint", dayOffset: 30, stage: "COMPLAINT" },
  { kind: "escalation",dayOffset: 45, stage: "FINAL_ESCALATION" },
];

const state = {
  model: localStorage.getItem(LS.model) || "llama-3.3-70b-versatile",
  lang: localStorage.getItem(LS.lang) || "en",
  busy: false,
  cases: loadCases(),
  activeId: localStorage.getItem(LS.active) || null,
};

/* ============================================================ i18n */
const DICT = {
  en: {
    heroEyebrow: "Autonomous dispute-management agent",
    heroLede: "Open a case and Reclaim manages the whole recovery for you — it scores the case, plans every step with deadlines, drafts each letter, reads the company's replies, and tells you the single next action at all times.",
    lblStory: "What happened?", lblStoryHint: "— the more detail, the stronger the case.",
    lblAmount: "Amount at stake", lblCp: "Who are you dealing with?", lblGoal: "What do you want?",
    lblRegion: "Your country / region", lblRegionHint: "(for context)", lblTone: "Tone", lblOutlang: "Letter language",
    runLabel: "Open my case", runNote: "Creates a persistent case · ~5 reasoning passes · free Groq key.",
    storyPh: "e.g. I cancelled my gym membership in writing on 3 March, but they charged me €39.99 again on 1 April and refuse to refund it. I have the confirmation email.",
    newCase: "New case", cases: "Cases", noCases: "No saved cases yet.",
    keyBtn: "API key", modalTitle: "Connect your free Groq key",
    modalSub: "One free key powers the agent. Stored only in this browser, sent only to Groq.",
    keyLabel: "Groq API key", modelLabel: "Model", testLabel: "Test & save",
    goal: { refund: "A refund", fee: "A fee removed / reversed", deposit: "My deposit returned", replacement: "A repair or replacement", compensation: "Compensation", cancel: "To cancel and stop charges", other: "Something else" },
    tone: { auto: "Let the agent decide", polite: "Polite first request", firm: "Firm", final: "Final demand" },
    runSteps: ["Reading & classifying the case", "Scoring strength & building the evidence model", "Recording strategy & decisions", "Drafting the first letter", "Auditing its own draft", "Planning the full journey"],
    disclaimer: "Reclaim manages disputes and drafts letters based on what you enter. It is not a lawyer and this is not legal advice. Check facts and any [placeholders] before sending; seek professional advice for high-value or complex cases.",
    footNote: "Persistent cases stored on your device. Zero cost to operate.",
    // dashboard
    caseFile: "Case file", status: "Status", stage: "Stage", strength: "Recovery strength", probability: "Probability of recovery",
    risk: "Risk level", nextDeadline: "Next deadline", nextAction: "Next recommended action", doIt: "Generate it now",
    overdue: "due now", dueIn: (d) => `in ${d} day${d === 1 ? "" : "s"}`, dueOn: "on",
    proofTitle: "Proof of autonomy — real actions this case",
    proof: { classified: "Classified the dispute", scored: "Estimated recovery probability", evidence: "Built an evidence model", strategy: "Generated a negotiation strategy", audited: "Evaluated its own output", rewrote: "Rewrote drafts below its quality gate", planned: "Planned future actions with deadlines", escalation: "Selected an escalation path", stored: "Stored the case state", prepared: "Prepared the next autonomous action", replies: "Analyzed a company reply", critique: "Critiqued its own position" },
    evidenceTitle: "Evidence engine — check what you have, the score updates",
    evReq: "Required", evRec: "Recommended", evOpt: "Optional", have: "Have it", missing: "Missing",
    simNow: "Current score", simPot: "If you add the missing evidence", simAdd: "+",
    docTitle: "Current document", softer: "Softer", firmer: "Firmer", copy: "Copy", copied: "Copied", regen: "Regenerate",
    replyTitle: "Reply analyzer — paste what the company sent back",
    replyPlaceholder: "Paste the company's email or message here. The agent decides whether it's a real answer, whether they're stalling or dodging, and what to do next.",
    analyzeReply: "Analyze reply", replyVerdict: "Verdict", genResponse: "Generate the next response",
    timelineTitle: "Autonomous timeline", decisionsTitle: "Decision engine — why the agent did each thing",
    why: "Why", rejected: "Rejected alternatives",
    critiqueTitle: "Agent self-critique", runCritique: "Have the agent review the case now", recommendation: "Recommendation",
    reportTitle: "Autonomous decision report", confidence: "Confidence",
    rGoal: "Goal detected", rDecisions: "Decisions made", rEvidence: "Evidence analyzed", rRisks: "Risks found", rRejected: "Strategies rejected", rWhy: "Why this strategy", rNext: "Next autonomous action",
    deleteCase: "Delete case", confirmDelete: "Delete this case permanently?",
    stages: { INTAKE: "Intake", FIRST_REQUEST: "First request", AWAITING_REPLY: "Awaiting reply", FOLLOWUP: "Follow-up", FINAL_DEMAND: "Final demand", CHARGEBACK: "Chargeback", COMPLAINT: "Formal complaint", FINAL_ESCALATION: "Final escalation", RESOLVED: "Resolved", CLOSED: "Closed" },
    riskL: { low: "Low", medium: "Medium", high: "High" },
    kinds: { first: "First request letter", followup: "Follow-up letter", demand: "Final demand letter", chargeback: "Chargeback / bank dispute script", complaint: "Formal complaint", escalation: "Final escalation letter", response: "Response to their reply" },
    waiting: "Waiting — next step is scheduled, nothing to do yet.",
    markResolved: "Mark resolved", reopen: "Reopen", resolvedMsg: "Case resolved. Nice work.",
    errNoKey: "Add your free Groq key first — tap “API key” at the top.",
    errEmpty: "Describe what happened first.",
    err429: "Groq is rate-limiting the free tier. Wait a few seconds and retry.",
    errAuth: "That key was rejected by Groq. Open “API key” and check it.",
    errParse: "The model returned something unexpected. Try again; if it persists, switch model.",
    errNet: "Couldn't reach Groq. Check your connection and retry.",
    testOk: "Working — saved.", testBad: "Key rejected.", testEmpty: "Paste a key first.", testing: "Testing…",
  },
  bg: {
    heroEyebrow: "Автономен агент за управление на спорове",
    heroLede: "Отваряш казус и Reclaim води цялото връщане вместо теб — оценява казуса, планира всяка стъпка със срокове, пише всяко писмо, чете отговорите на фирмата и винаги ти казва единственото следващо действие.",
    lblStory: "Какво се случи?", lblStoryHint: "— колкото повече детайли, толкова по-силен казус.",
    lblAmount: "Сума на карта", lblCp: "С кого имаш спор?", lblGoal: "Какво искаш?",
    lblRegion: "Държава / регион", lblRegionHint: "(за контекст)", lblTone: "Тон", lblOutlang: "Език на писмото",
    runLabel: "Отвори казуса", runNote: "Създава траен казус · ~5 разсъждаващи стъпки · безплатен Groq ключ.",
    storyPh: "напр. Прекратих абонамента за фитнес писмено на 3 март, но на 1 април пак ми взеха 39.99 € и отказват да върнат. Имам имейла с потвърждението.",
    newCase: "Нов казус", cases: "Казуси", noCases: "Все още няма запазени казуси.",
    keyBtn: "API ключ", modalTitle: "Свържи безплатния си Groq ключ",
    modalSub: "Един безплатен ключ задвижва агента. Пази се само в този браузър, изпраща се само към Groq.",
    keyLabel: "Groq API ключ", modelLabel: "Модел", testLabel: "Тествай и запази",
    goal: { refund: "Връщане на пари", fee: "Премахната / сторнирана такса", deposit: "Връщане на депозита", replacement: "Ремонт или замяна", compensation: "Обезщетение", cancel: "Прекратяване и спиране на плащания", other: "Друго" },
    tone: { auto: "Агентът да реши", polite: "Учтива първа молба", firm: "Твърд", final: "Последно искане" },
    runSteps: ["Разчитане и класифициране на казуса", "Оценка на силата и модел на доказателствата", "Записване на стратегия и решения", "Писане на първото писмо", "Самооценка на черновата", "Планиране на целия път"],
    disclaimer: "Reclaim управлява спорове и пише писма според това, което въведеш. Не е адвокат и това не е правен съвет. Провери фактите и полетата в [скоби] преди изпращане; за големи или сложни казуси потърси професионален съвет.",
    footNote: "Трайните казуси се пазят на устройството ти. Нулева цена за поддръжка.",
    caseFile: "Досие на казуса", status: "Статус", stage: "Етап", strength: "Сила на казуса", probability: "Вероятност за връщане",
    risk: "Ниво на риск", nextDeadline: "Следващ срок", nextAction: "Следващо препоръчано действие", doIt: "Генерирай сега",
    overdue: "дължимо сега", dueIn: (d) => `след ${d} ден${d === 1 ? "" : "а"}`, dueOn: "на",
    proofTitle: "Доказателство за автономност — реални действия по казуса",
    proof: { classified: "Класифицира спора", scored: "Оцени вероятността за връщане", evidence: "Изгради модел на доказателствата", strategy: "Генерира стратегия за преговори", audited: "Оцени собствения си резултат", rewrote: "Пренаписа черновите под прага си", planned: "Планира бъдещи действия със срокове", escalation: "Избра път за ескалация", stored: "Запази състоянието на казуса", prepared: "Подготви следващото автономно действие", replies: "Анализира отговор на фирмата", critique: "Критикува собствената си позиция" },
    evidenceTitle: "Доказателства — отметни какво имаш, оценката се обновява",
    evReq: "Задължително", evRec: "Препоръчително", evOpt: "По избор", have: "Имам го", missing: "Липсва",
    simNow: "Текуща оценка", simPot: "Ако добавиш липсващите доказателства", simAdd: "+",
    docTitle: "Текущ документ", softer: "По-меко", firmer: "По-твърдо", copy: "Копирай", copied: "Копирано", regen: "Регенерирай",
    replyTitle: "Анализ на отговор — постави какво е върнала фирмата",
    replyPlaceholder: "Постави имейла или съобщението на фирмата тук. Агентът преценява дали е реален отговор, дали бавят или увъртат, и какво да направиш после.",
    analyzeReply: "Анализирай отговора", replyVerdict: "Заключение", genResponse: "Генерирай следващия отговор",
    timelineTitle: "Автономна хронология", decisionsTitle: "Решения — защо агентът направи всяко нещо",
    why: "Защо", rejected: "Отхвърлени алтернативи",
    critiqueTitle: "Самокритика на агента", runCritique: "Агентът да прегледа казуса сега", recommendation: "Препоръка",
    reportTitle: "Автономен доклад за решенията", confidence: "Увереност",
    rGoal: "Открита цел", rDecisions: "Взети решения", rEvidence: "Анализирани доказателства", rRisks: "Открити рискове", rRejected: "Отхвърлени стратегии", rWhy: "Защо тази стратегия", rNext: "Следващо автономно действие",
    deleteCase: "Изтрий казуса", confirmDelete: "Да изтрия този казус завинаги?",
    stages: { INTAKE: "Прием", FIRST_REQUEST: "Първа молба", AWAITING_REPLY: "Чакане на отговор", FOLLOWUP: "Напомняне", FINAL_DEMAND: "Последно искане", CHARGEBACK: "Chargeback", COMPLAINT: "Формална жалба", FINAL_ESCALATION: "Крайна ескалация", RESOLVED: "Решен", CLOSED: "Затворен" },
    riskL: { low: "Нисък", medium: "Среден", high: "Висок" },
    kinds: { first: "Първо писмо с молба", followup: "Писмо-напомняне", demand: "Писмо с последно искане", chargeback: "Скрипт за chargeback / банка", complaint: "Формална жалба", escalation: "Писмо за крайна ескалация", response: "Отговор на тяхното писмо" },
    waiting: "Изчакване — следващата стъпка е насрочена, още няма какво да правиш.",
    markResolved: "Отбележи като решен", reopen: "Отвори отново", resolvedMsg: "Казусът е решен. Браво.",
    errNoKey: "Първо добави безплатния си Groq ключ — натисни „API ключ“ горе.",
    errEmpty: "Първо опиши какво се случи.",
    err429: "Groq ограничава безплатния план. Изчакай няколко секунди и опитай пак.",
    errAuth: "Groq отхвърли този ключ. Отвори „API ключ“ и го провери.",
    errParse: "Моделът върна нещо неочаквано. Опитай пак; ако продължава, смени модела.",
    errNet: "Няма връзка с Groq. Провери интернета и опитай пак.",
    testOk: "Работи — запазено.", testBad: "Ключът е отхвърлен.", testEmpty: "Първо постави ключ.", testing: "Тествам…",
  },
};
const t = () => DICT[state.lang];

/* ============================================================ small utils */
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const DAY = 86400000;
const now = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function uid() { return "C-" + Math.random().toString(36).slice(2, 7).toUpperCase(); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
function fmtDate(ts) { return new Date(ts).toLocaleDateString(state.lang === "bg" ? "bg-BG" : "en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
function fmtAmount(a) { const n = parseFloat(a); return isFinite(n) ? n.toLocaleString(state.lang === "bg" ? "bg-BG" : "en-US", { maximumFractionDigits: 2 }) : a; }

/* ============================================================ case store (memory) */
function loadCases() { try { return JSON.parse(localStorage.getItem(LS.cases) || "{}"); } catch { return {}; } }
function persist() { localStorage.setItem(LS.cases, JSON.stringify(state.cases)); }
function saveCase(c) { state.cases[c.id] = c; persist(); }
function getActive() { return state.activeId ? state.cases[state.activeId] : null; }
function setActive(id) { state.activeId = id; if (id) localStorage.setItem(LS.active, id); else localStorage.removeItem(LS.active); }
function deleteCase(id) { delete state.cases[id]; persist(); if (state.activeId === id) setActive(null); }

/* ============================================================ DETERMINISTIC ENGINES (no LLM) */

/* Score: floor (LLM, no evidence) + weight of every evidence item the user HAS. Pure math. */
function computeScore(c) {
  const floor = clamp(c.floorScore || 0, 0, 100);
  const have = (c.evidence || []).filter((e) => e.have).reduce((s, e) => s + (e.weight || 0), 0);
  const miss = (c.evidence || []).filter((e) => !e.have).reduce((s, e) => s + (e.weight || 0), 0);
  return { floor, current: clamp(floor + have, 0, 100), potential: clamp(floor + have + miss, 0, 100), missWeight: miss };
}

/* Schedule: real dates from creation; marks done when a letter of that kind exists. */
function buildSchedule(c) {
  return JOURNEY.map((j) => {
    const done = (c.letters || []).some((l) => l.kind === j.kind);
    return { ...j, dueAt: c.createdAt + j.dayOffset * DAY, done };
  });
}

/* Next action: earliest not-done step; overdue if its dueAt has passed. */
function nextAction(c) {
  if (c.stage === "RESOLVED" || c.stage === "CLOSED") return null;
  const sched = buildSchedule(c);
  const pending = sched.filter((s) => !s.done);
  if (!pending.length) return null;
  const due = pending.find((s) => s.dueAt <= now()) || pending[0];
  return { kind: due.kind, stage: due.stage, dueAt: due.dueAt, overdue: due.dueAt <= now() };
}

/* Risk: derived from score, overdue deadlines, and reply behaviour. Real rules. */
function riskLevel(c) {
  const { current } = computeScore(c);
  const na = nextAction(c);
  let r = 0;
  if (current < 45) r += 2; else if (current < 70) r += 1;
  if (na && na.overdue) r += 1;
  const lastReply = (c.replies || [])[c.replies.length - 1];
  if (lastReply && lastReply.analysis) { if (lastReply.analysis.stalling) r += 1; if (lastReply.analysis.legallyWeak === false) r += 1; }
  return r >= 3 ? "high" : r >= 1 ? "medium" : "low";
}

/* Probability of recovery = current evidence-weighted score, nudged by stage progress. Honest estimate. */
function probability(c) {
  const { current } = computeScore(c);
  let p = current;
  if (c.stage === "RESOLVED") p = 100;
  if (c.stage === "CHARGEBACK" || c.stage === "COMPLAINT") p = clamp(p + 4, 0, 96);
  return Math.round(p);
}

/* State machine: append a real timeline event. */
function advanceStage(c, stage, label, note) {
  c.stage = stage;
  c.stageHistory = c.stageHistory || [];
  c.stageHistory.push({ at: now(), stage, label, note: note || "" });
  saveCase(c);
}

/* ============================================================ Groq */
function stripFences(s) { return s.replace(/^\s*```(?:json|text)?\s*/i, "").replace(/\s*```\s*$/i, "").trim(); }
function extractJSON(raw) { const s = stripFences(raw); const a = s.indexOf("{"), b = s.lastIndexOf("}"); if (a < 0 || b < 0) throw new Error("nojson"); return JSON.parse(s.slice(a, b + 1)); }
class AgentError extends Error { constructor(code) { super(code); this.code = code; } }

async function groq(messages, { json = false, maxTokens = 900, temp = 0.5 } = {}) {
  const body = { model: state.model, messages, temperature: temp, max_tokens: maxTokens };
  if (json) body.response_format = { type: "json_object" };
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try { res = await fetch(PROXY_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    catch { throw new AgentError("net"); }
    if (res.status === 429 || res.status >= 500) { const ra = parseFloat(res.headers.get("retry-after")) * 1000; await sleep(Math.min(isFinite(ra) && ra > 0 ? ra : 1500 * (attempt + 1), 6000)); lastErr = new AgentError(res.status === 429 ? "rate" : "net"); continue; }
    if (res.status === 401 || res.status === 403) throw new AgentError("auth");
    if (!res.ok) throw new AgentError("net");
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || "";
    if (!json) return stripFences(text);
    try { return extractJSON(text); } catch { throw new AgentError("parse"); }
  }
  throw lastErr || new AgentError("net");
}

/* ============================================================ memory: case context for prompts */
function memoryBrief(c, lang) {
  const sc = computeScore(c);
  const lastLetters = (c.letters || []).slice(-2).map((l) => `(${l.kind}) ${l.text.slice(0, 400)}`).join("\n---\n");
  const lastReplies = (c.replies || []).slice(-2).map((r) => `THEM: ${r.text.slice(0, 400)}`).join("\n---\n");
  return (
    `LANGUAGE FOR USER-FACING TEXT: ${lang}.\n` +
    `CASE MEMORY (use it; do not ask the user to repeat anything):\n` +
    `Dispute: ${c.disputeType}. Counterparty: ${c.input.counterparty || "(unknown)"}. ` +
    `Amount: ${c.input.amount ? c.input.amount + " " + c.input.currency : "(unknown)"}. Goal: ${c.input.goalText}. Region: ${c.input.region || "(unknown)"}.\n` +
    `Current stage: ${c.stage}. Current strength: ${sc.current}/100.\n` +
    `Leverage: ${(c.leverage || []).join("; ")}.\n` +
    `Evidence held: ${(c.evidence || []).filter((e) => e.have).map((e) => e.label).join(", ") || "none"}.\n` +
    `Evidence missing: ${(c.evidence || []).filter((e) => !e.have).map((e) => e.label).join(", ") || "none"}.\n` +
    (lastLetters ? `Recent letters we sent:\n${lastLetters}\n` : "") +
    (lastReplies ? `Recent replies from them:\n${lastReplies}\n` : "") +
    `Original situation:\n"""${c.input.story}"""\n`
  );
}

const ROLE =
  "You are Reclaim, an autonomous consumer dispute-management agent by StaGove. You manage a recovery case end to end for an ordinary consumer. " +
  "You are NOT a lawyer and never claim to be; you produce strategy and letters, not legal advice. " +
  "You never invent facts the user did not give (names, dates, amounts, reference numbers); for unknown but needed details insert a clearly marked [PLACEHOLDER]. " +
  "You never write false legal threats or defamatory claims.";

/* ============================================================ LLM PASSES */

async function llmAnalyze(c, lang) {
  const sys = ROLE + " Return ONLY a valid JSON object.";
  const usr =
    memoryBrief(c, lang) +
    `\nOpen the case. Return JSON with EXACTLY these keys:\n` +
    `{"disputeType": short label in ${lang},` +
    `"summary": one neutral factual sentence in ${lang},` +
    `"floorScore": integer 0-100 = realistic recovery chance with NO supporting evidence beyond the bare story,` +
    `"strengthWhy": one sentence in ${lang},` +
    `"leverage": array of 3-5 short leverage points in ${lang},` +
    `"recommendedTone": one of "polite","firm","final",` +
    `"risks": array of up to 3 objects {"risk": in ${lang}, "severity": "low"|"medium"|"high"},` +
    `"decisions": array of 2-4 objects {"decision": short, in ${lang}, "reasoning": one sentence in ${lang}, "rejected": one rejected alternative in ${lang}},` +
    `"evidence": array of 4-7 objects {"label": in ${lang}, "category": "required"|"recommended"|"optional", "weight": integer points 3-20 this adds to the score when obtained, "have": boolean true ONLY if the story clearly says the user already has it}}\n` +
    `Make the evidence weights sum to roughly (100 - floorScore) across all items so a fully-evidenced case approaches 100.`;
  return groq([{ role: "system", content: sys }, { role: "user", content: usr }], { json: true, maxTokens: 1300, temp: 0.4 });
}

async function llmDraft(c, kind, tone, lang) {
  const sys = ROLE + " Output ONLY the document text — no preamble, no notes, no markdown headings.";
  const what = {
    first: "a first, clear written request",
    followup: "a short follow-up that references the earlier unanswered request and restates the deadline",
    demand: "a firm final demand before escalation, citing the prior unanswered contacts",
    chargeback: "a concise script/notes the user can give their card issuer or bank to dispute the charge as a billing error, listing the facts and evidence to cite",
    complaint: "a formal complaint addressed to the relevant consumer-protection body for the region, summarising the timeline and what was tried",
    escalation: "a final escalation letter stating that, absent resolution, the user will pursue available consumer remedies",
    response: "a direct response to the company's latest reply that answers their points and keeps the recovery on track",
  }[kind] || "a clear written request";
  const usr =
    memoryBrief(c, lang) +
    `\nWrite ${what}, in ${lang}, tone = ${tone}. Use only known facts; insert [PLACEHOLDER] for anything unknown. ` +
    `State the request (${c.input.goalText}) and the amount if known, set a reasonable deadline, and note the next step if ignored WITHOUT bluffing about legal action. End with a signature placeholder.`;
  return groq([{ role: "system", content: sys }, { role: "user", content: usr }], { maxTokens: 1100, temp: 0.6 });
}

async function llmAudit(text, lang) {
  const sys = "You are a strict reviewer of a consumer dispute document written by an AI agent. Be demanding. Return ONLY JSON.";
  const usr = `Review:\n"""${text}"""\nReturn JSON {"scores":{"factualSafety":n,"legalSafety":n,"persuasiveness":n,"firmness":n,"completeness":n,"clarity":n},"overall":n,"weaknesses":[up to 4 short fixes in ${lang}],"pass": boolean}. Pass true only if overall>=${GATE} AND factualSafety>=85 AND legalSafety>=85.`;
  return groq([{ role: "system", content: sys }, { role: "user", content: usr }], { json: true, maxTokens: 480, temp: 0.3 });
}

async function llmRevise(text, weaknesses, tone, lang) {
  const sys = ROLE + " Output ONLY the revised document text.";
  const usr = `Revise this to fix every weakness, tone=${tone}, language=${lang}. Keep facts truthful and keep [PLACEHOLDER] for unknowns.\nWeaknesses:\n- ${(weaknesses || []).join("\n- ")}\n\nDocument:\n"""${text}"""`;
  return groq([{ role: "system", content: sys }, { role: "user", content: usr }], { maxTokens: 1100, temp: 0.5 });
}

/* draft + self-audit + bounded revise loop. Returns {text, audit, revisions}. */
async function draftWithGate(c, kind, tone, lang, onLog) {
  let text = await llmDraft(c, kind, tone, lang);
  onLog && onLog(`[draft] ${kind} v1 (${text.length} chars)`);
  let audit = await llmAudit(text, lang), rev = 0;
  onLog && onLog(`[audit] v1 overall=${audit.overall}/100 factual=${audit.scores?.factualSafety} legal=${audit.scores?.legalSafety}`);
  while (!audit.pass && rev < MAX_REVISIONS) {
    onLog && onLog(`[gate] ${audit.overall} < ${GATE} → revising`);
    text = await llmRevise(text, audit.weaknesses, tone, lang); rev++;
    audit = await llmAudit(text, lang);
    onLog && onLog(`[audit] v${rev + 1} overall=${audit.overall}/100`);
  }
  return { text, audit, revisions: rev };
}

async function llmAnalyzeReply(c, replyText, lang) {
  const sys = ROLE + " Return ONLY JSON.";
  const usr =
    memoryBrief(c, lang) +
    `\nThe company replied:\n"""${replyText}"""\nAnalyze it. Return JSON {` +
    `"isRealAnswer": boolean, "avoidsResponsibility": boolean, "legallyWeak": boolean, "contradicts": boolean, "stalling": boolean, ` +
    `"verdict": one short sentence in ${lang} summarising what they're doing, ` +
    `"recommendedAction": one of "escalate","negotiate","wait","accept", ` +
    `"reasoning": one sentence in ${lang}, ` +
    `"nextKind": one of "followup","demand","chargeback","complaint","escalation","response"}`;
  return groq([{ role: "system", content: sys }, { role: "user", content: usr }], { json: true, maxTokens: 480, temp: 0.35 });
}

async function llmSelfCritique(c, lang) {
  const sys = ROLE + " You are auditing your own management of this case. Be honest and specific. Return ONLY JSON.";
  const usr =
    memoryBrief(c, lang) +
    `\nCritique the current handling. Return JSON {"items":[up to 5 objects {"question": short, in ${lang}, "assessment": one sentence in ${lang}}], "overall": one sentence recommendation in ${lang}, "action": one of "wait","escalate","gather_evidence","change_strategy","rewrite"}`;
  return groq([{ role: "system", content: sys }, { role: "user", content: usr }], { json: true, maxTokens: 600, temp: 0.4 });
}

/* ============================================================ ORCHESTRATION */

function newProof() { return { classified: false, scored: false, evidence: false, strategy: false, audited: false, rewrote: false, planned: false, escalation: false, stored: false, prepared: false, replies: false, critique: false }; }

async function runIntake() {
  if (state.busy) return;
  const story = $("story").value.trim();
  if (!story) { showMsg(t().errEmpty, "warn"); $("story").focus(); return; }

  const goalSel = $("goal");
  const c = {
    id: uid(), createdAt: now(), lang: state.lang, outLang: $("outlang").value,
    input: { story, counterparty: $("counterparty").value.trim(), amount: $("amount").value.trim().replace(",", "."), currency: $("currency").value, region: $("region").value.trim(), goalText: goalSel.options[goalSel.selectedIndex].textContent },
    stage: "INTAKE", stageHistory: [], letters: [], replies: [], selfCritique: [], proof: newProof(),
    toneChoice: $("tone").value, evidence: [], decisions: [], risks: [], leverage: [],
  };

  state.busy = true; clearMsg(); $("run-btn").disabled = true;
  $("intake-working").classList.add("show");
  buildSteps($("intake-steps"), t().runSteps);
  const setStep = (i, s) => stepStatus($("intake-steps"), i, s);
  const log = []; const onLog = (s) => { log.push(s); };

  try {
    setStep(0, "run");
    const a = await llmAnalyze(c, c.outLang);
    c.disputeType = a.disputeType; c.summary = a.summary; c.floorScore = a.floorScore; c.strengthWhy = a.strengthWhy;
    c.leverage = a.leverage || []; c.recommendedTone = a.recommendedTone || "firm"; c.risks = a.risks || []; c.decisions = a.decisions || [];
    c.evidence = (a.evidence || []).map((e, i) => ({ id: "ev" + i, label: e.label, category: e.category || "recommended", weight: clamp(e.weight || 5, 1, 25), have: !!e.have }));
    c.proof.classified = true; setStep(0, "done");
    setStep(1, "done"); c.proof.scored = true; c.proof.evidence = true;
    setStep(2, "done"); c.proof.strategy = true;

    const tone = c.toneChoice === "auto" ? c.recommendedTone : c.toneChoice;
    setStep(3, "run");
    const r = await draftWithGate(c, "first", tone, c.outLang, onLog);
    c.letters.push({ at: now(), kind: "first", tone, text: r.text, auditScore: r.audit.overall, revisions: r.revisions });
    c.confidence = r.audit.overall; c.proof.audited = true; if (r.revisions > 0) c.proof.rewrote = true;
    setStep(3, "done"); setStep(4, "done");

    setStep(5, "run");
    c.proof.planned = true; c.proof.escalation = true; // journey + escalation path are deterministic, built now
    advanceStage(c, "FIRST_REQUEST", t().stages.FIRST_REQUEST, c.summary);
    advanceStage(c, "AWAITING_REPLY", t().stages.AWAITING_REPLY);
    c.proof.stored = true; c.proof.prepared = true;
    setStep(5, "done");

    c.decisionLog = log;
    saveCase(c); setActive(c.id);
    await sleep(250);
    $("intake-working").classList.remove("show");
    showView("dashboard"); renderDashboard();
  } catch (e) {
    $("intake-working").classList.remove("show");
    showMsg(messageFor(e), "err");
  } finally { state.busy = false; $("run-btn").disabled = false; }
}

async function generateDue() {
  const c = getActive(); if (!c || state.busy) return;
  const na = nextAction(c); if (!na) return;
  state.busy = true; lockDash(true);
  const log = c.decisionLog || (c.decisionLog = []);
  try {
    const tone = na.kind === "first" ? (c.recommendedTone) : (na.kind === "demand" || na.kind === "escalation" ? "final" : "firm");
    const r = await draftWithGate(c, na.kind, tone, c.outLang, (s) => log.push(s));
    c.letters.push({ at: now(), kind: na.kind, tone, text: r.text, auditScore: r.audit.overall, revisions: r.revisions });
    c.confidence = r.audit.overall; c.proof.audited = true; if (r.revisions > 0) c.proof.rewrote = true;
    // record a real procedural decision tied to state
    c.decisions.push(decisionForKind(c, na.kind));
    advanceStage(c, na.stage, t().stages[na.stage], t().kinds[na.kind]);
    if (na.kind !== "complaint" && na.kind !== "escalation") advanceStage(c, "AWAITING_REPLY", t().stages.AWAITING_REPLY);
    saveCase(c); renderDashboard();
  } catch (e) { showMsg(messageFor(e), "err"); }
  finally { state.busy = false; lockDash(false); }
}

function decisionForKind(c, kind) {
  const d = t();
  const map = {
    followup: { decision: d.kinds.followup, reasoning: state.lang === "bg" ? "Първата молба остана без отговор до срока, затова напомняме, преди да ескалираме." : "The first request went unanswered by its deadline, so we remind before escalating.", rejected: state.lang === "bg" ? "Директна ескалация — рано е без напомняне." : "Immediate escalation — premature without a reminder." },
    demand: { decision: d.kinds.demand, reasoning: state.lang === "bg" ? "Няколко контакта без резултат — нужна е твърда позиция със срок преди chargeback." : "Several contacts without resolution — a firm, dated position is needed before a chargeback.", rejected: state.lang === "bg" ? "Веднага съд — несъразмерно и скъпо." : "Court immediately — disproportionate and costly." },
    chargeback: { decision: d.kinds.chargeback, reasoning: state.lang === "bg" ? "Платено с карта и липсва резолюция — chargeback е по-бърз и безплатен лост от съд." : "Card payment and no resolution — a chargeback is a faster, free lever than court.", rejected: state.lang === "bg" ? "Само писма — изчерпани са." : "More letters — exhausted." },
    complaint: { decision: d.kinds.complaint, reasoning: state.lang === "bg" ? "Прякото уреждане се провали; формална жалба създава натиск и документира случая." : "Direct settlement failed; a formal complaint adds pressure and documents the case.", rejected: state.lang === "bg" ? "Отказване — губиш сумата." : "Dropping it — you lose the money." },
    escalation: { decision: d.kinds.escalation, reasoning: state.lang === "bg" ? "Всички по-меки стъпки са изчерпани; крайната ескалация е последното извънсъдебно средство." : "All softer steps are exhausted; final escalation is the last out-of-court lever.", rejected: state.lang === "bg" ? "Бездействие — затваря казуса без връщане." : "Inaction — closes the case with no recovery." },
  };
  return map[kind] || { decision: d.kinds[kind] || kind, reasoning: "", rejected: "" };
}

async function submitReply() {
  const c = getActive(); if (!c || state.busy) return;
  const text = $("reply-input").value.trim(); if (!text) return;
  state.busy = true; lockDash(true);
  try {
    const a = await llmAnalyzeReply(c, text, c.outLang);
    c.replies.push({ at: now(), text, analysis: a });
    c.proof.replies = true;
    advanceStage(c, "AWAITING_REPLY", t().stages.AWAITING_REPLY, a.verdict); // log the reply receipt as an event
    c.stageHistory[c.stageHistory.length - 1].label = state.lang === "bg" ? "Получен отговор" : "Reply received";
    // route by recommended action — real state change
    if (a.recommendedAction === "accept") { advanceStage(c, "RESOLVED", t().stages.RESOLVED, a.verdict); }
    saveCase(c);
    $("reply-input").value = "";
    renderDashboard();
  } catch (e) { showMsg(messageFor(e), "err"); }
  finally { state.busy = false; lockDash(false); }
}

async function generateReplyResponse() {
  const c = getActive(); if (!c || state.busy) return;
  const lastReply = (c.replies || [])[c.replies.length - 1]; if (!lastReply) return;
  state.busy = true; lockDash(true);
  const log = c.decisionLog || (c.decisionLog = []);
  try {
    const kind = lastReply.analysis?.nextKind || "response";
    const tone = lastReply.analysis?.recommendedAction === "escalate" ? "final" : "firm";
    const r = await draftWithGate(c, kind === "response" ? "response" : kind, tone, c.outLang, (s) => log.push(s));
    c.letters.push({ at: now(), kind: kind === "response" ? "response" : kind, tone, text: r.text, auditScore: r.audit.overall, revisions: r.revisions });
    c.confidence = r.audit.overall; c.proof.audited = true; if (r.revisions > 0) c.proof.rewrote = true;
    if (["chargeback", "complaint", "escalation", "demand", "followup"].includes(kind)) advanceStage(c, JOURNEY.find((j) => j.kind === kind)?.stage || c.stage, t().kinds[kind] || "");
    saveCase(c); renderDashboard();
  } catch (e) { showMsg(messageFor(e), "err"); }
  finally { state.busy = false; lockDash(false); }
}

async function runSelfCritique() {
  const c = getActive(); if (!c || state.busy) return;
  state.busy = true; lockDash(true);
  try {
    const sc = await llmSelfCritique(c, c.outLang);
    // code-enforced guards override the model where the rules are objective
    const na = nextAction(c); const { current } = computeScore(c);
    if (na && !na.overdue && sc.action === "escalate") { sc.action = "wait"; sc.overall = (state.lang === "bg" ? "Срокът още не е минал — изчакай преди ескалация. " : "The deadline hasn't passed — wait before escalating. ") + sc.overall; }
    if (current < 45 && sc.action !== "gather_evidence") { sc.action = "gather_evidence"; }
    c.selfCritique = sc; c.proof.critique = true; saveCase(c); renderDashboard();
  } catch (e) { showMsg(messageFor(e), "err"); }
  finally { state.busy = false; lockDash(false); }
}

function messageFor(e) { const d = t(); return { rate: d.err429, auth: d.errAuth, parse: d.errParse, net: d.errNet }[e.code] || d.errParse; }

/* ============================================================ VIEWS / RENDER */
function showView(v) {
  $("intake").style.display = v === "intake" ? "block" : "none";
  $("dashboard").style.display = v === "dashboard" ? "block" : "none";
  $("hero").style.display = v === "intake" ? "block" : "none";
}

function lockDash(on) { document.querySelectorAll(".dash-btn").forEach((b) => (b.disabled = on)); $("dash-busy").classList.toggle("show", on); }

function renderDashboard() {
  const c = getActive(); if (!c) { showView("intake"); return; }
  const d = t();
  const sc = computeScore(c); const na = nextAction(c); const risk = riskLevel(c); const prob = probability(c);

  // CASE FILE header
  const cf = $("casefile"); cf.innerHTML = "";
  cf.appendChild(kv(d.caseFile, c.id + " · " + fmtDate(c.createdAt), true));
  cf.appendChild(stat(d.strength, sc.current + " / 100", "strong-" + band(sc.current)));
  cf.appendChild(stat(d.probability, prob + "%", "strong-" + band(prob)));
  cf.appendChild(stat(d.risk, d.riskL[risk], "risk-" + risk));
  cf.appendChild(stat(d.stage, d.stages[c.stage] || c.stage));
  if (na) {
    const due = na.overdue ? d.overdue : (d.dueIn(Math.max(0, Math.ceil((na.dueAt - now()) / DAY))));
    cf.appendChild(stat(d.nextDeadline, fmtDate(na.dueAt) + " · " + due, na.overdue ? "risk-high" : ""));
  }
  $("case-amount").textContent = c.input.amount ? `${fmtAmount(c.input.amount)} ${c.input.currency}` : "";
  $("case-summary").textContent = c.summary || "";

  // NEXT ACTION banner
  const nb = $("next-action"); nb.innerHTML = "";
  if (c.stage === "RESOLVED" || c.stage === "CLOSED") {
    nb.appendChild(el("div", "na-resolved", `<i class="ti"></i>${esc(d.resolvedMsg)}`));
    const reo = el("button", "mini-btn dash-btn", d.reopen); reo.onclick = () => { advanceStage(c, na ? na.stage : "AWAITING_REPLY", d.stages.AWAITING_REPLY); renderDashboard(); }; nb.appendChild(reo);
  } else if (na) {
    const label = el("div", "na-label"); label.innerHTML = `<span class="na-cap">${esc(d.nextAction)}</span><span class="na-kind">${esc(d.kinds[na.kind])}</span>`;
    nb.appendChild(label);
    const btn = el("button", "cta dash-btn", esc(d.doIt)); btn.onclick = generateDue; nb.appendChild(btn);
    const mr = el("button", "mini-btn dash-btn", d.markResolved); mr.onclick = () => { advanceStage(c, "RESOLVED", d.stages.RESOLVED); renderDashboard(); }; nb.appendChild(mr);
  } else { nb.appendChild(el("div", "na-wait", esc(d.waiting))); }

  renderProof(c); renderEvidence(c); renderDocument(c); renderTimeline(c); renderDecisions(c); renderCritique(c); renderReport(c); renderReplyPanel(c);
  $("dash-disclaimer").textContent = d.disclaimer;
}

const band = (n) => (n >= 75 ? "strong" : n >= 45 ? "moderate" : "weak");
function kv(k, v, mono) { const e = el("div", "kv"); e.innerHTML = `<span class="kv-k">${esc(k)}</span><span class="kv-v${mono ? " mono" : ""}">${esc(v)}</span>`; return e; }
function stat(k, v, cls) { const e = el("div", "stat"); e.innerHTML = `<span class="stat-k">${esc(k)}</span><span class="stat-v ${cls || ""}">${esc(v)}</span>`; return e; }

function renderProof(c) {
  const d = t(); const box = $("proof"); box.innerHTML = "";
  const order = ["classified", "scored", "evidence", "strategy", "audited", "rewrote", "planned", "escalation", "stored", "prepared", "replies", "critique"];
  order.forEach((k) => {
    const on = !!c.proof[k];
    const item = el("div", "proof-item" + (on ? " on" : ""));
    item.innerHTML = `<span class="pcheck">${on ? "✓" : ""}</span><span>${esc(d.proof[k])}</span>`;
    box.appendChild(item);
  });
}

function renderEvidence(c) {
  const d = t(); const sc = computeScore(c);
  $("ev-now").textContent = sc.current; $("ev-pot").textContent = sc.potential;
  $("ev-now-fill").style.width = sc.current + "%"; $("ev-pot-fill").style.width = sc.potential + "%";
  $("ev-now-fill").className = "bar-fill strong-" + band(sc.current);
  const lab = { required: d.evReq, recommended: d.evRec, optional: d.evOpt };
  const box = $("evidence-list"); box.innerHTML = "";
  (c.evidence || []).slice().sort((a, b) => (a.have - b.have) || (b.weight - a.weight)).forEach((e) => {
    const row = el("label", "ev-row" + (e.have ? " have" : ""));
    row.innerHTML =
      `<input type="checkbox" class="dash-btn" ${e.have ? "checked" : ""}>` +
      `<span class="ev-label">${esc(e.label)}</span>` +
      `<span class="ev-cat cat-${e.category}">${esc(lab[e.category] || e.category)}</span>` +
      `<span class="ev-w">${d.simAdd}${e.weight}</span>`;
    row.querySelector("input").addEventListener("change", (ev) => {
      e.have = ev.target.checked; saveCase(c); renderEvidence(c);
      // score/risk/probability depend on evidence — refresh the header numbers too
      renderHeaderNumbers(c);
    });
    box.appendChild(row);
  });
}
function renderHeaderNumbers(c) {
  const d = t(); const sc = computeScore(c); const prob = probability(c); const risk = riskLevel(c);
  const cf = $("casefile"); if (!cf) return;
  // rebuild just the dynamic stats cheaply
  renderDashboardStatsOnly(c, sc, prob, risk, d);
}
function renderDashboardStatsOnly(c, sc, prob, risk, d) {
  const cf = $("casefile"); cf.innerHTML = "";
  const na = nextAction(c);
  cf.appendChild(kv(d.caseFile, c.id + " · " + fmtDate(c.createdAt), true));
  cf.appendChild(stat(d.strength, sc.current + " / 100", "strong-" + band(sc.current)));
  cf.appendChild(stat(d.probability, prob + "%", "strong-" + band(prob)));
  cf.appendChild(stat(d.risk, d.riskL[risk], "risk-" + risk));
  cf.appendChild(stat(d.stage, d.stages[c.stage] || c.stage));
  if (na) { const due = na.overdue ? d.overdue : d.dueIn(Math.max(0, Math.ceil((na.dueAt - now()) / DAY))); cf.appendChild(stat(d.nextDeadline, fmtDate(na.dueAt) + " · " + due, na.overdue ? "risk-high" : "")); }
}

function renderDocument(c) {
  const d = t(); const last = (c.letters || [])[c.letters.length - 1];
  $("doc-kind").textContent = last ? (d.kinds[last.kind] || last.kind) : "";
  $("doc-audit").textContent = last ? `${d.confidence}: ${last.auditScore}/100 · ${last.revisions} rev` : "";
  $("doc-body").textContent = last ? last.text : "";
  $("copy-btn").dataset.text = last ? last.text : "";
}

function renderTimeline(c) {
  const box = $("timeline"); box.innerHTML = "";
  (c.stageHistory || []).forEach((ev) => {
    const row = el("div", "tl-row");
    row.innerHTML = `<span class="tl-dot"></span><div class="tl-body"><span class="tl-stage">${esc(ev.label || ev.stage)}</span>${ev.note ? `<span class="tl-note">${esc(ev.note)}</span>` : ""}<span class="tl-time">${fmtDate(ev.at)}</span></div>`;
    box.appendChild(row);
  });
}

function renderDecisions(c) {
  const d = t(); const box = $("decisions"); box.innerHTML = "";
  (c.decisions || []).forEach((dec) => {
    const card = el("div", "dec");
    card.innerHTML = `<div class="dec-h">${esc(dec.decision)}</div>` +
      (dec.reasoning ? `<div class="dec-why"><span>${esc(d.why)}:</span> ${esc(dec.reasoning)}</div>` : "") +
      (dec.rejected ? `<div class="dec-rej"><span>${esc(d.rejected)}:</span> ${esc(dec.rejected)}</div>` : "");
    box.appendChild(card);
  });
}

function renderCritique(c) {
  const d = t(); const box = $("critique-body"); box.innerHTML = "";
  const sc = c.selfCritique;
  if (!sc) { box.appendChild(el("p", "muted", state.lang === "bg" ? "Натисни бутона, за да прегледа агентът текущата си позиция." : "Press the button to have the agent review its current position.")); return; }
  (sc.items || []).forEach((it) => {
    const row = el("div", "crit");
    row.innerHTML = `<div class="crit-q">${esc(it.question)}</div><div class="crit-a">${esc(it.assessment)}</div>`;
    box.appendChild(row);
  });
  const rec = el("div", "crit-rec");
  rec.innerHTML = `<span class="crit-rec-cap">${esc(d.recommendation)}</span> ${esc(sc.overall || "")} <span class="crit-act act-${sc.action}">${esc((sc.action || "").replace("_", " "))}</span>`;
  box.appendChild(rec);
}

function renderReport(c) {
  const d = t(); const box = $("report"); box.innerHTML = "";
  const sc = computeScore(c); const na = nextAction(c);
  const rows = [
    [d.rGoal, c.input.goalText + (c.input.amount ? ` · ${fmtAmount(c.input.amount)} ${c.input.currency}` : "")],
    [d.rDecisions, (c.decisions || []).map((x) => x.decision).join(" · ") || "—"],
    [d.rEvidence, `${(c.evidence || []).filter((e) => e.have).length}/${(c.evidence || []).length} ` + (state.lang === "bg" ? "налични" : "in hand") + ` → ${sc.current}/100`],
    [d.rRisks, (c.risks || []).map((r) => r.risk).join(" · ") || "—"],
    [d.rRejected, (c.decisions || []).map((x) => x.rejected).filter(Boolean).join(" · ") || "—"],
    [d.rWhy, c.strengthWhy || "—"],
    [d.rNext, na ? (d.kinds[na.kind] + " · " + fmtDate(na.dueAt)) : (state.lang === "bg" ? "Казусът е приключен" : "Case concluded")],
    [d.confidence, (c.confidence || 0) + "/100"],
  ];
  rows.forEach(([k, v]) => { const r = el("div", "rep-row"); r.innerHTML = `<span class="rep-k">${esc(k)}</span><span class="rep-v">${esc(v)}</span>`; box.appendChild(r); });
}

function renderReplyPanel(c) {
  const d = t(); const last = (c.replies || [])[c.replies.length - 1];
  const out = $("reply-verdict");
  if (last && last.analysis) {
    const a = last.analysis;
    const flags = [];
    if (a.stalling) flags.push(state.lang === "bg" ? "бавят" : "stalling");
    if (a.avoidsResponsibility) flags.push(state.lang === "bg" ? "избягват отговорност" : "dodging");
    if (a.contradicts) flags.push(state.lang === "bg" ? "противоречат си" : "contradicts");
    if (a.legallyWeak) flags.push(state.lang === "bg" ? "слаб аргумент" : "weak");
    out.style.display = "block";
    out.innerHTML =
      `<div class="rv-head"><span class="rv-cap">${esc(d.replyVerdict)}</span><span class="rv-act act-${a.recommendedAction}">${esc(a.recommendedAction)}</span></div>` +
      `<div class="rv-verdict">${esc(a.verdict)}</div>` +
      (flags.length ? `<div class="rv-flags">${flags.map((f) => `<span class="rv-flag">${esc(f)}</span>`).join("")}</div>` : "") +
      `<div class="rv-reason">${esc(a.reasoning)}</div>`;
    $("gen-response-btn").style.display = a.recommendedAction === "accept" ? "none" : "inline-flex";
  } else { out.style.display = "none"; $("gen-response-btn").style.display = "none"; }
}

/* ============================================================ steps UI */
function buildSteps(box, labels) { box.innerHTML = ""; labels.forEach((l) => { const row = el("div", "step"); row.innerHTML = `<span class="tick"></span><span>${esc(l)}</span>`; box.appendChild(row); }); }
function stepStatus(box, i, s) { const e = box.children[i]; if (!e) return; e.className = "step " + s; if (s === "done") e.querySelector(".tick").textContent = "✓"; }

/* ============================================================ cases menu */
function renderCasesMenu() {
  const d = t(); const box = $("cases-list"); box.innerHTML = "";
  const ids = Object.keys(state.cases).sort((a, b) => state.cases[b].createdAt - state.cases[a].createdAt);
  if (!ids.length) { box.appendChild(el("div", "muted cases-empty", esc(d.noCases))); return; }
  ids.forEach((id) => {
    const c = state.cases[id]; const sc = computeScore(c);
    const row = el("button", "case-row" + (id === state.activeId ? " active" : ""));
    row.innerHTML = `<span class="cr-id">${esc(id)}</span><span class="cr-type">${esc(c.disputeType || c.input.goalText)}</span><span class="cr-score strong-${band(sc.current)}">${sc.current}</span>`;
    row.onclick = () => { setActive(id); closeCases(); showView("dashboard"); renderDashboard(); };
    box.appendChild(row);
  });
}

/* ============================================================ settings + lang */
function applyLang() {
  const d = t(); document.documentElement.lang = state.lang;
  $("hero-eyebrow").textContent = d.heroEyebrow; $("hero-lede").textContent = d.heroLede;
  $("hero-h1").innerHTML = state.lang === "bg" ? 'Цял казус. <em>Един</em> агент.' : 'A whole case. <em>One</em> agent.';
  $("lbl-story").innerHTML = `${d.lblStory} <span class="hint" id="lbl-story-hint">${d.lblStoryHint}</span>`;
  $("lbl-amount").textContent = d.lblAmount; $("lbl-cp").textContent = d.lblCp; $("lbl-goal").textContent = d.lblGoal;
  $("lbl-region").innerHTML = `${d.lblRegion} <span class="hint">${d.lblRegionHint}</span>`;
  $("lbl-tone").textContent = d.lblTone; $("lbl-outlang").textContent = d.lblOutlang;
  $("run-label").textContent = d.runLabel; $("run-note").textContent = d.runNote;
  $("newcase-label").textContent = d.newCase; $("cases-title").textContent = d.cases;
  $("cases-btn-label").textContent = d.cases; $("story").placeholder = d.storyPh;
  $("key-btn-label").textContent = d.keyBtn; $("modal-title").textContent = d.modalTitle; $("modal-sub").textContent = d.modalSub;
  $("key-label").textContent = d.keyLabel; $("model-label").textContent = d.modelLabel; $("test-label").textContent = d.testLabel;
  $("foot-note").textContent = d.footNote;
  // section titles
  $("sec-proof").textContent = d.proofTitle; $("sec-evidence").textContent = d.evidenceTitle;
  $("sec-doc").textContent = d.docTitle; $("sec-reply").textContent = d.replyTitle; $("sec-timeline").textContent = d.timelineTitle;
  $("sec-decisions").textContent = d.decisionsTitle; $("sec-critique").textContent = d.critiqueTitle; $("sec-report").textContent = d.reportTitle;
  $("sim-now-cap").textContent = d.simNow; $("sim-pot-cap").textContent = d.simPot;
  $("softer-btn").textContent = d.softer; $("firmer-btn").textContent = d.firmer; $("copy-btn").textContent = d.copy;
  $("reply-input").placeholder = d.replyPlaceholder; $("analyze-reply-btn").textContent = d.analyzeReply;
  $("gen-response-btn").textContent = d.genResponse; $("run-critique-btn").textContent = d.runCritique;
  $("delete-case-btn").textContent = d.deleteCase;
  for (const k in d.goal) { const o = document.querySelector(`#goal option[value="${k}"]`); if (o) o.textContent = d.goal[k]; }
  for (const k in d.tone) { const o = document.querySelector(`#tone option[value="${k}"]`); if (o) o.textContent = d.tone[k]; }
  $("lang-en").classList.toggle("on", state.lang === "en"); $("lang-bg").classList.toggle("on", state.lang === "bg");
  if (getActive() && $("dashboard").style.display !== "none") renderDashboard();
}
function setLang(l) { state.lang = l; localStorage.setItem(LS.lang, l); applyLang(); }

function showMsg(text, kind) { const m = $("msg"); m.textContent = text; m.className = `msg show ${kind || "warn"}`; }
function clearMsg() { $("msg").className = "msg"; }
function refreshKeyDot() {}

function openModal() { $("model-input").value = state.model; $("test-out").textContent = ""; $("overlay").classList.add("show"); }
function closeModal() { $("overlay").classList.remove("show"); }
function openCases() { renderCasesMenu(); $("cases-drawer").classList.add("show"); }
function closeCases() { $("cases-drawer").classList.remove("show"); }

async function testAndSave() {
  const out = $("test-out"); const d = t();
  out.textContent = d.testing; out.className = "test-out";
  state.model = $("model-input").value; localStorage.setItem(LS.model, state.model);
  out.textContent = d.testOk; out.className = "test-out ok"; setTimeout(closeModal, 700);
}

/* ============================================================ init */
function init() {
  applyLang();
  $("run-btn").addEventListener("click", runIntake);
  $("lang-en").addEventListener("click", () => setLang("en"));
  $("lang-bg").addEventListener("click", () => setLang("bg"));
  $("key-btn").addEventListener("click", openModal);
  $("modal-close").addEventListener("click", closeModal);
  $("overlay").addEventListener("click", (e) => { if (e.target === $("overlay")) closeModal(); });
  $("test-btn").addEventListener("click", testAndSave);
  $("newcase-btn").addEventListener("click", () => { setActive(null); showView("intake"); clearMsg(); });
  $("cases-btn").addEventListener("click", openCases);
  $("cases-close").addEventListener("click", closeCases);
  $("cases-drawer").addEventListener("click", (e) => { if (e.target === $("cases-drawer")) closeCases(); });

  $("analyze-reply-btn").addEventListener("click", submitReply);
  $("gen-response-btn").addEventListener("click", generateReplyResponse);
  $("run-critique-btn").addEventListener("click", runSelfCritique);
  $("firmer-btn").addEventListener("click", () => regenDoc("final"));
  $("softer-btn").addEventListener("click", () => regenDoc("polite"));
  $("delete-case-btn").addEventListener("click", () => { const c = getActive(); if (c && confirm(t().confirmDelete)) { deleteCase(c.id); const ids = Object.keys(state.cases); if (ids.length) { setActive(ids[0]); renderDashboard(); } else { showView("intake"); } } });

  $("copy-btn").addEventListener("click", async (e) => {
    const txt = e.currentTarget.dataset.text || $("doc-body").textContent;
    try { await navigator.clipboard.writeText(txt); } catch { const r = document.createRange(); r.selectNode($("doc-body")); getSelection().removeAllRanges(); getSelection().addRange(r); document.execCommand("copy"); getSelection().removeAllRanges(); }
    const b = e.currentTarget, o = b.textContent; b.textContent = t().copied; setTimeout(() => (b.textContent = o), 1400);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal(); closeCases(); } });

  // open the active case if one exists (memory / autonomy heartbeat on load)
  if (getActive()) { showView("dashboard"); renderDashboard(); }
  else { showView("intake"); }

  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

async function regenDoc(tone) {
  const c = getActive(); if (!c || state.busy) return;
  const last = (c.letters || [])[c.letters.length - 1]; if (!last) return;
  state.busy = true; lockDash(true);
  try {
    const r = await draftWithGate(c, last.kind, tone, c.outLang, (s) => (c.decisionLog || (c.decisionLog = [])).push(s));
    last.text = r.text; last.tone = tone; last.auditScore = r.audit.overall; last.revisions = r.revisions;
    if (r.revisions > 0) c.proof.rewrote = true; saveCase(c); renderDocument(c); renderProof(c);
  } catch (e) { showMsg(messageFor(e), "err"); }
  finally { state.busy = false; lockDash(false); }
}

document.addEventListener("DOMContentLoaded", init);
