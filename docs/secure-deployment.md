# Automated Vercel deployments without exposing secrets

This guide sets up a deployment that Claude Code can run from start to finish (create the Vercel project, import from GitHub, set environment variables, attach a domain, deploy and check the live site) while API keys and passcodes **never appear in the chat, its history, or any file Claude reads**.

It uses ChronoVoice as the example. The same setup works for any project.

## The principle

Secrets move **from program to program**, never through the conversation:

```
macOS Keychain ──(pipe)──▶ vercel CLI ──(HTTPS)──▶ Vercel (stored as Secret)
```

Claude runs the scripts that move secrets, but only sees their output ("✓ GEMINI_API_KEY set"). It never sees the values. Everything that isn't a secret (project, domain, deploys, logs) goes through the Vercel MCP, fully automated.

Exposure happens when a secret becomes **text in the conversation**. That happens when:

| How a secret leaks | How this setup prevents it |
|---|---|
| You paste it into the chat | Secrets go into the Keychain, never into the chat |
| Claude reads a `.env` file | Secrets aren't stored in project files, and reading `.env` files is blocked |
| Claude passes it as a tool argument (e.g. the MCP `create_project_env`) | That MCP tool is blocked; a script sets secrets instead |
| A command prints it | The scripts never print values, and the command that reads the Keychain directly is blocked |
| Claude reads it back from Vercel | Secrets are stored as Vercel **Secret** type, which can't be read back, and the read tools are blocked |

## One-time setup (done by you, about 10 minutes)

These are the only steps that involve secret values, so you do them yourself, outside Claude.

### 1. Store secrets in the macOS Keychain

Run these in your own terminal (not through Claude). The `-w` at the end makes the Keychain **prompt** for the value, so it doesn't end up in your shell history:

```bash
security add-generic-password -s chronovoice -a GEMINI_API_KEY -w
security add-generic-password -s chronovoice -a APP_PASSCODE -w
```

To change a value later, add `-U` to update it.

> Prefer a password manager? With 1Password, replace the Keychain lookups in the scripts below with `op read "op://Private/ChronoVoice/GEMINI_API_KEY"`.

### 2. Sign in to Vercel

```bash
npm i -g vercel
vercel login
```

Then connect the Vercel MCP in Claude Code. In this project it's already added; run `/mcp`, select **vercel**, choose **Authenticate**, and sign in.

### 3. Lock down your Gemini key in Google Cloud

In the [Google Cloud console → Credentials](https://console.cloud.google.com/apis/credentials), edit the key and, under **API restrictions**, allow only the **Generative Language API**. If the key ever leaks, it can't be used for anything else.

## Files to add to the repository

None of these contain secrets, so they're safe to commit.

### `scripts/push-secrets.sh`: Keychain → Vercel

```bash
#!/usr/bin/env bash
# Copies secrets from the macOS Keychain into the linked Vercel project.
# Values are piped straight into the Vercel CLI and never printed.
set -euo pipefail

SERVICE="chronovoice"
NAMES=(GEMINI_API_KEY APP_PASSCODE)

for NAME in "${NAMES[@]}"; do
  VALUE="$(security find-generic-password -s "$SERVICE" -a "$NAME" -w 2>/dev/null)" || {
    echo "✗ $NAME is not in the Keychain (service: $SERVICE)" >&2
    exit 1
  }
  printf '%s' "$VALUE" \
    | vercel env add "$NAME" --environment production --sensitive --force >/dev/null
  unset VALUE
  echo "✓ $NAME set in Vercel production (value not shown)"
done
```

`--sensitive` stores each value as a Vercel **Secret**, which nobody can read back (not the dashboard, the CLI or the MCP). `--force` overwrites an existing value, so the same script also handles rotation.

### `scripts/dev.sh`: run locally without a `.env.local`

```bash
#!/usr/bin/env bash
# Starts the dev server with secrets from the Keychain, so no secret file exists on disk.
set -euo pipefail
export GEMINI_API_KEY="$(security find-generic-password -s chronovoice -a GEMINI_API_KEY -w)"
export APP_PASSCODE="$(security find-generic-password -s chronovoice -a APP_PASSCODE -w)"
exec npm run dev
```

ChronoVoice's `vite.config.ts` reads environment variables from the shell as well as from `.env` files, so after switching you can delete `.env.local`. Make both scripts executable: `chmod +x scripts/*.sh`.

### `.claude/settings.json`: guardrails Claude can't talk its way around

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Bash(security find-generic-password*)",
      "Bash(vercel env pull*)",
      "mcp__vercel__create_project_env",
      "mcp__vercel__edit_project_env",
      "mcp__vercel__get_project_env",
      "mcp__vercel__filter_project_envs",
      "mcp__vercel__get_shared_env_var"
    ]
  }
}
```

What each rule stops:

- **`Read(./.env*)`**: Claude opening a `.env` file, including through `cat`, `head` and similar commands.
- **`security find-generic-password`**: Claude reading the Keychain directly. It can still run the scripts, because deny rules match the command Claude types, not what a script does inside.
- **`vercel env pull`**: Claude downloading environment variables into a file.
- **The `mcp__vercel__*_env` tools**: Claude sending a secret as an MCP argument, or reading one back.

### `CLAUDE.md`: tell Claude the rules

Add this section so Claude knows the workflow instead of discovering the blocks by trial and error:

```markdown
## Secrets and deployment

