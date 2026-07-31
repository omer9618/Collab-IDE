---
name: general-business-documentation
description: Enforces clarity, actionability, and governance for all general business operations documents within a software house (e.g., meeting minutes, HR policies, vendor agreements, proposals, and compliance reports).
---

# General Business Documentation Standards

You are governed by the `general-business-documentation` skill. Your primary directive is to ensure that every non-engineering business document produced by this software house is immediately actionable, strictly formatted, and free of corporate fluff.

When tasked with generating general business documentation, you must adhere to the following protocols:

## Strategy 1: The BLUF Principle (Bottom Line Up Front)
Every business document must respect the reader's time. You must place the most critical information—the decision, the cost, the required action, or the primary policy change—in the very first paragraph. Never bury the lead.

## Strategy 2: Intent Classification & Document Shaping
Before writing, classify the intent of the document and apply the corresponding structural shape:

### 1. Actionable (e.g., Meeting Minutes, Project Proposals, OKRs)
*Goal: Drive immediate next steps.*
**Shape:**
- **Executive Summary / BLUF:** One paragraph.
- **Decisions Made:** Bulleted list of explicit agreements.
- **Action Items (The 3 Ws):** A table mapping `Who` is doing `What` by `When`.
- **Discussion / Context:** Supporting details placed at the bottom.

### 2. Informational & Governance (e.g., HR Policies, Compliance Reports, Handbooks)
*Goal: Provide unambiguous rules or updates.*
**Shape:**
- **Policy Statement / BLUF:** What is the rule or update?
- **Scope & Applicability:** Exactly who does this apply to?
- **Procedures / Details:** Numbered steps or explicit constraints.
- **Exceptions / Escalations:** What to do if the rule doesn't fit, and who to contact.

### 3. Persuasive (e.g., Client Proposals, Vendor Agreements, Pitch Decks)
*Goal: Secure buy-in or budget.*
**Shape:**
- **The Problem:** The pain point being solved.
- **The Value Proposition / Solution:** How we solve it, stated plainly.
- **Impact / ROI:** Cost, timelines, and measurable outcomes.
- **Next Steps:** Explicit call to action to move forward.

## Strategy 3: The "No Fluff" Mandate (UX Writing for Business)
Business documents fail when they are buried in jargon. You must enforce the following writing constraints:
- **Zero Corporate Speak:** Eradicate empty buzzwords (e.g., "synergize", "leverage", "paradigm shift"). Use plain, literal verbs.
- **Formatting Over Paragraphs:** Use bullet points, bold text for emphasis, and tables wherever possible to facilitate skimming. 
- **Sentence Length:** Keep average sentence length under 20 words. Use active voice exclusively (e.g., "The manager will approve the budget," NOT "The budget will be approved by the manager").

## Strategy 4: Document Governance & Classification
Even non-technical documents require strict tracking to prevent compliance failures or data leaks. Every document MUST begin with a standardized Metadata block.

**Required Header Format:**
```markdown
**Document Title:** [Title]
**Date:** YYYY-MM-DD
**Author:** [Agent ID or Human Name]
**Classification:** [PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED]
```
*(If the document contains financial data, legal terms, or PII, it must be marked `CONFIDENTIAL` or `RESTRICTED`).*

## Strategy 5: Peer Review & Consensus Gate
You are explicitly forbidden from unilaterally writing a first draft of a major business document (e.g., a formal policy or client proposal) directly to disk without consensus.
1. **Request Audit:** Output the draft to the chat stream/framework and explicitly request a peer review from the concerned stakeholder (e.g., `chief-finance`, `chief-ops`, `hr-manager`, or a human).
2. **Iterate:** Incorporate their feedback.
3. **Commit:** Only after receiving explicit approval should you invoke your file-writing tools to commit the final document to disk.

## Final Output Contract
- **Format:** Markdown ONLY.
- **Self-Correction (The 30-Second Skim Test):** Before finalizing the file, read your own text. If a busy executive skims this document for 30 seconds, will they know exactly what the document is about and what they are supposed to do? If the answer is no, rewrite it using shorter sentences and move the BLUF higher.
