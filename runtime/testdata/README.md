# Sanitized runtime fixtures

These fixtures contain only synthetic paths, IDs, and text. They model the
small structured envelopes consumed by the runtime; no user transcript or
prompt content is copied into the repository.

`fixture_schema_version: 1` is the local fixture format. It is intentionally
separate from the wire event `schema_version: 1`.

The envelopes were checked against the public hook references on 2026-09-23:

- Claude Code hooks: <https://code.claude.com/docs/en/hooks>
- Codex hooks: <https://developers.openai.com/codex/hooks>

The Claude slash-command fixture uses the documented `UserPromptExpansion`
`expansion_type`/`command_name` fields. The Codex completion fixture mirrors
the observed desktop `event_msg`/`item_completed`/`CommandExecution` envelope;
the parser reads only successful `parsed_cmd` entries with `type: read` and
`name: SKILL.md`. It never reads command text, stdout, or prompt text.

The public documents do not define a stable transcript schema. The remaining
transcript fixture therefore uses only explicit structured
`tool_use`/`tool_result` records and is treated as a narrow fallback.
