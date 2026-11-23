# Local and self-hosted models

How to run Tandem (Chat, Loom, autopilot, the hub) on a model you host: Ollama, LM Studio, llama.cpp or vLLM on your own computer, or your company's own model server. Since opencode connector 1.33.0.

A hosted model has a large context window and serves many requests at once. A model you host usually has a much smaller window and one GPU. Workshop's defaults assumed the first, so this page covers what to set up and what Workshop changes for you.

## 1. Give the model a big enough context window

This matters more than anything else.

Each Tandem command loads about 3.5K to 7.5K tokens of its own instructions, plus up to about 5K tokens of files it reads, on top of opencode's own system prompt, its tool definitions and your workspace repo map (Workshop estimates 6K for those). Plan for **15K to 30K tokens before the agent reads any of your code.**

- **Use at least 32K (32768) tokens.** Below 16K Tandem cannot work, and `workshop doctor` fails.
- **Set it on the server.** Ollama's default window is small (2K or 4K depending on the version) and it drops the start of a longer prompt without an error, so the model silently loses its instructions and just looks bad. Set `OLLAMA_CONTEXT_LENGTH=32768` before `ollama serve`, or make a model with `PARAMETER num_ctx 32768` in a Modelfile. Other servers have their own setting (llama.cpp `--ctx-size`, vLLM `--max-model-len`, LM Studio's context length per model).
- **Tell opencode the same number** with `limit.context`, so Workshop can check prompts against it. Workshop cannot read the server's real setting; if the two differ, the server wins.

An opencode provider for Ollama (`~/.config/opencode/opencode.json`):

```json
{
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama",
      "options": { "baseURL": "http://127.0.0.1:11434/v1" },
      "models": {
        "qwen2.5-coder:32b": { "name": "Qwen 2.5 Coder 32B", "limit": { "context": 32768, "output": 8192 } }
      }
    }
  }
}
```

A company server is the same shape with its own provider id and address. If your company approves providers, add the id to **Approved AI providers** too.

## 2. Pick a model that calls tools well

Tandem's agents edit files, run commands and call scripts through tool calls. A model that writes tool calls as plain text, or gets their arguments wrong, fails every build step even when its answers read well. Prefer a model your server marks as supporting tools, and the biggest one your hardware runs at a usable speed. Bench (Run, Models) runs Tandem's eval cases against any model opencode has, so you can compare before you switch.

## 3. Turn on Local model

Settings, opencode, **Local model**:

| Choice | Means |
| --- | --- |
| Automatic (default) | On when Model for agent runs is an Ollama, LM Studio, llama.cpp or vLLM model (by provider id) |
| On | Always. Pick this for a company server, which Workshop cannot recognize by name |
| Off | Never |

While it is on:

- **Builds at once is 1.** Parallel builds on one GPU take turns anyway, and each one needs its own share of memory for its context.
- **Chat suggests no next prompt.** That is one more model request after every answer, which waits behind the chat.

Set **Model for agent runs** too. Workshop checks prompts against that model's window; with no model picked and more than one available, it cannot know which model the agent will use and skips the check.

## What Workshop checks

- **Before every Tandem command** (a Loom button, autopilot, `/start` from Docket), Workshop looks up the command's size in eng-agents' `evals/commands.json` and the model's window from opencode. When the command's own instructions cannot fit, the run is refused with the reason, instead of running a model that never saw its instructions. When it fits but leaves under about 40% of the window for code, the run goes ahead and Workshop logs a warning. This check runs for any model whose window opencode knows, local or not.
- **`workshop doctor`** lists each local model in opencode's config with its window: too small (under 16K) fails; no `limit.context` is a warning; a big enough Ollama window gets a reminder to set the same size on the server. A provider counts as local when its id is a known local one or its address is on this computer or a private network; with Local model on, any provider with its own address counts. Since connector 1.34.0 doctor also asks each local server for its model list (`<baseURL>/models`, with the provider's key when the config has one): no answer fails doctor (every build step would fail), a refused key or a model the server does not list is a warning. Run it after connecting to the VPN, before you start a day of builds.
- **While a build runs**, a model error or a stalled step is tried again twice before autopilot waits for you ([factory.md](factory.md), When the model fails). A slow model that streams nothing for a long time (a big prompt on a small GPU) can look stalled: raise Settings, Factory, **Stalled after** for it.

## What still depends on you

- Workshop's 6K estimate for opencode's own prompt is not measured for your opencode version and repo map. A big repo map makes every prompt bigger.
- Eval results for your model: run Bench's Lift (Tandem against a plain prompt) on the model you will use before trusting the factory hands-off. The repo has no committed results for local models yet.
