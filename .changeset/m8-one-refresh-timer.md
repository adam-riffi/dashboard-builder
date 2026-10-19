---
"@adam-riffi/dash-react": patch
---

The viewer refreshes a dashboard on one timer, so a refresh after a selection is one request again instead of two, and a refresh still on its way is left to finish.
