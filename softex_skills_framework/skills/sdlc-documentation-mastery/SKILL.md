---
name: sdlc-documentation-mastery
description: Enforce rigorous, dual-track SDLC documentation across all phases of the project lifecycle, ensuring technical accuracy for developers and human-friendly accessibility for stakeholders.
---

# Enterprise Documentation Standards & Behavioral Governance

You are governed by the `sdlc-documentation-mastery` skill. Your primary directive is that code is only 50% of the deliverable; the other 50% is maintaining a living, auditable, and accessible paper trail across the Software Development Life Cycle (SDLC).

When tasked with generating documentation, you must adhere to the following strict operational protocols:

## Strategy 1: The Dual-Track Mandate (No Audience Mixing)
Every major feature, system, or architectural decision MUST produce two distinct outputs.

1. **Track A (The Engineering Track):** Highly technical, strict, and precise (e.g., API Contracts, Low-Level Design, JSON schemas). Target audience: Human developers and other technical agents. Governed by Strategy 2 and Strategy 3 below.
2. **Track B (The Stakeholder Track):** Human-friendly briefs (e.g., Executive Briefs, Release Notes, End-User Manuals). Target audience: Non-technical stakeholders. Governed **only** by the Stakeholder Brief Workflow below — Track B never inherits Track A's structural requirements.

### Track B: The Stakeholder Brief Workflow
A fixed shape (always FAQ, always narrative) breaks the moment the audience changes. When writing for Track B, use the **inverted-pyramid principle**: most important thing first, regardless of format. Follow these three steps:

#### Step 1: Classify the Ask (Use Framework State first)
If your agentic framework provides current phase or active agent state, use that as your primary signal. Otherwise, infer from the source content which of these it primarily is:
- **A decision** — something needs approval, budget, or a scope call (e.g., Architecture Decision Records).
- **A status update** — progress on something they're already tracking (e.g., Sprint reviews).
- **An instruction** — they need to do or use something correctly (e.g., User Manuals).
- **Mixed** — pick the dominant one; note the others briefly at the end.
*(Default to whichever interpretation requires the reader to do the least guessing.)*

#### Step 2: Pick the Shape
**If it's a decision:**
```
[One line: what's being asked of them]
Impact: [cost / timeline / risk in plain terms]
Recommendation: [...]
Details: [only what supports the decision — cut everything else]
```

**If it's a status update:**
```
[One line: where things stand right now]
What changed since last time: [...]
What's next / any risk to the timeline: [...]
```

**If it's an instruction/how-to:**
```
[One line: what they can now do]
Steps, numbered, only the ones they perform (not backend steps)
What to do if something goes wrong: [...]
```

**Writing Rules (apply regardless of shape):**
- No acronym unexplained on first use — or drop it if it doesn't matter to this reader.
- One analogy max, and only if plain language genuinely falls short — immediately follow it with the one-sentence literal statement of what actually happens.
- Length matches importance to *this* reader, not the length of the source.
- Never invent a timeline, cost, or specific the source doesn't state — say "not yet specified."
- Cut anything the reader can't act on: version history, internal process detail, schemas, code, and (per the Final Output Contract below) diagrams, unless one is genuinely essential to understanding.

#### Step 3: The Comprehension Self-Test (Quality Gate)
Before saving the document to disk, answer these questions using *only the brief you just wrote*, as the target reader, with no other context:
1. What is this telling me?
2. Why does it matter to me / what's the impact?
3. Is there anything I need to do, and by when?
If any answer requires info not in the brief, the brief isn't done — fix the structure, not the wording.

## Strategy 2: Built-in Internal Version Control (Track A only)
This strategy applies to **Track A engineering documents only**. Track B stakeholder briefs never carry a Document Control table — audit history lives in the paired Track A document.

Every Track A markdown file you generate or modify MUST begin with a standardized **Document Control / Version History** table immediately below the main title.
When updating an existing document, use your file reading/search tools to read the current history table, and append a new row to the bottom. DO NOT overwrite existing history.

**Required Table Format:**
| Version | Date | Author (Agent ID) | Description of Changes | Status |
| :--- | :--- | :--- | :--- | :--- |
| v1.0 | YYYY-MM-DD | e.g., `prd_writer` | Initial draft / Specific change summary. | Draft/Approved |

## Strategy 3: Dynamic Generation via ISO & IEEE Standards (Track A only)
This strategy applies to **Track A engineering documents only**. Track B briefs are never restructured into ISO sections.
For Track A deliverables, structure according to globally recognized software engineering standards:
- **For Requirements:** Adhere to **ISO/IEC/IEEE 29148** (Requirements Engineering).
- **For Architecture:** Adhere to **ISO/IEC/IEEE 42010** (Architecture Descriptions).
- **For Testing:** Adhere to **ISO/IEC/IEEE 29119** (Software Testing).

## Strategy 4: Requirements Traceability
No code or low-level design exists in a vacuum. If you are generating technical specs or code-level documentation, you must explicitly reference the originating Requirement ID (e.g., `REQ-001`) from the Business Requirements Document. 
**Anti-Hallucination Rule:** Do NOT invent or hallucinate Requirement IDs. If the source documents do not contain explicit IDs, you must explicitly state: "No Traceability IDs provided in source requirements."

## Strategy 5: Safe Tool Utilization & Context Management
To generate accurate, living documentation, you must actively utilize your provided execution and search tools, but you must do so safely to avoid context window flooding:
- **Discovery & Auditing:** Use your file search/grep tools to map out API routes or read existing documents. **WARNING:** You must explicitly exclude `node_modules`, `dist`, `build`, or `.git` directories from your searches to prevent massive output dumps that will crash your context.
- **Validation:** If documenting tests, use your terminal/bash tools to run the test suite (e.g., `pytest`, `npm test`) and capture the exact outputs rather than guessing results.
- **Execution & State Collisions:** Use your file writing tools exclusively to save finalized deliverables. To prevent overwriting other agents' work, always use explicit namespaced subdirectories (e.g., `docs/02_requirements/brd.md`). Never dump large markdown structures directly into the chat stream *unless* requesting an audit (see Strategy 6).

## Strategy 6: Peer Review & Consensus Gate
No agent operates in a vacuum. You are explicitly forbidden from unilaterally writing a first draft of a major document directly to disk without swarm consensus.
1. **Request Audit:** When you finish drafting a document, you must output a summary or the proposed draft to the orchestrator/chat stream and explicitly request a peer review from the concerned team members or human reviewers.
2. **Iterate:** Incorporate their feedback.
3. **Commit:** Only after receiving explicit approval from the reviewing party should you invoke your file-writing tools to commit the final document to disk.

## Final Output Contract
- **Format:** Markdown ONLY.
- **Diagrams (Track A):** Mermaid.js ONLY, placed within markdown code blocks. **Syntax Warning:** properly quote labels containing special characters (e.g., `id["Label (Extra Info)"]`).
- **Diagrams (Track B):** Omit by default. Include a simplified visual only if it is genuinely essential to comprehension — apply the same restraint as the "one analogy max" rule. Never include a raw C4/Mermaid architecture diagram in a stakeholder brief.
- **Self-Correction:** Before finalizing, first confirm which track this document belongs to, then check only against that track's rules:
  - **Track A:** Document Control table present and appended (not overwritten), ISO structure followed, REQ- IDs traceable, Mermaid labels quoted.
  - **Track B:** No Document Control table, no ISO section headers, shape matches the Step 1 classification, passes the Step 3 comprehension self-test.
  - Do not apply Track A structural requirements to a Track B brief, or vice versa. If either check fails, fix it before writing to file.
