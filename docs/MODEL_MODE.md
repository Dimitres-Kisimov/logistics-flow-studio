# The optional model mode (v3.61): a language model beside the app, never inside it

*Written 2026-09-23 for v3.61. Ask the ledger (v3.60) answers a fixed catalogue deterministically. This page is the optional layer on top: a language model that rewrites those answers into prose and handles questions the catalogue does not cover, under two rules - it never produces a number the deterministic layer did not, and it is off by default.*

## The runtime decision

The app promises to be offline: a strict Content-Security-Policy (`connect-src 'self'`) and `tools/offline-guard.mjs` refuse any call to another host, and the service worker caches every file. Neither way of putting a model *inside* the page keeps that promise - a hosted API needs a key and a network call; an in-browser model pulls hundreds of megabytes from a CDN and would still not fit a plant's laptop. So the model mode runs **beside** the app, as a command-line tool over any **OpenAI-compatible chat endpoint**:

- a **local server** (Ollama, llama.cpp, LM Studio) - the answer never leaves the machine; `http://localhost:11434/v1` is Ollama's default;
- a **hosted API** - the user's choice, with the key in an environment variable (never on the command line, never stored); the tool prints a `NETWORK:` banner whenever the endpoint's host is not localhost, because the evidence pack (aggregates of the run) leaves the machine.

Nothing in the app changed for this release: the drawer's and the viewer's question boxes stay deterministic and offline.

```sh
python tools/ask_model.py "which step waits longest" --export run-ledger.json                                      # dry run: nothing is called
python tools/ask_model.py "why is the put-away queue so long" --export run-ledger.json --endpoint http://localhost:11434/v1 --model llama3.1
WT_MODEL_KEY=... python tools/ask_model.py "..." --export run-ledger.json --endpoint https://api.example.com/v1 --model m   # flagged as a network call
node tools/ask_cli.mjs "which step waits longest" --export run-ledger.json                                         # the deterministic layer alone, as JSON
```

## The two rules

**1. No number the deterministic layer did not produce.** The tool builds an *evidence pack*: the deterministic answer of v3.60 (`tools/ask_cli.mjs` - the same `ask.js` the app loads: text, the view rows it read, the sources of any threshold) and, for a question outside the catalogue, every catalogue answer, so the model answers from the same views (retrieval is the whole pack; it is small). The system prompt says so in five rules. After the call, a **number guard** reads every number in the prose and checks it against the numbers in the evidence - as written, rounded no finer than the evidence gives, or as the percent form of a share (0.65 → 65 %). A prose with any other number is **refused**: the deterministic answer is printed instead and the offending numbers are named. A refusal is the rule working, not an error.

**2. Every model answer carries its evidence block.** The output JSON (`--out`) always holds the deterministic answer beside the prose and the printed answer ends with `Evidence: read <view> (n rows)` and `Source: <id> = <value> - <citation>` lines. The mode is recorded (`model` or `deterministic`), the endpoint host, and whether the call was a network call.

## What it is not

Not a new analysis: the model sees only aggregates the ledger already computed, in the same rows the viewer shows. Not a source of thresholds: those come from the knowledge base with their labels (teaching value, or `measured on …, n = …` after a site profile). Not on by default, and not inside the offline app. The model is told never to name or imply a person; the ledger has nothing per person to give it.

## Reproduce

```sh
node verify_model_mode.js                      # the CLI equals WT.ask, the dry run, the app unchanged (CSP, no fetch), docs
python -m unittest test.test_ask_model -v      # the number guard by hand, the evidence pack, the prompt, a mocked endpoint (accepted and refused prose), the network flag
```
