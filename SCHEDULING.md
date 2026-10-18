# Scheduled raids and shared schedules

Both new commands use English for all bot-authored setup text, errors, controls,
confirmations, and announcements. Existing command translations are unchanged.
Both commands require **Manage Server**, matching the existing announcement
management permission. Component interactions recheck permission and ownership.

## `/schedule`

Run the command in the channel where registration should open. It reuses the
existing creation wizard: catalog/custom dungeon or trial, timezone, regional
hour preference, date, time, title, description, DST disambiguation, and preview.
The final button is **Schedule Raid**. Only that confirmation persists the raid.

The existing model makes the creator the raid leader and sets dungeon/trial
capacity to 5/10. The existing creation wizard does not expose a separate leader
picker or configurable role quotas. Equipment profiles (artifacts, mounts,
companions, auras), role registration, reserve handling, and leader plan editing
remain in their existing flows after registration opens; they are not duplicated
by this feature.

Registration opens at `unixZamani - 86400` UTC seconds. For example, October 25,
2026 at 9:00 PM in Europe/Istanbul opens October 24 at 9:00 PM in that zone.
Across a DST change, 24 elapsed hours can differ from the same local clock time
on the preceding calendar day. The existing IANA/ICU conversion rejects skipped
times and requires an explicit choice for repeated times. Changing a user's
timezone preference never changes a saved raid's UTC start.

If the start is within 24 hours, a second **Confirm Immediate Publication**
button is required. The raid is persisted first, then the worker is triggered
immediately. API failures leave a durable pending raid for retry. The ephemeral
confirmation includes the raid, start/publication dates and times, timezone,
announcement channel, and leader. Immediate confirmations explain that
publication will occur as soon as the channel is available.

Use existing `/düzenle` (English client: `/edit-raid`) autocomplete to edit an
unpublished raid. Date edits recalculate its publication time. Published edits
update the existing registration message. To delete an unpublished raid, select
it in the same command and set **cancel-scheduled: true**. Deleting a published
registration message retains the existing removal behavior. While a publication
is in flight or an uncertain send is being reconciled, edits/cancellation ask
the manager to retry rather than race a Discord send.

## `/share-schedule`

The ephemeral **Scheduled Raids** selector lists future raids in the current
guild, including unpublished scheduled raids and existing published raids. It
excludes closed, expired, deleted, cancelled, and completed raids. Pages contain
at most 25 choices; selections and deselections are retained across pages.
Only the initiating user can use the controls. Sessions expire after 14 minutes.

**Share Selected** validates selected stable IDs again, verifies existing
registration messages, then posts **Upcoming Raids** to the command's channel.
Deleted/unavailable selections require reviewing the remaining choices before
sharing again. Published raids link to their original message with **Join Raid**;
unpublished raids say **Registration Not Yet Open** and show **Registration
Opens**. Dates use the raid's saved timezone; legacy records without one display
UTC explicitly rather than inventing an organizer timezone.

Announcements use one embed per message and split at complete raid boundaries
to stay within Discord's description and total embed limits. No registration
buttons are created. Sharing never saves raid records, changes their times, or
opens registration. Repeated announcements refer to the same raids.

## Persistence and publication worker

There is no new database, dependency, paid service, or migration. `raid_data.json`
keeps its existing `{ "raids": { ... } }` structure and all legacy fields.

| Field | Meaning |
| --- | --- |
| `unixZamani` | Existing UTC start in epoch seconds; no duplicate `startsAt` |
| `organizerTimeZone` | Existing IANA timezone snapshot; no duplicate `timezone` |
| `creatorId` | Existing leader/creator ID; no redundant leader field |
| `guildId`, `channelId` | Existing guild and registration destination |
| `raidId` | Stable random ID for a scheduled raid, retained after publication |
| `status` | `scheduled` then `published`, only on new scheduled records |
| `published` | `false` until the registration message is successfully sent/recovered |
| `publishAt` | UTC epoch seconds, exactly start minus 86400 |
| `createdAt` | UTC creation seconds; distinguishes immediate scheduling |
| `publishedAt`, `messageId` | Recorded on successful publication/recovery |
| `englishOnly` | Explicit presentation policy for scheduled registration cards |
| `publicationAttempt.startedAt` | Durable pre-send claim, retained on uncertain failure |
| `retryAt` | Earliest UTC retry time after a failure |

Unpublished records use `raidId` as their map key. A successful publication
atomically replaces that entry with the normal Discord message-ID key. The
stable `raidId` remains in the record, so an open share selector survives this
transition. Manual addition and existing registration handlers therefore use
the same live index as ordinary raids. Legacy records with no publication fields
keep their existing meaning and appearance.

