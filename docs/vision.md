# Skillpack vision

Skillpack is a self-hostable, multi-tenant Skills Hub. Organizations create, validate, version,
organize, share, install, and publish portable SKILL.md packages. Members use the web or CLI;
external coding agents use delegated Agent Auth against the same authorized APIs.

Skills are portable files. Personal libraries are creator-only, organization libraries are shared,
and labels organize without changing access. Immutable versions, dependency validation, comments,
public releases, and install records make reuse trustworthy. Voluntary agent-reported activations
help members understand adoption without requiring the skill user to sign in. Secrets stay encrypted and write-only;
short-lived grants authorize retrieval. Declared Skill Databases provide tenant-scoped SQLite state.

Skillpack completes authorized workflows end to end with credentials it already holds.
Hosted teammates, chat, Box/Pi execution, routines, triggers, plugins, and native chat clients are
retired. Skillpack does not launch external coding agents or execute skill package scripts.

The reporting rollout includes an explicitly authorized historical-package retrofit; installed
copies can detect same-version content updates through checksums.
