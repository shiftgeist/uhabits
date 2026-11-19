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
Notification clicks open Loop.
Web does not yet support direct entry from notifications.

Back up the complete server data directory to preserve reminder credentials.
Do not share this directory because it contains private keys and subscription credentials.
See [reminders.ts](src/reminders.ts) for push service compatibility and delivery rules.

## Android parity

[Android user experience](../docs/USER_EXPERIENCE.md) defines the parity target.
Web does not yet meet that target.

These journeys still need work:

- Review Android habit strength, streaks, frequency charts, and totals.
- Evaluate completion with Android frequency rules and numeric periods.
- Enter results directly from reminder notifications.
- Use widget equivalents outside the main habit list.
- Import migration files from other habit apps.
- Repair a database or generate a diagnostic report.
- Complete an introductory walkthrough.
- Configure the first weekday, extended day, or animation preferences.

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
