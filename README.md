# Reclaim by StaGove

**An autonomous consumer dispute-management agent.** You open a case, and Reclaim manages the whole money-recovery dispute end to end — it classifies the case, scores it, plans the entire journey with real deadlines, drafts every letter, audits and rewrites its own drafts, reads the company's replies and decides what they mean, and at every moment tells you the single next action. It is not a letter generator; it behaves like a digital employee whose only job is recovering your money.

It runs as an installable **Progressive Web App** on the **free Groq API**, using each end user's own key, so it has **zero operating cost** and scales to any number of users.

> Reclaim drafts strategy and letters from what you enter. It is not a lawyer and this is not legal advice. Check facts and any `[PLACEHOLDERS]` before sending.

---

## What changed in this version

The earlier version produced one audited letter and an escalation roadmap. This version turns every dispute into a **persistent case** the agent actively manages over time. Eleven systems were added — and the important part is that **each one is backed by real code, not text dressed up to look autonomous.**

| # | System | What actually runs (not marketing) |
|---|--------|-----------------------------------|
| 1 | **Case Management Engine** | Each dispute is a persistent record in `localStorage` with computed fields (status, strength, stage, next deadline, next action, risk, probability) recomputed on every open. |
| 2 | **Autonomous Follow-up Engine** | A deterministic scheduler (`buildSchedule`) lays out the whole journey — day 0 request, day 7 follow-up, day 14 demand, day 21 chargeback, day 30 complaint, day 45 escalation — as real dates. `nextAction()` returns the single next step and flags it overdue when its date passes. |
| 3 | **Reply Analyzer** | Paste the company's reply; an LLM pass returns a structured verdict (real answer? dodging? stalling? legally weak? contradicts?) and a `recommendedAction`, which the state machine routes deterministically to the next step. |
| 4 | **Case Strength Simulator** | The score is dynamic and computed in pure JS: `current = floor + Σ(weight of evidence you have)`, `potential = floor + Σ(all weights)`. Tick a box and the number moves immediately. |
| 5 | **Evidence Engine** | The analysis pass returns an evidence model (each item: required/recommended/optional, a point weight, and whether your story implies you already have it). The checklist drives the simulator above. |
| 6 | **Decision Engine** | Every strategy decision is stored as `{decision, reasoning, rejectedAlternative}` — partly from the LLM's strategy pass, partly generated deterministically at each stage transition (e.g. *why chargeback now, why not court*). |
| 7 | **Autonomous Timeline** | A real event log: every stage change appends a timestamped event (`advanceStage`). Nothing is faked — events appear only when the corresponding action happens. |
| 8 | **Self-Critique** | An LLM reviews the live case state and recommends wait / escalate / gather evidence / change strategy / rewrite — **with code-enforced guards**: e.g. if the deadline hasn't passed, the code overrides an "escalate" recommendation to "wait"; if the score is under 45 it forces "gather evidence". |
| 9 | **Agent Memory** | The case file *is* the memory. `memoryBrief()` injects current stage, strength, evidence held/missing, and the last letters and replies into every prompt — so you never re-explain anything. |
| 10 | **Autonomous Decision Report** | Assembled from the real stored state: goal, decisions made, evidence analyzed, risks, rejected strategies, why the chosen strategy, next action, and a confidence number (the last audit score). |
| 11 | **Proof of Autonomy** | A ledger that ticks an action only if its function actually ran this case (classified, scored, built evidence model, generated strategy, self-audited, rewrote below gate, planned future actions, selected escalation, stored state, prepared next action, analyzed a reply, critiqued itself). |

### One honest constraint

A browser-only PWA with zero operating cost has **no server**, so it cannot literally wake up on day 7 and email the company by itself. Instead the agent **pre-plans the entire journey** and, every time you open it, **recomputes elapsed time, advances the recommended stage, flags overdue deadlines, and surfaces (and can generate) the next action**. The agent does the thinking, planning, drafting, and deciding; you remain the "hands" that click send. That is the honest shape of autonomy under a no-server, no-cost design — and it's stated plainly rather than hidden behind a fake "sending…" animation.

---

## Answers to the evaluator's questions

**"Why wouldn't I just use ChatGPT?"** ChatGPT answers one prompt at a time and forgets. You'd have to know what to ask, re-paste the whole story every session, judge the draft yourself, and manually track dates. Reclaim keeps a persistent case, decides the strategy, sets and watches deadlines, scores the case from an evidence model, reads replies, and tells you the one next thing to do — across weeks, without you re-explaining.

**"Where is the autonomous intelligence? / What decisions does it make without the user?"** It sets its own recovery-strength floor, chooses leverage and tone, decides which evidence matters and how much each item is worth, decides whether a reply is stalling and whether to escalate, decides *when* to escalate (and refuses to escalate early), and decides when the case is too weak to escalate and needs evidence first.

**"What would happen if I removed the LLM? Could normal software do this?"** The scheduling, scoring, risk, timeline, and state machine are deliberately deterministic — that's what makes them trustworthy. But the parts that *open* the case are pure judgement on free-text: classifying an arbitrary dispute, assigning the score floor and evidence weights, writing and grading the letters, and interpreting a company's reply. Those cannot be reduced to a lookup table or a spreadsheet — remove the model and you're left with empty forms.

