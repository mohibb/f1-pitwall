# F1 Pit Wall — TODO

## UI
- [ ] Settings page: "Save settings" button appears inline with "Jump" button instead of on its own line below

## Data
- [ ] Pit stop duration: find accurate per-circuit pit lane travel times from FastF1 data
- [ ] Sector-level yellow flag on circle map: extract Flag + Scope + Sector from race_control_messages, pass sector_flags in state dict, highlight relevant sector arc yellow in circle_map.js
- [x] Lap counter doesn't reach total_laps at end of replay — fixed: added 120s buffer to _max_time so all drivers complete final lap before reset

## Phase 9 Design Notes
- [ ] 9.1 Click-to-compare gaps: use end-of-lap gap values (not mid-lap) for comparison — gaps should be derived from completed lap data only. If selected driver is in pit lane, fall back to gap-to-leader until they rejoin.

## Done in Phase 9
- [x] Timing page renamed to Dashboard in nav

## Phase 11 additions
- [ ] Static offline page on Cloudflare Pages (e.g. mohibb.com or status.mohibb.com) showing "F1 Pit Wall is offline" + next race weekend date