- Secrets (GEMINI_API_KEY, APP_PASSCODE) live in the macOS Keychain under service "chronovoice".
  Never ask the user to paste a secret, and never print, read, echo or pass a secret value
  as a command argument or tool parameter.
- Set or rotate secrets in Vercel only by running `./scripts/push-secrets.sh`.
- Run the app locally with `./scripts/dev.sh`.
- Use the Vercel MCP for everything that isn't a secret: project, domain, deployments, logs.
```

## The automated deployment

With the setup above, one prompt does the whole job:

> Deploy atodev/Talking-Clock to Vercel at chronos.atodev.xyz.

Claude then:

1. **Creates the project from GitHub** with the MCP `create_git_project` and `deploy: false`, so the first build doesn't run without its environment variables.
2. **Links this folder to the project:** `vercel link --yes --project <name>`. With the CLI alone, this one command also creates the project and connects GitHub (step 1). It adds `.vercel` and `.env*` to `.gitignore` and writes a `VERCEL_OIDC_TOKEN` into `.env.local`.
3. **Sets the secrets:** runs `./scripts/push-secrets.sh`, and sees only the ✓ lines.
4. **Adds the domain** with the MCP `add_project_domain` and `verify_project_domain`. `atodev.xyz` uses Vercel's DNS, so no DNS records need adding by hand.
5. **Deploys to production** from the `main` branch on GitHub: `./scripts/deploy-prod.sh`, or the MCP `create_deployment` followed by `get_deployment` until it's `READY`. If it fails, `get_deployment_build_logs` (or `vercel inspect <id> --logs`) shows why. Building from GitHub rather than with `vercel deploy` means local files like `.env.local` are never uploaded.
6. **Checks the live site** with `web_fetch_vercel_url`, for example that `https://chronos.atodev.xyz/api/token` replies "Enter the passcode to connect." That proves the function runs and the passcode is enforced, without using the passcode.

After that, every push to `main` redeploys automatically through Vercel's GitHub integration.

## Rotating a secret

1. Create the new value (for example a new key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)).
2. Update the Keychain in your own terminal: `security add-generic-password -U -s chronovoice -a GEMINI_API_KEY -w`
3. Ask Claude: *"Push the secrets to Vercel and redeploy."*
4. Delete the old key in AI Studio.

## Limits

- **These are strong guardrails, not a vault.** Claude Code runs as your user, so a determined process could still reach your Keychain. The deny rules don't cover an arbitrary script written to read it. The rules plus `CLAUDE.md` stop accidental exposure, which is the realistic risk. For OS-level enforcement, Claude Code's [sandbox](https://code.claude.com/docs/en/sandboxing.md) can block reading paths entirely, but it would block the scripts too, so it doesn't suit this workflow.
- **The browser still receives short-lived tokens.** That's by design: ChronoVoice's `/api/token` gives out single-use Gemini tokens that expire within minutes, never the key itself.
- **Secrets already in old chats stay there.** If a secret was ever pasted into a chat, rotate it.

## References

- [Vercel MCP](https://vercel.com/docs/agent-resources/vercel-mcp) and its [tools](https://vercel.com/docs/agent-resources/vercel-mcp/tools)
- [`vercel env` CLI](https://vercel.com/docs/cli/env) (including `--sensitive` and piped values)
- [Claude Code permissions](https://code.claude.com/docs/en/permissions) and [settings](https://code.claude.com/docs/en/settings)
- [Gemini ephemeral tokens](https://ai.google.dev/gemini-api/docs/ephemeral-tokens)
