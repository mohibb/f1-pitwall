# F1 Pit Wall — ML Prediction Plan

> Created: May 2026
> Status: Planned — not yet started

---

## Overview

Two-phase machine learning system that predicts race finishing positions. The prediction is always presented the same way in the UI, but labelled to indicate which model is active. Predictions appear on a dedicated **Predictions page** (sixth nav item, between Strategy and Race Control).

---

## Model Labels

| Label | When active |
|---|---|
| `PRE-RACE` | After qualifying, before race start |
| `PRE-RACE (LOW CONFIDENCE)` | PRE-RACE model active but fewer than 4 current-season races available |
| `LIVE` | Race in progress, from lap 5 onwards |
| *(none)* | Before qualifying, or insufficient data |

---

## Data Parameters

| Parameter | Value | Notes |
|---|---|---|
| Season races lookback (N) | 8 | Last 8 completed races this season |
| Circuit history lookback (M) | 3 | Last 3 editions of this circuit |
| Circuit history window | 4 years | 2022 onwards only (post-regulation reset) |
| DNF encoding | Position 21 | Treated as finishing last for regression |
| Live model activation | Lap 5 | Suppressed before lap 5 to avoid noisy early data |

---

## Dependencies

Add to `requirements.txt`:

```
xgboost
scikit-learn
pandas
```

---

## Decay Weighting (Cold Start)

Previous season data is used as a decaying prior when current-season data is sparse.

| Season | Weight |
|---|---|
| Current season | 1.0 |
| 1 season ago | 0.7 |
| 2 seasons ago | 0.5 |
| 3+ seasons ago | 0.3 |

When fewer than 4 current-season races have completed, the blend shifts toward previous season data and the `LOW CONFIDENCE` label is shown.

---

## File Structure

```
f1-pitwall/
├── ml/
│   ├── __init__.py
│   ├── features.py         # Feature extraction from FastF1 sessions
│   ├── train.py            # Offline training script — auto-triggered post-race
│   ├── predict.py          # Loaded at server startup, called for inference
│   ├── model_prerace.pkl   # Saved PRE-RACE model (gitignored)
│   ├── model_live.pkl      # Saved LIVE model (gitignored)
│   └── feature_cols.json   # Saved feature column list (guards against mismatch)
```

Add to `.gitignore`:
```
ml/model_prerace.pkl
ml/model_live.pkl
```

---

## Phase ML-1 — PRE-RACE Model

### ML-1.1 — Dependencies & scaffold

- Add `xgboost`, `scikit-learn`, `pandas` to `requirements.txt`
- Create `ml/` directory with `__init__.py`
- Create `ml/features.py`, `ml/train.py`, `ml/predict.py` as empty stubs
- Warm FastF1 cache with 2023 and 2024 full seasons for training data

**Done when:** `ml/` directory exists, dependencies install cleanly, FastF1 cache is populated.

---

### ML-1.2 — Feature extraction (`ml/features.py`)

For each completed race in the training set, extract one row per driver:

| Feature | Source |
|---|---|
| Grid position | FastF1 qualifying session |
| FP2 long-run average pace | FP2 laps — 5+ consecutive laps, same compound |
| FP2 long-run gap to fastest | Delta from driver's long-run avg to field best |
| Constructor (encoded) | Session driver info |
| Laps completed ratio | `laps_completed / total_laps` |
| Previous N finishing positions | Rolling last 8 race results this season |
| Previous M finishes at circuit | Last 3 editions, within 4-year window |
| Season points standing | Points at time of this race |

Target variable: final finishing position (1–20, DNF = 21)

**Done when:** `extract_prerace_features(year, round)` returns a clean pandas DataFrame with one row per driver and no NaN values.

---

### ML-1.3 — Training script (`ml/train.py`)

- Loads all extracted feature rows across training races
- Applies decay weighting by season (see table above)
- Cold start logic: if fewer than 4 current-season races, increases previous-season blend weight
- Trains `XGBRegressor`
- Saves model to `ml/model_prerace.pkl`
- Saves feature column list to `ml/feature_cols.json`
- Auto-triggered by `session_manager.py` after each race weekend completes

**Done when:** Running `python ml/train.py` produces `model_prerace.pkl` without errors and prints feature importances.

---

### ML-1.4 — Inference (`ml/predict.py`)

- Loads `model_prerace.pkl` on server startup (if it exists)
- `predict_prerace(year, round)`:
  - Fetches qualifying results + FP2 data for the current round via FastF1
  - Builds feature vector for each driver using same extraction logic as training
  - Returns ranked list of `{ driver, predicted_position, confidence }`
- Confidence score: derived from spread of XGBoost tree predictions — low variance = high confidence
- Falls back to `LOW CONFIDENCE` label if fewer than 4 current-season races available
- Gracefully returns `None` if model file does not exist yet

**Done when:** Calling `predict_prerace(2025, 5)` in a Python shell returns a valid ranked list.

---

### ML-1.5 — API integration

