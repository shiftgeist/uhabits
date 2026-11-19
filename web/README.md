# Loop Web

Loop Web edits Android Loop databases through a local Node server.
It does not synchronize with Android automatically.
The app does not use JSON backups.
The browser stores a session ID, not database contents.

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
- Select a group name to hide or show its child habits.
- Select a date cell to enter a value.
- Select a group date cell to enter values for its child habits.
- Select the pencil button to edit or delete a habit.
- Use the arrow buttons to view other dates.

The local Node server keeps changes in memory.
Reload reconnects to the database session for this tab.
Export the database before you close the tab or stop the server.
Each tab has its own database session.
The server loses all database sessions when it stops.
Inactive sessions expire. See [server.ts](server.ts) for session limits.
The app does not preserve collapsed groups after you reload the page.

## Export a database

1. Select **Export DB**.
2. Keep the downloaded database file.
3. Transfer that file to Android.
4. Import that file in Android Loop.

Create an Android backup before you import web changes.
Use the modified Android build for databases with groups or categories.
The web interface shows daily values rather than Android frequency summaries.
See [android-backup.ts](android-backup.ts) for database compatibility checks.

## Test

```sh
pnpm --dir web test
pnpm --dir web typecheck
```

The database tests use the native SQLite driver.
The API tests cover separate database sessions and the Android database round trip.
