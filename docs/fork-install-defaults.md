# Fork installation defaults

Fresh installations of this fork use the owner's portable Desktop and agent
preferences. These are ordinary defaults: explicit saved preferences still win.
No user profile, Chromium storage directory, or credential file is bundled.

## Desktop

- Mono skin, dark mode, including the initial HTML and native window.
- 90% scale (the existing product default), 10% translucency, no statue backdrop.
- Project grouping with agent groups enabled, recency ordering, and preview,
  updated time, and token metadata. Flat grouping falls back to status.
- Status bar controls visible except Agents and the running timer.
- Inline embeds off; no stored provider consent is copied.
- Existing defaults already match the remaining portable appearance preferences.

Definitions live beside their existing renderer stores, in `src/themes/presets.ts`,
and in Electron's native startup defaults. Missing translucency must not be
coerced to zero: zero is an explicit saved preference and remains respected.

## Agent and configuration

`hermes_cli/config_defaults.py` owns runtime defaults. `cli-config.yaml.example`
is also an installation input (shell/PowerShell installers, Docker, and doctor),
so its active entries must not silently override the intended runtime defaults.
The classic CLI's independent loader references the same canonical model,
agent, display, terminal-timeout, and delegation preferences rather than
retaining a second set of conflicting fallback values.

The defaults include:

- GPT-5.5 through OpenAI Codex, medium reasoning, and concise responses.
- Direct implementation as the preferred coding workflow; delegation for useful
  independent parallel work, with one final review rather than repeated reviews.
- Current turn, delegation, terminal, tool-output, compression, and cron limits.
- Existing model selections for image generation and X search; authentication is
  still required on each installation.
- The saved disabled-skill choices and disabled MoA preset.
- Clean cron output, two-day idle-session auto-archiving, and repository discovery
  disabled until explicitly enabled.
- Pre-update backups disabled, matching the owner's preference; users may enable
  quick/full backups or request one for an individual update.

## Not portable

The defaults deliberately exclude credentials, sudo credential references,
backend URLs, MCP service connections, Hindsight/local-service configuration,
custom provider endpoints, personal paths, pet assets, projects, sessions,
window geometry, tab/layout contents, browser data, onboarding completion, and
permission grants. Security redaction and tool-approval protections are not
weakened to match a locally authorized installation. Provider/model selection
is a preference, not an authenticated connection.

## Verification

- `tests/hermes_cli/test_install_defaults.py` resolves both empty profiles and
  installer-template profiles through the real config loader, checks portable
  defaults agree, and exercises saving/reloading explicit overrides.
- Desktop unit tests cover profile appearance, missing/corrupt translucency,
  explicit zero, saved overrides, sidebar reset, and status-bar visibility.
- `apps/desktop/e2e/install-defaults.spec.ts` launches the built Electron app with
  isolated HOME, HERMES_HOME, and userData, removes the test fixture's zoom seed,
  waits for the actual provider picker, and checks theme, native mode, scale,
  translucency, and the shell without importing a real account.