- Add `predicted_finish` field to each driver in the state dict
- Add `prediction_model` field to session state: `"PRE-RACE"`, `"PRE-RACE (LOW CONFIDENCE)"`, `"LIVE"`, or `null`
- PRE-RACE predictions computed once after qualifying ends, stored in state dict
- No recomputation until race starts
- `/api/state` response automatically includes these fields — no endpoint changes needed

State dict additions:

```json
{
  "session": {
    "prediction_model": "PRE-RACE"
  },
  "drivers": {
    "VER": {
      "predicted_finish": 1,
      "prediction_confidence": 0.87
    }
  }
}
```

**Done when:** `/api/state` includes `predicted_finish` and `prediction_model` for a replay session.

---

### ML-1.6 — Predictions page (frontend)

- New route: `GET /predictions` in `routers/web.py`
- New template: `templates/predictions.html`
- Nav entry added to `base.html` between Strategy and Race Control
- Page layout:
  - Model label badge at top: `PRE-RACE` / `PRE-RACE (LOW CONFIDENCE)` / `LIVE`
  - 1–20 ranked predicted finishing order
  - Each row: predicted position · driver abbreviation (team colour dot) · driver name · current grid position · delta arrow (predicted vs grid/current)
  - If no prediction available: "Predictions available after qualifying" placeholder message
- Polls `f1:update` event like all other pages — no separate polling

**Done when:** Predictions page loads, shows ranked predictions from state dict, label updates correctly.

---

### ML-1 Complete

Commit: `feat: ML-1 PRE-RACE prediction model and predictions page`

---

## Phase ML-2 — LIVE Model

### ML-2.1 — Live feature extraction

Extend `ml/features.py` with `extract_live_features(state, lap_n)`.

For each driver at lap N:

| Feature | Source |
|---|---|
| Current position | `drivers[abbr].position` |
| Gap to leader (seconds) | `drivers[abbr].gap_to_leader` |
| Interval to car ahead (seconds) | `drivers[abbr].interval` |
| Compound | `drivers[abbr].compound` |
| Tyre life (laps) | `drivers[abbr].tyre_life` |
| Pit stops made | `drivers[abbr].pit_stops` |
| Laps remaining ratio | `(total_laps - current_lap) / total_laps` |
| Stint number | `drivers[abbr].stint` |
| Delta to fastest lap | `drivers[abbr].delta_to_fastest` |
| Track status | SC / VSC / normal encoded as integer |
| Constructor (encoded) | `drivers[abbr].team` |

Target variable: final finishing position (1–20, DNF = 21)

Training rows sourced by snapshotting each training race at laps 5, 10, 15, 20...

**Done when:** `extract_live_features(state, lap_n)` returns a valid feature DataFrame.

---

### ML-2.2 — Live training script

- Extends `ml/train.py` with a `train_live()` function
- Iterates training races, extracts lap snapshots at intervals
- `laps_remaining_ratio` included as a feature — one model handles the full race, no per-bucket models needed
- Saves to `ml/model_live.pkl`
- Auto-trained alongside PRE-RACE model after each race weekend

**Done when:** `model_live.pkl` is produced and feature importances are printed.

---

### ML-2.3 — Live inference integration

- `predict_live(state)` function in `ml/predict.py`
- Called by `replay_engine.py` on each lap completion — triggered when `lap_number` changes for any driver, not every tick
- Suppressed for laps 1–4
- Writes `predicted_finish` into each driver's state dict
- Sets `prediction_model` to `"LIVE"` on first call, replacing PRE-RACE
- During live mode: same call made from `live_timing.py` on each lap event

**Done when:** During a replay, `predicted_finish` values update each lap from lap 5 onwards and `prediction_model` reads `"LIVE"`.

---

### ML-2.4 — Frontend update

- Predictions page requires no structural changes
- `LIVE` label replaces `PRE-RACE` label automatically when `prediction_model` changes
- Rows re-sort by predicted position on each `f1:update` event
- CSS transition on row reorder so position changes are visually trackable

**Done when:** During replay, predictions page rows reorder smoothly each lap and label shows `LIVE`.

---

### ML-2 Complete

Commit: `feat: ML-2 LIVE race prediction model`

---

## Dependencies Between Phases

ML-1 must be fully complete before ML-2 starts. The following are built in ML-1 and reused in ML-2:

- Feature extraction infrastructure (`ml/features.py`)
- Model persistence pattern (`pkl` + `feature_cols.json`)
- Predictions page and frontend polling integration
- State dict fields (`predicted_finish`, `prediction_model`)

---

## Notes

- Model files (`*.pkl`) are gitignored — must be regenerated on any new machine
- If no model file exists on startup, predictions are silently skipped — no server error
- FastF1 cache must include at least 2 full seasons (2023 + 2024) before training is meaningful
- XGBoost inference is fast enough to run synchronously in the replay tick without performance impact
- All ML code lives in `ml/` — zero changes to core server architecture
