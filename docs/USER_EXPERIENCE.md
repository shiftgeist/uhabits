# Android user experience

## Scope and evidence

This guide describes user journeys in the Android app.
Android launcher widgets and OS permission screens are platform-specific.
It covers the current source, not a specific published release.
Source inspection supports this guide.
No device session verified visual quality, accessibility, or notification delivery.

Use the source links to check exact labels, available options, and platform conditions.
The [README screenshots](../README.md#screenshots) provide visual examples.
They may not show recent features.

## Experience at a glance

Loop helps users create habits, record daily results, and inspect progress.
The habit list acts as the main workspace.
Users can record results without first opening a detail screen.
Habit details provide charts and historical entries.
Reminders and home screen widgets provide alternative entry points.
Settings provide interface controls and data tools.

### Main journeys

| User goal                      | Route                                               |
| ------------------------------ | --------------------------------------------------- |
| Start a routine                | Intro → habit list → Add habit → type → form → Save |
| Record a result                | Habit list → date cell → checkmark or value         |
| Correct an earlier result      | Habit details → History → date → entry dialog       |
| Review progress                | Habit list → habit name → charts                    |
| Record an alternative activity | Habit list → group → child habit → entry dialog     |
| Pause a habit                  | Habit menu → Archive                                |
| Restore a paused habit         | Show archived habits → habit menu → Unarchive       |
| Protect data                   | Settings → Export full backup                       |
| Analyze data elsewhere         | Settings → Export as CSV                            |

## First use

The intro explains habit creation, daily checkmarks, and progress charts.
The app then leads users to the habit list.
An empty list explains that the user has no active habits.
Add habit starts the first habit journey.

Sources: [intro](../uhabits-android/src/main/java/org/isoron/uhabits/activities/intro/IntroActivity.kt),
[list behavior](../uhabits-core/src/commonMain/kotlin/org/isoron/uhabits/core/ui/screens/habits/list/ListHabitsBehavior.kt),
[empty list](../uhabits-android/src/main/java/org/isoron/uhabits/activities/habits/list/views/EmptyList.kt).

## Create or edit a habit

Select Add habit from the habit list.
Choose Yes or No, Measurable, or Group.

### Yes or No

Use this type for a result such as exercise completed or not completed.
Enter a name.
Choose a color for recognition across the app.
Optionally enter a question, habit notes, and a category.
Choose how often you want to complete the habit.
Use the frequency dialog for routines that do not require daily completion.
Optionally set a reminder time and reminder days.
Select Save to return to the list.

### Measurable

Use this type for quantities such as pages read or distance covered.
Enter a name and a target.
Enter a unit to make values easier to understand.
Choose whether the target means At least or At most.
Choose the target period.
Optionally set a question, habit notes, a category, and a reminder.
Select Save.

The form shows an error when the user leaves the name empty.
The measurable form also requires a target.
The edit action opens the existing habit in the same form.

Sources: [type selector](../uhabits-android/src/main/java/org/isoron/uhabits/activities/habits/edit/HabitTypeDialog.kt),
[habit form](../uhabits-android/src/main/java/org/isoron/uhabits/activities/habits/edit/EditHabitActivity.kt),
[frequency dialog](../uhabits-android/src/main/java/org/isoron/uhabits/activities/common/dialogs/FrequencyPickerDialog.kt).

## Daily use from the habit list

Each habit row combines its identity with date cells for recent results.
Select a regular habit name to open its details.
Use a date cell to record or correct a result for that date.
Landscape orientation can expose more days.

### Checkmarks and values

For Yes or No habits, a short press opens the entry dialog by default.
A long press changes the checkmark directly.
Enable Toggle with short press to exchange these actions.
The entry dialog also accepts a note for the date.
Measurable habits use a number dialog for values and date notes.
Habit notes describe the routine; date notes describe one result.

Optional skip days let users distinguish an intentional pause from a lapse.
Optional question marks distinguish missing data from an explicit lapse.
Consult the interface settings before interpreting these extra states.

Sources: [checkmark interactions](../uhabits-android/src/main/java/org/isoron/uhabits/activities/habits/list/views/CheckmarkButton.kt),
[entry behavior](../uhabits-core/src/commonMain/kotlin/org/isoron/uhabits/core/ui/screens/habits/list/ListHabitsBehavior.kt),
[number dialog](../uhabits-android/src/main/java/org/isoron/uhabits/activities/common/dialogs/NumberDialog.kt),
[interface options](../uhabits-android/src/main/res/xml/preferences.xml).

### Find and organize habits

Use Search to narrow the list.
Use the filter menu to hide archived habits or completed habits.
The completed filter can produce an all-done message instead of habit rows.
Check filters before you conclude that a habit has disappeared.

Choose a sort order from the filter menu.
Use manual order when you want to arrange habits yourself.
Long-press a habit name to enter selection mode.
Drag the habit to change its manual position.
Selection actions support edits, color changes, categories, archive, and delete.
Available actions depend on the selection.
Category labels help users navigate related habits.

Sources: [list menu](../uhabits-android/src/main/res/menu/list_habits.xml),
[selection menu](../uhabits-android/src/main/java/org/isoron/uhabits/activities/habits/list/ListHabitsSelectionMenu.kt),
[list gestures](../uhabits-android/src/main/java/org/isoron/uhabits/activities/habits/list/views/HabitCardListController.kt),
[categories](../uhabits-android/src/main/java/org/isoron/uhabits/activities/habits/list/views/CategoryView.kt).

## Groups: alternative ways to complete a routine

Choose Group when several activities can satisfy one routine.
For example, a Sport group can contain Gym, Run, and Swim.
Create the child habits first.
Select those habits in the group form.
The selector excludes other groups.
The group form does not offer a reminder or frequency control.

Select a group name to open its daily entry dialog, rather than regular habit details.
The dialog shows active child habits for the selected date.
Tap a child habit to edit its result.
Long-press a child habit to open its details.
Use Edit group to change the group.
An empty group explains how to create and select child habits.

Sources: [group form](../uhabits-android/src/main/java/org/isoron/uhabits/activities/habits/edit/EditHabitActivity.kt),
[group entry dialog](../uhabits-android/src/main/java/org/isoron/uhabits/activities/habits/list/ListHabitsScreen.kt),
[group guidance](../uhabits-android/src/main/res/values/group_strings.xml).

## Review progress and correct history

Open a regular habit to inspect its progress cards.
The screen uses the habit color to preserve context.
Yes or No habits show an overview card.
Measurable habits show a target card instead.
Other cards cover habit strength, history, streaks, frequency, totals, and habit notes.
Card content depends on the habit and its data.

Use habit strength to inspect consistency over time.
Use streaks to inspect consecutive progress.
Use History to inspect individual dates.
Select a historical date to edit its result.
Yes or No dates follow the short-press preference from the habit list.
Measurable dates open the number dialog.
History also offers a dedicated editor.

The habit menu provides Edit, Export, Archive, Unarchive, and Delete actions.
The current habit state controls which archive action appears.

Sources: [detail screen](../uhabits-android/src/main/java/org/isoron/uhabits/activities/habits/show/ShowHabitView.kt),
[progress cards](../uhabits-core/src/commonMain/kotlin/org/isoron/uhabits/core/ui/screens/habits/show/views),
[history interactions](../uhabits-core/src/commonMain/kotlin/org/isoron/uhabits/core/ui/screens/habits/show/views/HistoryCard.kt),
[detail menu](../uhabits-android/src/main/java/org/isoron/uhabits/activities/habits/show/ShowHabitMenu.kt).

## Reminders

Configure reminders within an individual habit form.
The notification shows the habit name and its question.
It uses a fallback question when the habit has none.
Yes or No notifications offer Yes and No actions.
Measurable notifications offer Enter to open a value dialog.
Select the notification body to open the habit.

Notification actions differ by Android version.
In particular, the app only adds Later on versions before Android 12.
Android notification permission and alarm access can affect the experience.
Use Settings to adjust reminder sound or open notification customization.
Sticky notifications prevent a swipe from removing a reminder.

Sources: [notification actions](../uhabits-android/src/main/java/org/isoron/uhabits/notifications/AndroidNotificationTray.kt),
[permission flow](../uhabits-android/src/main/java/org/isoron/uhabits/activities/habits/list/ListHabitsActivity.kt),
[alarm access](../uhabits-android/src/main/java/org/isoron/uhabits/intents/IntentScheduler.kt),
[reminder preferences](../uhabits-android/src/main/res/xml/preferences.xml).

## Home screen widgets

Add a Loop widget through the Android launcher.
Choose habits through the widget habit selector.
Available widgets cover checkmarks, habit strength, history, frequency, streaks, and targets.
Checkmark widgets provide a direct route to daily records.
Chart widgets provide progress at a glance.
The habit selector can restrict choices to a compatible habit type.
An empty selector explains when no compatible habits exist.
Use Widget opacity in Settings to adjust the background appearance.

Sources: [widget implementations](../uhabits-android/src/main/java/org/isoron/uhabits/widgets),
[habit selector](../uhabits-android/src/main/java/org/isoron/uhabits/widgets/activities/HabitPickerDialog.kt).

## Archive or delete

Archive a habit when you want to stop active use without deleting its records.
Show archived habits through the filter menu to find it again.
Use Unarchive to return it to active use.

Delete removes the habit permanently.
The confirmation dialog warns that the user cannot undo this action.
Export a full backup before you delete records that you might need later.

Sources: [selection actions](../uhabits-core/src/commonMain/kotlin/org/isoron/uhabits/core/ui/screens/habits/list/ListHabitsSelectionMenuBehavior.kt),
[delete confirmation](../uhabits-android/src/main/java/org/isoron/uhabits/activities/common/dialogs/ConfirmDeleteDialog.kt).

## Data ownership and recovery

Open Settings to access the data tools.
Choose Export full backup for a file that Loop can import later.
Choose Export as CSV for spreadsheet analysis.
Do not treat CSV as a restorable Loop backup.
Use Import data to select a supported backup or migration file.
The app reports success, failure, or an unrecognized file.
Use Select public backup folder to choose an accessible backup destination.

Settings also offers Repair database and Generate bug report.
Review a report before you share it outside your device.

Sources: [data actions](../uhabits-android/src/main/java/org/isoron/uhabits/activities/habits/list/ListHabitsScreen.kt),
[backup folder control](../uhabits-android/src/main/java/org/isoron/uhabits/activities/settings/SettingsFragment.kt),
[supported imports](../uhabits-core/src/commonMain/kotlin/org/isoron/uhabits/core/io/GenericImporter.kt),
[data guidance](../uhabits-android/src/main/res/values/strings.xml).

## Personalize the experience

Use the main menu to switch the dark theme.
Interface settings include pure black backgrounds, dynamic colors, and animation controls.
The app hides dynamic colors when the device cannot support them.
Other controls adjust date order and the first weekday.
The extended-day option supports users who complete routines after midnight.
Follow its restart guidance after a change.

Settings also links to Help & FAQ, app ratings, and About.
About provides project information and contributor links.
External links can leave the app.

Sources: [preferences](../uhabits-android/src/main/res/xml/preferences.xml),
[conditional preferences](../uhabits-android/src/main/java/org/isoron/uhabits/activities/settings/SettingsFragment.kt),
[About](../uhabits-android/src/main/java/org/isoron/uhabits/activities/about/AboutScreen.kt).

## Device checks for a later UX review

This guide does not claim that these checks pass.

- Complete first use with no existing habits.
- Create each habit type.
- Record and correct results through each available entry point.
- Repeat checkmark actions with the short-press option enabled.
- Test groups with no children and with archived children.
- Check filtered empty states before and after the last daily result.
- Check text size, screen readers, contrast, and touch targets.
- Check portrait and landscape layouts.
- Deny notification permission, then restore it through Android settings.
- Check reminder delivery across supported Android versions.
- Add each widget through the device launcher.
- Export a full backup before you test import on a separate installation.
- Check file errors and cancellation without risking the original records.
