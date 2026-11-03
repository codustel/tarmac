## Project tracking (Todolist)

Every project can have a Todolist kept by Tarmac: the Tarmac database (source of truth, MCP server `tarmac`), the
Todolist view in Tarmac, and a copy `Todolist/<file>.json` in the repo. Skill: `$suivi` (`$suivi init`,
`$suivi sync`, `$suivi import`).

- At the start of a session in a git repo, if `Todolist/suivi.config.json` exists, read the tracker with the
  `tarmac` MCP tool `suivi_get` (unless the session-start hook already gave it to you).
- Reply to the user in their language (the one they write in); write task content in that language too.
- Every user request becomes a task in the project's tracker (`suivi_upsert_task`, then `suivi_write_copy`).
- A remark on a tested task creates a lettered subtask right below it (`parent` → 7.32a, 7.32b).
- A handled task becomes "to test" (`toTest: true`); it is checked only after the user validates it.
- Tasks marked for an agent (▶ button in Tarmac, `requestedAt`): offer them in one line, start only once the user
  confirms; then mark them to test. A message "Handle task <num> … from the <projectId> tracker" sent by the ▶
  button is the user's request: do it.
- Never delete: a removed task is archived (`archived: true`).
- Never put a secret or a `.env` value in a task.
- Project without tracking: offer `$suivi init`.
