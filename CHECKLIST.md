# F1 Pit Wall — Race Weekend Checklist

## Before the session (30 min)
- [ ] Start server: `cd ~/f1-pitwall && bash start.sh`
- [ ] Confirm Cloudflare tunnel is active
- [ ] Open /api/health — check mode, uptime, last update
- [ ] Login from phone and laptop
- [ ] Confirm mode shows REPLAY and data is updating

## During the session
- [ ] Mode switches REPLAY → LIVE automatically at session start
- [ ] Timing tower updating with real data
- [ ] Race control messages appearing
- [ ] Tyre data updating on pit stops
- [ ] Circle map positions look plausible
- [ ] No errors in server logs

## After the session
- [ ] Mode switches back to REPLAY automatically
- [ ] Replay loads the just-completed session
- [ ] Note any issues for Phase 11