The existing 30-second background loop invokes the publication worker on startup
and each tick, before normal raid reminders/table updates. It sends only due,
active raids that have not started. After downtime, overdue future raids open on
the next successful tick. Expired raids never receive a new announcement.
An already-sent message can still be recovered after the start to restore its
normal registration/attendance record.

Reliability measures:

- The entry point atomically acquires `.ankabot.lock` before loading raid data.
  It enforces one JSON-store writer per data directory, including overlapping
  process-manager starts. A dead owner on the same host is reclaimed at startup.
  Live owners, unknown hosts, or unreadable lock data fail closed.
- Each worker claims a raid synchronously, persists its attempt before sending,
  and rechecks the current record after asynchronous channel/history lookups.
- Raid writes flush the temporary file and atomically rename it. Failed new
  records, commits, and deletions restore the prior in-memory index. Corrupt raid
  JSON stops startup rather than silently replacing saved raids with an empty file.
- Discord sends use a stable nonce with `enforceNonce`. Because Discord only
  deduplicates nonces for a short window, a persisted uncertain attempt is also
  reconciled against paginated channel history using its bot-authored footer
  marker. A failed history lookup never falls through to a blind send.
- Failures are logged and retried no sooner than 60 seconds later. Missing
  channels/permissions remain pending until corrected or the start passes.
- Unpublished records are excluded from the old reminder/message-verification
  path and the localization migration script. Existing T−30/T−15/T−5/start,
  attendance, PNG, equipment, and reserve behavior continues after publication.

Discord's nonce window and embed limits are documented in its
[message API reference](https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx).

## Registration and EC2 restart

Commands are registered globally by the existing `clientReady` handler. There
is no separate registration script. Starting/restarting the updated bot registers
`/schedule`, `/share-schedule`, and the additional edit-command option:

```bash
node index.js
```

Run that directly only when the process manager is not already running the bot.
Do not start a second copy for registration. Global command changes can take
time to appear in Discord clients.

For the documented EC2 installation, after placing the reviewed source on the
server, use the existing PM2 process name:

```bash
cd ~/AnkaBot
npm ci --omit=dev
npm run check
npm test
pm2 restart AnkaBot
pm2 logs AnkaBot --lines 100
```

Keep the existing persistent JSON files in this directory and back them up before
updating. No config or environment-variable changes are required. Use one PM2
instance in fork mode; overlapping cluster/reload workers are intentionally
rejected by the store lock. Existing PM2 startup/resurrection configuration must
start the process after an EC2 reboot; this change does not install or change it.

If this installation uses the previously documented systemd service instead:

```bash
sudo systemctl restart ankabot
sudo systemctl status ankabot
```

Use the actual installed service name if different. No AWS deployment, process
restart, bot login, production setting change, or live command registration was
performed during implementation.

## Validation and operational limits

Implementation validation: **193 tests passed, 0 failed** (31 new scheduling and
sharing tests plus 162 existing tests). `npm run check` passes syntax validation
and locale consistency checks; `git diff --check` reports no whitespace errors.

```bash
npm test
npm run check
node --test test/raid_schedule.test.js test/share_schedule.test.js
```

On Windows PowerShell with script execution disabled, use `npm.cmd` in place of
`npm`. Tests use isolated temporary storage and mocked Discord APIs. They cover
the real command integration, JSON reloads, publication timing, ambiguous sends,
failed commits, history pagination, concurrent calls, edits/cancellation, manual
selection visibility, registration compatibility, English-only setup on Turkish
clients, DST validation, sharing pagination/selection preservation, link
validation, read-only sharing, permissions, and command registration/routing.
The existing suite covers the unchanged localization, PNG, inventory, reserve,
reminder, attendance, and manual-notification paths.

Live guild permissions, actual Discord rendering and AWS process-manager behavior
still need a smoke test after deployment. The bot needs View Channel, Send
Messages (Send Messages in Threads in a thread), Embed Links, and Read Message
History; existing PNG features also need Attach Files.

This remains a single-host JSON-backed bot, not a multi-host/cluster deployment.
An uncertain publication requires readable channel history for safe recovery.
The footer marker must be preserved: deleting/editing that marker before an
uncertain send is reconciled removes the recovery evidence. Discord and local
JSON do not support a shared transaction, so arbitrary external message deletion
or storage rollback cannot offer an unconditional exactly-once guarantee.

A large share can partially succeed before a later Discord API failure. Its
session is closed to prevent duplicate confirmation; inspect the channel and
run `/share-schedule` again for any remaining entries. Sharing never changes raid
records, including in this case.

User-entered names/descriptions are preserved verbatim. Discord's native modal
Submit/Cancel chrome and rendered `<t:...>` timestamps follow the viewer's
Discord locale; bots cannot override those client-owned labels. All labels and
messages supplied by these new commands are English.
