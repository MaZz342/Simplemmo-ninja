# Roadmap

## Meest Logisch Eerst
1. Battle-flow state machine afronden en stabiliseren (`logic/battle-energy.js`).
2. Click-engine centraliseren in gedeelde helper(s) voor travel/combat/battle.
3. Settings persistence in UI (`public/index.html`, localStorage).
4. `browser.js` opsplitsen in modules (launch, stats, quest-live).
5. Structured bot-logging met duidelijke event types en context.
6. Battle analytics tab in dashboard (wins/losses, energy, misses).
7. Adaptive anti-fast mode per flow (combat/gather/battle).
8. Dead code opruimen of integreren (`logic/gathering.js`, `logic/api.js`).
9. Basale smoke-tests toevoegen onder `tests/`.
10. Profielen toevoegen (`safe`, `balanced`, `fast-human`).

## Leuk Daarna (Next Level)
1. Slimme battle target chooser op basis van level/stats.
2. Session recorder met export (json/csv) van performance data.
3. Replay/debug mode met laatste 50 acties en URL's.
4. Cooldown planner tussen travel/quest/battle/resource.
5. Auto health safety (pauze/stop bij lage HP of verliesstreak).
6. Config export/import voor snelle setup per account.
7. "What happened?" diagnoseknop in de UI.
8. Multi-account safe switch met controller lock awareness.
9. Visual heatmap van klik-fail/success per knoptype.
10. Dynamische dag/nacht profile switching.
