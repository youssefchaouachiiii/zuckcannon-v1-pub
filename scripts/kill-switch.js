#!/usr/bin/env node
/**
 * The kill switch, from the operator's side.
 *
 *   node scripts/kill-switch.js on --reason "act_123 throttled"
 *   node scripts/kill-switch.js status
 *   node scripts/kill-switch.js off
 *
 * Deliberately a file and a script rather than an API call: it has to work when the server is
 * wedged, mid-deploy, or pinned by a runaway loop — which is exactly when it gets reached for.
 * It is read on every Meta write, so flipping it lands on the next API call.
 */

import fs from 'fs';

import {
  engageKillSwitch, releaseKillSwitch, isKillSwitchOn, killSwitchReason, killSwitchPath,
  recentCalls, rateWindowPath,
} from '../backend/utils/meta-guard.js';

const [, , command, ...rest] = process.argv;

const reasonFlag = rest.indexOf('--reason');
const reason = reasonFlag >= 0 ? (rest[reasonFlag + 1] || '') : '';

switch (command) {
  case 'on': {
    const p = engageKillSwitch(reason);
    console.log(`Kill switch ON — ${p}`);
    console.log('Every Meta write is refused from the next API call. Reads still work.');
    console.log('Pausing by hand in Ads Manager still works and is not affected.');
    process.exit(0);
    break;
  }
  case 'off': {
    const was = releaseKillSwitch();
    console.log(`Kill switch OFF — ${killSwitchPath()}${was ? '' : ' (was already off)'}`);
    process.exit(0);
    break;
  }
  case 'status': {
    const on = isKillSwitchOn();
    const why = killSwitchReason();
    console.log(`${on ? 'ON' : 'off'} — ${killSwitchPath()}${on && why ? `: ${why}` : ''}`);

    let window = {};
    try {
      window = JSON.parse(fs.readFileSync(rateWindowPath(), 'utf-8'));
    } catch { /* no calls recorded yet */ }
    const counts = Object.keys(window)
      .map((account) => `${account}=${recentCalls(account).length}`)
      .filter((line) => !line.endsWith('=0'));
    console.log(counts.length ? `Calls this hour: ${counts.join(', ')}` : 'Calls this hour: none');

    process.exit(on ? 1 : 0);
    break;
  }
  default:
    console.error('Usage: node scripts/kill-switch.js <on|off|status> [--reason "..."]');
    process.exit(2);
}
