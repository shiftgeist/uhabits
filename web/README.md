# Loop Web

Loop Web edits Android Loop databases through a local Node server.
It does not synchronize with Android automatically.
The app does not use JSON backups.
The browser stores a session ID, not database contents.
The server saves the database on this computer.

## Install and run

Use the Node version from [mise.toml](../mise.toml).
Install pnpm.
Install dependencies from the repository root:

```sh
pnpm --dir web install
mise run web
```

Keep the release-age policy in [pnpm-workspace.yaml](pnpm-workspace.yaml).
If pnpm blocks the native build, run these commands:

```sh
pnpm --dir web approve-builds better-sqlite3
pnpm --dir web rebuild better-sqlite3
```

See [package.json](package.json) for the SQLite dependencies.
Open the address that the server prints.

## Open a database

1. Export a full backup from Android Loop.
2. Transfer the database to this computer.
3. Select **Import DB**.
4. Choose the database file.

The browser sends a copy of the database to the local Node server.
The app does not change the original file.
Export the current database before you import another database.

## Edit habits

- Select **New habit** to create a habit.
- Choose a group in the habit editor to assign a child habit.
- Select a habit name to open its notes and history.
- Select a group name to enter results for its child habits.
- Select the arrow beside a group name to hide or show its child habits.
- Select a date cell to enter a value.
- Select a group date cell to enter values for its child habits.
- Select the pencil button to edit or delete a habit.
- Use the arrow buttons to view other dates.
- Use Search, Category, or the filters to find habits.
- Select habit checkboxes to apply actions to several habits.
- Use Settings to change the theme or entry preferences.

The local Node server saves each change before it confirms success.
Reload reconnects to the database for this tab.
New tabs reopen the most recent database.
Existing tabs retain their current database.
Web rejects stale edits from another tab.
Reload before you repeat an edit after a conflict.
The server restores saved databases after a restart.
Keep the server data directory when you upgrade.
Set `LOOP_DATA_DIR` to choose another data directory.
See [server.ts](src/server.ts) for the default destination and session limits.
Run only one server for each data directory.
The app does not preserve collapsed groups after you reload the page.

## Export a database

1. Select **Export DB**.
2. Keep the downloaded database file.
3. Transfer that file to Android.
4. Import that file in Android Loop.

Create an Android backup before you import web changes.
Use the modified Android build for databases with groups or categories.
The web interface shows daily values rather than Android frequency summaries.
See [android-backup.ts](src/android-backup.ts) for database compatibility checks.

## Export CSV

Select **Export CSV** for spreadsheet analysis.
The habit details also offer this action for one habit.
CSV cannot restore a Loop database.
Use **Export DB** for a restorable backup.

## Browser reminders

Set a reminder time in the habit editor.
Open **Settings**.
Select **Enable browser reminders**.
Allow notifications when your browser asks.
Keep the local server running after you close the page.
Keep the same server address and port.

The server sends encrypted prompts through the browser's push service.
The browser or operating system can delay delivery.
The server does not replay reminders after downtime.
Open Loop after you change your time zone.
Enable browser reminders again to update your time zone.
Select **Disable browser reminders** to stop reminders for this database on this device.
Boolean notifications offer **Yes** and **No** actions when the browser supports notification actions.
Numeric notifications offer **Enter** to open the entry dialog.
The server checks a scoped credential before it accepts a notification action.
Reload an open page after a notification saves an entry.

Select **Extend the day until 03:00** in Settings to use the previous habit date before the day boundary.
See [day.ts](src/day.ts) for the boundary rule.

Back up the complete server data directory to preserve reminder credentials.
Do not share this directory because it contains private keys and subscription credentials.
See [reminders.ts](src/reminders.ts) for push service compatibility and delivery rules.

## Android parity

[Android user experience](../docs/USER_EXPERIENCE.md) defines the parity target.
Web does not yet meet that target.

Web reuses the Kotlin core to avoid separate habit rules for Android and the browser.
Web-specific Kotlin adapters use separate files to reduce conflicts when we merge upstream updates.
See [the core bridge](../uhabits-core/src/jsMain/kotlin/WebHabits.kt) for shared commands and queries.
See [the metrics bridge](../uhabits-core/src/jsMain/kotlin/WebMetrics.kt) for progress calculations.
The Kotlin bridge preserves web state and Android metadata across these calls.
Web keeps its spreadsheet CSV format because Android exports a different ZIP archive.

### Reuse policy

Keep Kotlin responsible for behavior rather than recreate the core in TypeScript.
Maximize reuse from the original core and Android code.
Do not modify upstream core or Android files for the web app.
Keep web adaptations in separate adapter files.
This goal includes file operations, imports, exports, date rules, time calculations, and utilities.
Reuse existing implementations before adding web equivalents.

Keep TypeScript responsible for the web interface and platform adapters.
Adapters connect web capabilities to Kotlin behavior; they must not duplicate domain rules.
Expose more Kotlin operations through a bridge when the current bridge lacks an operation.
Adapt only platform boundaries when an existing implementation requires browser, JVM, or Android APIs.
Call reusable Kotlin behavior through adapters when platform dependencies permit reuse.
Keep Android-specific behavior on Android when it requires Android services.

This policy defines the reuse goal, not the current coverage.
Use the Kotlin/JS bridge from the browser and Node.
The bridge does not require Bun or a JVM process.
Keep JVM-dependent behavior outside the JS bridge until an adapter can reuse it without upstream changes.
Provide platform adapters for capabilities that require Node or browser APIs.
Neither runtime can directly execute code that requires Android services.

See [the state adapter](../uhabits-core/src/jsMain/kotlin/WebState.kt) for web records and the core palette.
See [the date bridge](../uhabits-core/src/jsMain/kotlin/WebDates.kt) for the habit date.
List views use the core order instead of locale-specific JavaScript comparisons.
The Node adapter still owns SQLite access and Android database compatibility checks.
The web CSV format remains a separate consumer format.

These journeys still need work:

- Use widget equivalents outside the main habit list.
- Import migration files from other habit apps.
- Repair a database or generate a diagnostic report.
- Complete an introductory walkthrough.
- Configure animation preferences.

The habit editor also saves reminder settings for Android.
Browser controls use context menus instead of Android long-press gestures.
Use the context menu on a date cell for the alternative entry action.

## Test

```sh
pnpm --dir web test
pnpm --dir web typecheck
```

The database tests use the native SQLite driver.
The API tests cover separate database sessions and the Android database round trip.
