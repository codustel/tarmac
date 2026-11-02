
## Project tracking (Claude Todolist)

Every project has a Claude Todolist: the Tarmac database (source of truth, MCP server `tarmac`), a claude.ai
artifact in the project's colors, and a copy `Todolist/<file>.json` in the repo. Command: `/suivi`.

- Reply to the user in their language (the one they write in); write task content in that language too.
- Every user request becomes a task in the project's tracker (`suivi_upsert_task`, then the same task in the
  artifact db, then `suivi_write_copy`).
- A remark on a tested task creates a lettered subtask right below it (`parent` → 7.32a, 7.32b).
- A handled task becomes "to test" (`toTest: true`); it is checked only after the user validates it.
- Never delete: a removed task is archived (`archived: true`).
- Never put a secret or a `.env` value in a task.
- Project without tracking: offer `/suivi init` (the session-start hook flags it).
