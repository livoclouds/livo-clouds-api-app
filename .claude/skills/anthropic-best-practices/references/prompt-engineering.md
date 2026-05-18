# Prompt Engineering — Best Practices

Distilled from `docs.anthropic.com/en/docs/build-with-claude/prompt-engineering`. Applicable when writing system prompts, agent prompts, or instructions that Claude will follow.

## Core Principles (in priority order)

### 1. Be clear and direct

- State what you want explicitly. "Output JSON" beats "format your response nicely".
- If you want a specific shape, **show** the shape (template/example) rather than describing it.
- Use imperative voice for instructions: "Extract the names" not "Could you maybe extract names?"

### 2. Give examples (few-shot)

- One concrete example beats three paragraphs of description.
- For structured tasks (classification, extraction, formatting), include 2-5 representative examples.
- Cover the **edge cases** in examples, not just the easy path.

### 3. Use XML tags to structure

- Claude treats XML tags as semantically meaningful: `<context>...</context>`, `<task>...</task>`, `<examples>...</examples>`.
- Helps Claude separate instructions from data, examples from the actual prompt.
- Especially useful when concatenating multiple inputs (user query + retrieved documents + system rules).

### 4. Think step-by-step (chain-of-thought)

- For multi-step reasoning, instruct: "Think through this step by step before answering."
- Even better: give Claude a `<thinking>` tag to use, then ask for the answer in `<answer>`.
- For Claude 4.x and Opus, this is often automatic — but explicit invitation still helps for tricky cases.

### 5. Assign a role (system prompt)

- A role primes the right vocabulary and standards: "You are a senior security reviewer auditing for OWASP Top 10."
- Be specific in the role: "senior" + "security" + "OWASP" gives much sharper output than "code reviewer".

## Specific Techniques

### Avoid negations when possible

- "Output only valid JSON" > "Don't output anything except JSON".
- Positive framing is easier to follow.

### Use delimiters consistently

- Pick one (XML tags, triple backticks, markdown headers) and stick with it within a prompt.

### Pre-fill the assistant turn

- For strict output formats, prefill the assistant's response with the opening token (`{`, `<answer>`, etc.) — Claude will continue from there in the expected format.
- Available in the API via the `assistant` role with content starting the format. Not directly accessible in Claude Code's main loop, but useful when designing agent prompts.

### Specify "if unsure, say X"

- "If you cannot determine the answer from the provided context, output `null`." Prevents hallucination.

## Anti-Patterns

- **Vague constraints**: "Be concise" — concise to what? "≤200 words" is enforceable.
- **Multiple competing instructions** without priority: Claude follows the most recent or the most explicit. Order them.
- **Asking Claude to "be creative" AND "follow this exact format"**: pick one.
- **Long preambles before the actual task**: Claude reads everything; bury the lede and it gets weighted accordingly.

## For Agent Prompts Specifically

Agents start cold. Treat their prompt like a brief to a new colleague:

```
<context>
Why this matters: <one sentence>
What's already been tried/ruled out: <bullet list>
</context>

<task>
Specific thing to do: <one sentence>
Constraints: <bullet list>
</task>

<output>
Return: <exact shape, under N words>
</output>
```

Avoid:
- "Based on your findings, decide what to do" — push decisions back to the parent.
- "Be thorough" — without scope, "thorough" balloons cost. Specify what to check.
- Prescribed step-by-step recipes — agents are smarter than fixed scripts; give them the goal, not the algorithm.

## Quick Reference

| Want this | Try this |
|---|---|
| Stricter format adherence | XML tags + example + prefill |
| Better reasoning on hard problems | "Think step by step" + `<thinking>` block |
| Domain-specific output | System role: "You are a [senior X]" |
| Less hallucination | "If you don't know, say so" + provide context |
| Consistent tone | Role + 2-3 examples in target tone |

---

**Sources**:
- https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview
- https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/chain-of-thought
- https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags
- https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/multishot-prompting

_Last reviewed: 2026-05-17._
