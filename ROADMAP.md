# Roadmap

## Meest Logisch Eerst
1. [x] Battle-flow state machine afgerond en gestabiliseerd (`logic/battle-energy.js`).
2. [x] Click-engine gecentraliseerd in gedeelde helper(s) voor travel/combat/battle.
2a. [x] `clickHandle` helper ingevoerd en gekoppeld aan combat/battle.
2b. [x] Resterende travel-click paden naar `clickHandle`-flow gebracht (`logic/travel.js`).
3. [x] Settings persistence in UI (`public/index.html`, localStorage).
4. [x] `browser.js` opgesplitst in modules (launch, stats, quest-live).
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

## Misschien Dit
1. Circuit breaker: flow tijdelijk pauzeren na X keer "too fast"/click-fail achter elkaar.
2. Selector health-check scherm: laat live zien welke belangrijke knoppen wel/niet gevonden worden.
3. Per-flow tempo sliders in UI (travel/combat/battle apart) met veilige min/max grenzen.
4. Auto screenshot + log snapshot bij fouten (voor snellere debugging).
5. Daily summary panel: sessietijd, steps, wins, loot, fast-warnings per uur.
