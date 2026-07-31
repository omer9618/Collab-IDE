# Softex Behavioral Governance Framework

This repository contains a suite of **Behavioral Governance Skills** designed to elevate autonomous LLM swarms from basic code-generators into compliant, enterprise-grade engineering departments.

## 🧠 Philosophy
Most AI prompts focus on "how to write code." This framework focuses on **Behavioral Governance**. It teaches agents that writing code is only 50% of the job. The other 50% is maintaining auditable paper trails, passing quality gates, and translating technical details into human-friendly business value.

## 🛠️ The Skills

### 1. `sdlc-documentation-mastery`
* **Purpose:** The core rulebook for software documentation.
* **Key Mechanics:** Enforces the "Dual-Track" output (separating Engineering architecture from Stakeholder briefs), dictates dynamic ISO/IEEE structures, and mandates explicit Requirement Traceability (RTM).

### 2. `softex-documentation-mastery`
* **Purpose:** A tightly coupled variant of the SDLC skill optimized specifically for the Softex multi-agent orchestrator.
* **Key Mechanics:** Dictates exactly how the agent must use `execute_bash_tool` and `write_to_file_tool`, and implements a strict "Halt on Ambiguity" protocol for autonomous agent chains.

### 3. `general-business-documentation`
* **Purpose:** Governance for non-engineering operations (HR policies, vendor agreements, meeting minutes).
* **Key Mechanics:** Enforces the BLUF (Bottom Line Up Front) principle, specific document shapes (Actionable vs. Persuasive), and a strict "No Fluff" UX writing mandate.

### 4. `external-audit-mastery`
* **Purpose:** Turns the swarm into a forensic audit team for reviewing legacy or third-party code.
* **Key Mechanics:** Implements a "Do No Harm" discovery phase, maps vulnerabilities across a 4-Pillar framework, and outputs a visual `Architecture_Snapshot.md` using Mermaid C4 models.

## 🚀 How to Use (Portability)
These skills are portable to any agentic framework that supports prompt injection (e.g., Cursor, AutoGPT, Claude, or custom LangGraph systems).

Simply inject the contents of the respective `SKILL.md` file into the System Prompt of the designated agent (e.g., inject `general-business-documentation` into your `chief-finance` agent). 

The agents will immediately begin self-correcting, classifying their audiences, and enforcing peer-review consensus gates before writing to disk.
