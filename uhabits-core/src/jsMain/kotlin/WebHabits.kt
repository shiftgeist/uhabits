@file:OptIn(ExperimentalJsExport::class)

import org.isoron.platform.time.resetToday
import org.isoron.platform.time.setToday
import org.isoron.platform.time.computeToday
import org.isoron.uhabits.core.commands.CreateHabitCommand
import org.isoron.uhabits.core.commands.CreateRepetitionCommand
import org.isoron.uhabits.core.commands.DeleteHabitsCommand
import org.isoron.uhabits.core.commands.EditHabitCommand
import org.isoron.uhabits.core.models.Entry
import org.isoron.uhabits.core.models.EntryList
import org.isoron.uhabits.core.models.Frequency
import org.isoron.uhabits.core.models.Habit
import org.isoron.uhabits.core.models.HabitMatcher
import org.isoron.uhabits.core.models.HabitType
import org.isoron.uhabits.core.models.NumericalHabitType
import org.isoron.uhabits.core.models.ScoreList
import org.isoron.uhabits.core.models.StreakList
import org.isoron.uhabits.core.models.memory.MemoryHabitList
import org.isoron.uhabits.core.models.memory.MemoryModelFactory

private fun readWebHabit(row: dynamic): Habit {
    val habit = Habit(
        uuid = row.id as String,
        name = row.name as String,
        parentUuid = row.parentId as String?,
        position = row.position as Int,
        category = row.category as String,
        description = row.description as String,
        question = row.question as String,
        unit = row.unit as String,
        isArchived = row.archived as Boolean,
        frequency = Frequency(row.numerator as Int, row.denominator as Int),
        targetType = if (row.targetType == 1) NumericalHabitType.AT_MOST else NumericalHabitType.AT_LEAST,
        targetValue = row.target as Double,
        type = when (row.type as String) {
            "number" -> HabitType.NUMERICAL
            "group" -> HabitType.GROUP
            else -> HabitType.YES_NO
        },
        originalEntries = EntryList(),
        computedEntries = EntryList(),
        scores = ScoreList(),
        streaks = StreakList()
    )
    for (record in row.records as Array<dynamic>) {
        habit.originalEntries.add(Entry(webDate(record.date as String), record.value as Int, record.notes as String))
    }
    return habit
}

internal fun readWebHabits(rows: dynamic, recompute: Boolean = true): MemoryHabitList {
    val habits = MemoryHabitList()
    for (row in rows as Array<dynamic>) {
        val habit = readWebHabit(row)
        if (recompute) habit.recompute()
        habits.add(habit)
    }
    if (recompute) habits.recomputeGroups()
    return habits
}

@JsExport
fun queryWebHabits(input: String): String {
    val data = JSON.parse<dynamic>(input)
    if (data.operation == "children") {
        val habits = readWebHabits(data.habits, recompute = false)
        val group = habits.getByUUID(data.id as String) ?: return "[]"
        return JSON.stringify(habits.getChildren(group).map { it.uuid }.toTypedArray())
    }
    val date = webDate(data.today as String)
    if (data.operation == "activity") {
        val habits = readWebHabits(data.habits, recompute = false)
        val habit = habits.getByUUID(data.id as String) ?: return "0"
        val value = habit.originalEntries.get(date).value
        val activity = when {
            habit.isGroup -> if (habits.hasActivityOn(habit, date)) 1.0 else 0.0
            habit.isNumerical && value != Entry.UNKNOWN && value != Entry.SKIP -> value / 1000.0
            habits.hasActivityOn(habit, date) -> 1.0
            else -> 0.0
        }
        return JSON.stringify(activity)
    }
    setToday(date)
    try {
        val habits = readWebHabits(data.habits)
        val output = js("Object.create(null)")
        val filter = data.filter
        val matcher = HabitMatcher(
            isArchivedAllowed = filter == null || filter.showArchived == true,
            searchQuery = if (filter == null) "" else (filter.search as String?) ?: ""
        )
        for (habit in habits) {
            val item = js("({})")
            item.completed = habit.isCompletedOn(date)
            val category = if (filter == null) null else filter.category as String?
            item.matches = matcher.matches(habit) && (category.isNullOrEmpty() || habit.category == category)
            output[habit.uuid] = item
        }
        return JSON.stringify(output)
    } finally {
        resetToday()
    }
}

@JsExport
fun mutateWebHabits(input: String): String {
    val data = JSON.parse<dynamic>(input)
    setToday(computeToday(0, 0))
    try {
        return mutateWebHabitsData(data)
    } finally {
        resetToday()
    }
}

private fun mutateWebHabitsData(data: dynamic): String {
    val state = data.state
    val habits = readWebHabits(data.habits, recompute = false)
    when (data.operation as String) {
        "save" -> {
            val modified = readWebHabit(data.habit)
            val existing = habits.getByUUID(modified.uuid)
            if (existing == null) {
                CreateHabitCommand(MemoryModelFactory(), habits, modified).run()
                state.habits.push(data.draft)
            } else {
                require(existing.type == modified.type)
                EditHabitCommand(habits, requireNotNull(existing.id), modified).run()
                state.habits = (state.habits as Array<dynamic>).map { row ->
                    if (row.id == modified.uuid) data.draft else row
                }.toTypedArray()
            }
            val saved = requireNotNull(habits.getByUUID(modified.uuid))
            data.draft.name = saved.name
            data.draft.parentId = saved.parentUuid
            data.draft.target = saved.targetValue
            data.draft.unit = saved.unit
        }
        "delete" -> {
            val selected = habits.getByUUID(data.id as String)
            DeleteHabitsCommand(habits, listOfNotNull(selected)).run()
            state.habits = (state.habits as Array<dynamic>).filter { habits.getByUUID(it.id as String) != null }.map { row ->
                row.parentId = requireNotNull(habits.getByUUID(row.id as String)).parentUuid
                row
            }.toTypedArray()
            state.collapsedIds = (state.collapsedIds as Array<String>).filter { it != data.id }.toTypedArray()
        }
        "record" -> {
            val habit = requireNotNull(habits.getByUUID(data.id as String))
            val record = data.record
            CreateRepetitionCommand(habits, habit, webDate(data.day as String), record.value as Int, record.notes as String).run()
            val saved = habit.originalEntries.get(webDate(data.day as String))
            val row = (data.next.habits as Array<dynamic>).first { it.id == habit.uuid }
            if (js("Object.prototype.hasOwnProperty.call(row.entries, data.day)") as Boolean) {
                row.entries[data.day] = when {
                    saved.value == Entry.UNKNOWN || saved.value == Entry.SKIP -> 0.0
                    habit.isNumerical -> row.entries[data.day]
                    saved.value == Entry.YES_MANUAL -> 1.0
                    else -> 0.0
                }
            }
            if (js("Object.prototype.hasOwnProperty.call(row.notes, data.day)") as Boolean) {
                row.notes[data.day] = saved.notes
            }
            return JSON.stringify(data.next)
        }
        else -> error("Unknown habit command")
    }
    return JSON.stringify(state)
}
