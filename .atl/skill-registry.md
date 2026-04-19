# Skill Registry

**Delegator use only.** Any agent that launches sub-agents reads this registry to resolve compact rules, then injects them directly into sub-agent prompts. Sub-agents do NOT read this registry or individual SKILL.md files.

See `_shared/skill-resolver.md` for the full resolution protocol.

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| When creating a pull request, opening a PR, or preparing changes for review. | branch-pr | /Users/yoryiabreu/.claude/skills/branch-pr/SKILL.md |
| When writing Go tests, using teatest, or adding test coverage. | go-testing | /Users/yoryiabreu/.claude/skills/go-testing/SKILL.md |
| Generate/edit raster images; avoid for vector/code-native asset tasks. | imagegen | /Users/yoryiabreu/.codex/skills/.system/imagegen/SKILL.md |
| When creating a GitHub issue, reporting a bug, or requesting a feature. | issue-creation | /Users/yoryiabreu/.claude/skills/issue-creation/SKILL.md |
| When user requests adversarial dual review (“judgment day”, “dual review”, etc.). | judgment-day | /Users/yoryiabreu/.claude/skills/judgment-day/SKILL.md |
| When user asks OpenAI API/product usage and needs official up-to-date docs. | openai-docs | /Users/yoryiabreu/.codex/skills/.system/openai-docs/SKILL.md |
| When scaffolding Codex plugins and marketplace entries. | plugin-creator | /Users/yoryiabreu/.codex/skills/.system/plugin-creator/SKILL.md |
| When creating new AI skills or documenting reusable agent patterns. | skill-creator | /Users/yoryiabreu/.claude/skills/skill-creator/SKILL.md |
| When listing or installing Codex skills from curated/GitHub sources. | skill-installer | /Users/yoryiabreu/.codex/skills/.system/skill-installer/SKILL.md |

## Compact Rules

Pre-digested rules per skill. Delegators copy matching blocks into sub-agent prompts as `## Project Standards (auto-resolved)`.

### branch-pr
- Every PR MUST link an approved issue (`status:approved`) before merge.
- Every PR MUST have exactly one `type:*` label.
- Branch name MUST match `type/description` lowercase regex.
- Use conventional commits only (`feat|fix|chore|docs|...`).
- Run shellcheck on modified scripts before pushing.
- Use PR template and include `Closes/Fixes/Resolves #N`.
- Do not include Co-Authored-By trailers.

### go-testing
- Prefer table-driven tests for multi-case behavior.
- Use `t.Run` with descriptive test-case names.
- Test success and failure paths explicitly.
- For Bubbletea state changes, test `Model.Update()` directly.
- For end-to-end TUI flows, use `teatest.NewTestModel`.
- Use golden files for stable visual/text output assertions.
- Use `t.TempDir()` for filesystem tests and isolate side effects.

### imagegen
- Default to built-in `image_gen` tool; CLI fallback only if user explicitly asks.
- Do not auto-switch to CLI; explain fallback requirements first.
- For built-in edits of local files, load image via `view_image` first.
- Keep edits non-destructive; preserve invariants explicitly.
- Move/copy final project assets from `$CODEX_HOME/generated_images/...` into workspace.
- Do not overwrite existing assets unless user explicitly requests replacement.
- Prefer raster generation only when task is truly bitmap-oriented (not SVG/code-native).

### issue-creation
- Use issue templates; blank issues are disabled.
- New issues start with `status:needs-review`; PRs wait for `status:approved`.
- Bugs -> bug template; features -> feature template; questions -> Discussions.
- Require duplicate check before creating a new issue.
- Ensure required fields are complete and reproducible.
- Keep issue title in conventional style (`fix(scope): ...`, `feat(scope): ...`).

### judgment-day
- Run two blind judges in parallel (never sequential single-review shortcut).
- Inject same project standards into both judge prompts.
- Synthesize findings into confirmed/suspect/contradiction buckets.
- Fix confirmed CRITICAL and real WARNING findings first.
- Re-judge after fixes; escalate to user after two unresolved iterations.
- Classify warnings as real vs theoretical; theoretical does not block.
- Orchestrator coordinates only; do not mix coordinator with executor responsibilities.

### openai-docs
- Use OpenAI docs MCP tools first for OpenAI-related questions.
- Use official docs as source of truth; avoid speculative guidance.
- Restrict fallback browsing to official OpenAI domains only.
- Validate model recommendations against current docs before answering.
- Keep quotes short; prefer cited paraphrases.
- If docs conflict, call out the difference and cite both sources.
- If docs do not cover the need, state the gap and propose next steps.

### plugin-creator
- Always create/keep `.codex-plugin/plugin.json` in plugin root.
- Normalize plugin name to lowercase hyphen-case; folder and manifest name must match.
- Keep placeholder manifest values until explicitly filled by user.
- For marketplace entries, always set `policy.installation`, `policy.authentication`, and `category`.
- Keep marketplace `source.path` as `./plugins/<plugin-name>` (repo-local).
- Use `--force` only for intentional overwrite/update flows.
- Preserve existing marketplace `interface.displayName` when updating.

### skill-creator
- Create skills only for reusable non-trivial patterns, not one-off tasks.
- Follow required SKILL frontmatter (`name`, `description`, `license`, `metadata`).
- Keep instructions actionable; prioritize critical rules first.
- Prefer local references/templates over duplicated long documentation.
- Use naming conventions (`technology`, `action-target`, or project-specific forms).
- Keep examples minimal and commands copy-paste ready.
- Register new skills in project instructions/index when applicable.

### skill-installer
- Use helper scripts instead of ad-hoc installers.
- Request escalated permissions for listing/install scripts (network required).
- List skills first when user request is ambiguous.
- Install curated skills by name; install external skills by repo/path or URL.
- Abort if destination skill already exists (unless user wants overwrite flow).
- Explain if `.system` skills are already preinstalled.
- After install, instruct user to restart Codex to load new skills.

## Project Conventions

| File | Path | Notes |
|------|------|-------|
| AGENT.md | /Users/yoryiabreu/proyectos/buildingos/AGENT.md | Index-style global constitution; references paths below. |
| AGENTS.md | /Users/yoryiabreu/proyectos/buildingos/AGENTS.md | TypeScript/Nest/React/API/testing/security/DB/commit standards. |
| product_decision/ | /Users/yoryiabreu/proyectos/buildingos/product_decision/ | Referenced by AGENT.md (currently missing in workspace). |
| frontend/AGENT.md | /Users/yoryiabreu/proyectos/buildingos/frontend/AGENT.md | Referenced by AGENT.md (currently missing in workspace). |
| api/AGENT.md | /Users/yoryiabreu/proyectos/buildingos/api/AGENT.md | Referenced by AGENT.md (currently missing in workspace). |
| infra/AGENT.md | /Users/yoryiabreu/proyectos/buildingos/infra/AGENT.md | Referenced by AGENT.md (present). |

Read the convention files listed above for project-specific patterns and rules.
