---
name: project-management
description: Execute comprehensive project planning, tracking, and delivery using proven methodologies (Agile, Waterfall, Hybrid) to ensure on-time, on-budget delivery while maintaining quality and stakeholder satisfaction.
---

# Project Management Skill

> Reusable workflow extracted from davide-project-manager expertise.

## Purpose
Execute comprehensive project planning, tracking, and delivery using proven methodologies (Agile, Waterfall, Hybrid) to ensure on-time, on-budget delivery while maintaining quality and stakeholder satisfaction.

## When to Use
- New project initiation and planning
- Sprint planning for Agile teams
- Waterfall project execution
- Risk management and mitigation
- Stakeholder communication and reporting
- Resource allocation and optimization
- Budget management and cost control
- Project status assessment
- Project closure and retrospectives

## Workflow Steps

1. **Project Initiation**
   - Define project objectives and success criteria
   - Identify key stakeholders and their roles
   - Establish project scope and boundaries
   - Document constraints (time, budget, resources)
   - Obtain project charter approval
   - Set up project infrastructure (tools, repositories)

2. **Work Breakdown Structure (WBS)**
   - Decompose project into phases and deliverables
   - Break deliverables into tasks and subtasks
   - Identify dependencies between tasks
   - Estimate effort for each task (hours/days)
   - Assign task owners and backup resources
   - Define acceptance criteria for each deliverable

3. **Schedule Development**
   - Create project timeline with milestones
   - Identify critical path using CPM
   - Build Gantt chart with dependencies
   - Calculate float/slack time
   - Define sprint cadence (if Agile)
   - Set milestone dates and review points

4. **Resource Planning**
   - Identify required skills and roles
   - Allocate team members to tasks
   - Calculate resource utilization (avoid >80%)
   - Plan for peak resource needs
   - Identify skill gaps and training needs
   - Arrange for external resources if needed

5. **Risk Management**
   - Identify potential risks (technical, schedule, resource, external)
   - Assess likelihood and impact for each risk
   - Calculate risk scores (Likelihood × Impact)
   - Develop mitigation strategies
   - Assign risk owners
   - Create contingency plans
   - Monitor risk triggers

6. **Budget Management**
   - Estimate project costs (labor, tools, infrastructure)
   - Create detailed budget breakdown
   - Establish cost baseline
   - Track actual vs planned spending
   - Forecast final costs regularly
   - Manage change requests with budget impact

7. **Execution & Monitoring**
   - Conduct daily standups (Agile) or weekly status meetings
   - Track task completion and update progress
   - Monitor schedule adherence (earned value analysis)
   - Review and approve deliverables
   - Manage scope changes through change control
   - Remove blockers and impediments
   - Facilitate team collaboration

8. **Stakeholder Communication**
   - Create communication plan (who, what, when, how)
   - Send regular status reports (weekly/bi-weekly)
   - Conduct stakeholder review meetings
   - Escalate issues and risks appropriately
   - Manage expectations proactively
   - Celebrate milestones and wins

9. **Quality Management**
   - Define quality standards and acceptance criteria
   - Implement quality gates at milestones
   - Conduct code reviews and testing
   - Track defects and resolution rates
   - Ensure documentation completeness
   - Validate deliverables against requirements

10. **Project Closure**
    - Verify all deliverables completed and accepted
    - Conduct project retrospective (lessons learned)
    - Document successes and improvement areas
    - Release resources and close contracts
    - Archive project documentation
    - Celebrate team success
    - Create project closure report

## Inputs Required
- **Project requirements**: Goals, scope, success criteria
- **Stakeholders**: Sponsor, product owner, team members, customers
- **Constraints**: Budget, timeline, resource availability
- **Methodology**: Agile, Waterfall, or Hybrid approach
- **Tools**: Project management software (Jira, Trello, MS Project)

## Outputs Produced
- **Project Charter**: Objectives, scope, stakeholders, success criteria
- **Project Plan**: WBS, schedule, budget, resource allocation
- **Risk Register**: Risks with likelihood, impact, mitigation strategies
- **Status Reports**: Weekly/bi-weekly progress updates
- **Gantt Chart**: Visual timeline with dependencies and milestones
- **Budget Tracking**: Actual vs planned spending, forecast
- **Retrospective Report**: Lessons learned, improvements for next project

## Sprint Planning Template (Agile)

```markdown
# Sprint {N} Planning - {Date Range}

## Sprint Goal
[One-sentence goal for this sprint]

## Capacity
- Team size: {count} developers
- Sprint duration: {weeks} weeks
- Available capacity: {hours} hours
- Planned capacity: {hours} hours (80% of available)

## Stories Selected
| Story ID | Title | Story Points | Assignee | Dependencies |
|----------|-------|--------------|----------|--------------|
| US-123   | ...   | 5            | Alice    | None         |
| US-124   | ...   | 3            | Bob      | US-123       |

```
