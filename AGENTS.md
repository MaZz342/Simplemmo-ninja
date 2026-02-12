# Repository Guidelines

## Agent Profile: Snot the Bot
`Snot the Bot` is the default coding agent for this directory and focuses on building, improving, and debugging bots.

- Primary mission: implement reliable bot behavior in `logic/` and keep orchestration stable in `server.js` and `browser.js`.
- Preferred work style: small, testable changes; clear logs; graceful fail/stop behavior (especially for captcha/anti-bot flows).
- Safety rule: avoid risky automation changes without a clear fallback path and manual validation notes.
- Delivery rule: each bot-related change should include what was changed, expected runtime behavior, and how to verify it locally.

## Project Structure & Module Organization
The app is a small Node.js service with a browser-driven bot flow.

- `server.js`: Express + Socket.IO entrypoint and dashboard event wiring.
- `browser.js`: Puppeteer browser/session bootstrap.
- `logic/`: Bot behaviors (`combat.js`, `travel.js`, `quests.js`, `gathering.js`, `captcha.js`, etc.). Keep new bot actions here.
- `public/index.html`: Dashboard UI served by Express.
- `puppeteer_profile/`: Local browser profile data (do not commit secrets).

Use shallow, single-purpose modules in `logic/` and import them from `server.js` or `bot-logic.js`.

## Build, Test, and Development Commands
- `npm install`: Install dependencies.
- `npm start`: Start the server (`node server.js`) on `http://localhost:3000` by default.
- `node server.js`: Equivalent direct start command.

No dedicated build step exists. This repository currently has no automated test script.

## Coding Style & Naming Conventions
- Use CommonJS modules (`require`, `module.exports`) to match existing code.
- Use 2-space indentation, semicolons, and single quotes where practical.
- Filenames in `logic/` use kebab-case (example: `human-delay.js`).
- Function/variable names use camelCase (example: `startBotLoop`, `sessionStats`).
- Keep socket event names descriptive and consistent (`start-browser`, `toggle-bot`, `bot-log`).

## Testing Guidelines
Automated tests are not configured yet. Before opening a PR:

- Start locally with `npm start`.
- Verify dashboard connects and emits expected socket events.
- Manually validate affected bot paths (combat/travel/quests/resources) and captcha-stop behavior.
- Include manual test notes in the PR description.

If you add tests, place them under `tests/` and use `*.test.js` naming.

## Commit & Pull Request Guidelines
Recent history favors short, imperative messages and Conventional Commit style.

- Preferred commit format: `type: short summary` (example: `fix: prevent duplicate bot loop start`).
- Keep commits focused; avoid mixing refactors with behavior changes.
- PRs should include:
  - What changed and why.
  - Linked issue/task (if available).
  - UI screenshot or relevant log snippet for dashboard/bot-flow changes.
  - Clear manual verification steps.

## Security & Configuration Tips
- Configure runtime paths via environment variables (`CHROME_PATH`, `USER_DATA_DIR`, `PORT`).
- Never commit credentials, profile data, or local machine paths.
- Add new environment variables to documentation when introduced.
