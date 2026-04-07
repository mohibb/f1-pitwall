# F1 Pit Wall — TODO

## UI
- [ ] Settings page: "Save settings" button appears inline with "Jump" button instead of on its own line below

## Data
- [ ] Pit stop duration: find accurate per-circuit pit lane travel times from FastF1 data

- [ ] Sector-level yellow flag on circle map: extract Flag + Scope + Sector from race_control_messages, pass sector_flags in state dict, highlight relevant sector arc yellow in circle_map.js
- [ ] Lap counter doesn't reach total_laps at end of replay — investigate why final laps don't increment correctly
