# Documentation and comment conventions

How prose that lives next to the code is written here. The rules for the
knowledge base are separate and live in the doctrine; this file covers what a
human reads: documents under `docs/`, decision records, and comments in code.

Written in the code's language, because it describes the code. The knowledge
base and the rules of work are written in the language of the conversation —
the boundary is set in the doctrine, `writing.md`.

## What goes where

| Document | Answers |
| --- | --- |
| `FEATURES.md` | what this project can do, in the words of the product |
| decision records | why a choice was made and what was rejected |
| a document under `docs/` | why the code is shaped this way, for a reader who has the code in front of them |

The knowledge base answers "what and where". Documentation answers "why". A
sentence that answers "what and where" does not belong here — it will drift from
the code with nothing to catch it.

## Comments

A comment states the reason, not the action. `// increment counter` above `i++`
repeats the code and ages with it; `// the counter is read by the retry loop,
so it must survive the early return` states what the reader cannot see.

Anchors from code to a document are written as a path: `// See docs/x.md`. A
bare file name is prose, not a link, and nothing checks it.

## When a document is created and removed

Created when a reader would otherwise have to derive the reason from the code.
Removed together with the code it explains — a document describing code that no
longer exists is worse than no document, because it is believed.
