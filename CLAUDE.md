# ChronoVoice

## Secrets and deployment

- Secrets (GEMINI_API_KEY, APP_PASSCODE) live in the macOS Keychain under service "chronovoice".
  Never ask the user to paste a secret, and never print, read, echo or pass a secret value
  as a command argument or tool parameter.
- Set or rotate secrets in Vercel only by running `./scripts/push-secrets.sh`.
- Deploy `main` to production with `./scripts/deploy-prod.sh` (builds from GitHub, never uploads local files).
- Run the app locally with `./scripts/dev.sh`.
- Use the Vercel MCP for everything that isn't a secret: project, domain, deployments, logs.
- Full guide: [docs/secure-deployment.md](docs/secure-deployment.md)
