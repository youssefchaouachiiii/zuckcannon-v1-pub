AD RULES ENGINE
Standard Operating Procedure

Version: April 2026
For: Youssef @ Sigma Growth Partners
Platform: https://staging-adgen.sigmagrowthpartners.com (sidebar: Rules Engine)


WHAT IT DOES

Checks all your Facebook campaigns every 2 minutes. If a rule condition is met, it pauses the campaign, adjusts the budget, and sends a Telegram alert. It logs everything.

It is not an analytics tool. It reads data from Facebook and RedTrack, evaluates conditions, and takes action. Think of it as a smart cron job.


KEY CONCEPTS

Rule: A condition + action pair. Create once, assign to unlimited campaigns. One campaign can have multiple rules.

Schedule: Turns campaigns ON/OFF by time of day (Eastern Time). A rule-triggered pause always overrides the schedule. The schedule will NOT re-enable a campaign paused by a rule.

Vertical: A campaign category (Cash Offer, EDU, Solar, etc.). Assign a rule or schedule to a vertical and all campaigns in it are covered automatically, including new ones.

Scope: Campaign, Ad Set, Ad, or Account level. Account scope sums spend across all campaigns in the account and pauses all of them if the total threshold is hit.

Cooldown: After a rule fires, the engine skips that campaign for X hours before the rule can fire on it again.

Dry Run: Rule evaluates and sends a Telegram alert but takes no real action on Facebook. Use this to test before going live.


ACTIVE RULES

1. Spend Cap Kill (Account scope, cooldown 4h)
   IF total account spend today is over $300, THEN pause all campaigns in that account.

2. Negative ROI Kill (Campaign scope, cooldown 4h)
   IF spend is above floor AND ROI is negative beyond threshold, THEN pause campaign.

3. Zero Conversions Kill (Campaign scope, cooldown 4h)
   IF spend is above floor AND conversions equal 0, THEN pause campaign.

4. Scale Winner (Campaign scope, cooldown 48h)
   IF 3-day CPA is below target AND conversions and spend above minimums, THEN increase daily budget by 20% (max $500/day). Skips ad sets in Facebook learning phase.


ACTIVE SCHEDULES (all Eastern Time)

Business Hours: Mon-Fri, 8:00 AM to 8:00 PM (Cash Offer, Home Warranty)
Extended: Mon-Fri, 6:00 AM to 11:00 PM (EDU)
Weekdays + Sat: Mon-Sat, 8:00 AM to 9:00 PM (Solar)
Always On: All day, every day (Rewards / Freecash)


HOW TO USE


Creating a Rule

1. Rules Engine sidebar, Rules tab, click Add Rule.
2. Fill in: Name, Scope, Conditions (metric, operator, value, lookback window), Action (pause / enable / scale budget), Cooldown hours, Alert level, Dry Run toggle.
3. Save.


Assigning a Rule

Option A: Verticals tab, find the vertical, click Assign Rule. Covers all current and future campaigns in that vertical.

Option B: Rules tab, find the rule, click Assignments, select individual campaigns. Use Bulk Assign by Pattern to match campaigns by name keyword.


Creating and Assigning a Schedule

1. Schedules tab, click Add Schedule.
2. Fill in: Name, Days of Week, Start Time, End Time (24-hour Eastern).
3. Save, then assign to a vertical or individual campaigns the same way as rules.


Monitoring

Log tab: Full history of every rule that fired, which campaign, what metrics triggered it, and when.

Coverage tab: Shows campaigns with no rule and/or no schedule assigned. These are running unprotected.


TELEGRAM ALERTS

Every rule fire sends a Telegram message with the campaign name, rule name, metric values, and time. Two quick action buttons:

Re-enable: Immediately re-enables the paused campaign and resets the cooldown.

Snooze 6h: Exempts that campaign from that rule for 6 hours without re-enabling it.

Spend Cap Kill (account-level) also sends an email since it is a critical alert.

A daily digest is sent once per day summarizing spend, conversions, rules fired, and system status.


IMPORTANT NOTES

Campaigns paused by a rule stay paused until you manually re-enable them. The schedule will not do it for you.

Spend data (for spend cap and burst rules) updates within 1 to 5 minutes. Conversion and ROI data lags 15 to 30 minutes due to Facebook's processing pipeline.

If the engine cannot reach Facebook (API error, bad token), it sends a Telegram alert automatically. It never fails silently.


TROUBLESHOOTING

Rule not firing even though it should:
Check if the campaign is assigned to the rule, if the rule is in Dry Run mode, if the campaign is in cooldown, or if the campaign is already paused (engine skips paused campaigns for kill rules).

Campaign not turning on at schedule time:
A rule probably paused it. Manually re-enable the campaign first, then the schedule will maintain it.

Telegram alerts coming but no Facebook action:
The rule is in Dry Run mode. Edit the rule and turn Dry Run off.

Token or API alert in Telegram:
Contact Rayhan immediately. A bad token means no rules are running.


END OF DOCUMENT
