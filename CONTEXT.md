# Habit Tracker

Loop helps people record habit activity over time.

## Language

### Habits

**Habit**:
A recurring activity or limit that a person wants to track.

**Boolean habit**:
A habit with a yes-or-no activity record for each day.
_Avoid_: Binary habit

**Numeric habit**:
A habit with measured activity and a target in a chosen unit.
_Avoid_: Numerical habit

**Group habit**:
A habit that contains child habits of Boolean or numeric types.
_Avoid_: Meta habit, category

**Child habit**:
An independent habit that belongs to one group habit.
_Avoid_: Sub habit, option

**Category**:
A text label that classifies a habit without a parent-child relationship.
_Avoid_: Group habit

**Archived habit**:
A habit that the person retains outside the usual active habit list.
_Avoid_: Deleted habit

### Activity and completion

**Original entry**:
A daily habit record with a recorded value and optional notes.
_Avoid_: Computed entry

**Computed entry**:
A daily habit result that accounts for original entries and the habit schedule.
_Avoid_: Original entry

**Repetition**:
An occurrence of habit activity.
_Avoid_: Completion

**Completion**:
The result that indicates whether a day meets the habit rules.
_Avoid_: Repetition, score

**Automatic completion**:
A Boolean habit result that covers a day without recorded activity under the habit schedule.
_Avoid_: Manual repetition

**Skipped day**:
A day that the person marks as not applicable to a habit.
_Avoid_: Unknown day, missed day

**Unknown day**:
A day without a recorded habit value.
_Avoid_: Missed day, skipped day

**Notes**:
Optional text that accompanies a daily habit record.

### Schedule and progress

**Frequency**:
The required number of repetitions over a number of days.

**Target**:
The amount that a numeric habit requires or permits over its period.

**Target type**:
The direction of a numeric target: at least or at most.

**Period**:
The day, week, or month over which the app evaluates numeric completion.

**Score**:
A measure of habit strength that reflects activity over time.
_Avoid_: Streak, completion

**Streak**:
A continuous sequence of days that meet the habit completion rules.
_Avoid_: Score, consecutive repetitions

**Reminder**:
A habit prompt with a chosen time and weekdays.
_Avoid_: Habit schedule

**Snooze**:
A temporary delay before the next reminder prompt.
