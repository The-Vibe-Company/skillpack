# Skillpack product

Skillpack is a Skills Hub organized as **Organization → User**. Organization roles are Owner,
Admin, and Developer. Members manage portable skills through the web and CLI; external coding
agents use exact-workspace delegated capabilities. Personal skills have no admin override.

## Libraries and ownership

- `org`: flat organization-wide library. Every member can read and manage its skills.
- `personal`: private **My Skills** library. Only `creator_id` can read or manage the skill; admins
  have no override.
- A slug is unique across both scopes in an organization.
- **Share** is the sole, owner-only, one-way `personal → org` transition.
- **Installed** is a view: a member's personal skills plus org skills with a `skill_installs` row.

Organization labels form a shared tree. Personal labels form a private per-member tree. Labels are
slash-separated, multi-assigned, and may exist without skills.

## Core journeys

1. Create or upload a package; validate archive safety, `SKILL.md`, manifest, dependencies, secrets,
   and database declarations.
2. Publish an immutable version and review its files, history, dependency graph, comments, and
   activity.
3. Share a personal skill to the organization with its required private dependency closure.
4. Install or update a skill into supported external coding tools and report the installed version.
5. Publish one pinned organization version as a checksum-addressed public release.
6. Mirror organization skills to GitHub deterministically.
7. Let an approved external coding agent read/write skills, use Skill Databases, or retrieve bound
   secrets through constrained grants.

## Reported skill activations

New published versions include a visible reporting instruction in `SKILL.md`. An external agent
can report each activation without logging into Skillpack or installing a binary. Existing immutable
versions are unchanged; copied skills need updating. Collection is best effort, not evidence of
successful execution. `SKILLPACK_TELEMETRY=0` or the user's instruction disables reporting.

The Usage tab shows the last 90 days of reported activations, daily UTC totals, agent/environment
breakdowns, anonymous reports, and declared identities. IDs and emails are unverified, may represent
bots, and do not establish membership or a reliable count of people. Members can see organization
skill statistics; only the creator can see personal skill statistics, with no admin override.

Reports prefer explicitly configured identity, then non-secret local Skillpack telemetry metadata,
then the repository/global Git email, otherwise anonymous. Names, paths, prompts, code, credentials,
and Git history are excluded. This sends declared email addresses to the package's Skillpack instance.

CLI login writes only the declared ID/email to `~/.skillpack/telemetry.json`, separate from session
cookies. Logout removes that file when it still belongs to that account. Telemetry opt-out skips
writing it; reporting agents must also check opt-out before reading any identity.