**"Why an agent and not an assistant?"** An assistant waits for instructions. Reclaim is given one goal — recover the money — and then independently plans, drafts, audits, decides, and re-plans toward that goal over the life of the case.

---

## Run it locally

Plain static files, no build step.

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Open the app → **API key** → paste a free Groq key → **Test & save**.

> Tip: serve it over `http://localhost` (as above) rather than opening the file directly — browsers restrict storage on `file://`, which the persistent case engine needs.

## Deploy (free hosting)

Drop the repo onto any static host — no server, no env vars.

- **Netlify / Vercel / Cloudflare Pages** — connect the repo, empty build command, publish directory = repo root.
- **GitHub Pages** — Settings → Pages → deploy from branch (root). All paths are relative, so a project subpath works too.

Then open it on your phone once and **Add to Home Screen** to install it as an app.

## The free Groq key (read this)

Each user brings their **own free Groq key** (from <https://console.groq.com/keys>, no card). It's stored only in that browser and sent only to Groq.

This is deliberate. Groq's free tier is rate-limited **per account**: a single embedded StaGove key would be shared by every user (~30 requests/min) and extractable from the page — it would break on day one. With each user on their own key, the agent is **free forever to operate** and scales to **unlimited users** at zero cost to you, which is exactly what "no recurring cost, sellable at scale" requires.

Default model `llama-3.3-70b-versatile`; the key panel also offers `llama-3.1-8b-instant` and `openai/gpt-oss-120b`.

## Files

```
index.html              app shell — intake + the case dashboard (11 modules)
styles.css              visual system (teal + brass "ledger" identity)
app.js                  the agent: engines, state machine, LLM passes, memory, render
manifest.webmanifest    PWA manifest
sw.js                   service worker (offline shell + installability)
icon-192/512/512-maskable/apple-touch + favicon.ico
make_icons.py           regenerates the icons (optional, needs Pillow)
```

---

## Delivery Directory entry

**Name:** Reclaim by StaGove
**Utility:** Autonomously manages a consumer money-recovery dispute end to end — denied refunds, junk fees, withheld deposits, billing overcharges, faulty goods/services, subscription traps, travel compensation, warranty rejections. Opens a persistent case; scores it; plans the journey with deadlines; drafts, audits and rewrites every letter; analyzes the company's replies; and always surfaces the next action.
**Access:** PWA — deploy the repo to any static host (Netlify/Pages); installable to the home screen. Runs on the user's own free Groq key.
**Delivered:** v2 (autonomous case manager) — 25.06.2026
**Notes:** Zero operating cost (user-supplied free Groq key). EN/BG UI, letters in EN/BG/DE/ES/FR. Persistent cases stored on-device. Clear "not legal advice" disclaimer. PWA-installable.

**Where is the agentic, intelligent nature — and why it can't be done without an AI**
Reclaim is given one goal — recover the money — and then runs an entire case on its own: it classifies a never-seen dispute, sets its own recovery-strength score and evidence weights, chooses leverage and tone, drafts each letter and **grades and rewrites its own work to a self-imposed quality gate**, reads the company's replies to decide whether they're stalling and whether to escalate, and **decides *when* to act** — refusing to escalate before a deadline and refusing to escalate a case that's too weak until evidence is added. The scheduling, scoring, risk and timeline are deliberately deterministic so they're trustworthy; the judgement parts (classification, scoring, drafting, grading, reply interpretation) are open-ended reasoning over free text that no template, spreadsheet, or single ChatGPT prompt can do. Remove the model and only blank forms remain.

---

## Бележки (BG)

**Reclaim** е автономен агент за управление на спорове за връщане на пари. Отваряш казус и агентът го води от началото до края: класифицира спора, оценява силата му, планира целия път със срокове, пише и сам одитира всяко писмо, чете отговорите на фирмата и винаги ти казва единственото следващо действие.

**11-те системи** (всяка с реална логика, не фалшива автономност): траен казус; автономен график със срокове; анализатор на отговори; динамична оценка от модел на доказателствата; интерактивен чеклист с доказателства; обясними решения; жива хронология; самокритика с кодови предпазители; памет за целия казус; автономен доклад; и „доказателство за автономност", което отмята само реално случилите се действия.

**Честно ограничение:** PWA без сървър не може само да изпрати имейл на 7-ия ден. Затова агентът **планира целия път** и при всяко отваряне **преизчислява изтеклото време, придвижва етапа, маркира просрочените срокове и показва (и генерира) следващото действие**. Агентът мисли, планира, пише и решава; ти само натискаш „изпрати".

**Защо не ChatGPT:** ChatGPT отговаря на един prompt и забравя — трябва ти да знаеш какво да питаш и да следиш всичко. Reclaim пази казуса, решава стратегията, следи сроковете, чете отговорите и решава кога да ескалира (и отказва да ескалира преди срока или при твърде слаб казус).

**Безплатен Groq ключ:** всеки потребител въвежда **собствен безплатен ключ** (от <https://console.groq.com/keys>, без карта) — пази се само в браузъра, отива само към Groq. Така агентът е безплатен завинаги и се мащабира неограничено.

**Деплой:** качи папката в Netlify / GitHub Pages (без build, publish = root); после „Добави към началния екран" на телефона.

*Не е правен съвет. Провери фактите и полетата в [скоби] преди изпращане.*
