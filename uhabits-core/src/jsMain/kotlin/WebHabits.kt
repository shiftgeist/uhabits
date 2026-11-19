@file:OptIn(ExperimentalJsExport::class)

import org.isoron.platform.time.computeToday
import org.isoron.platform.time.resetToday
import org.isoron.platform.time.setToday
import org.isoron.uhabits.core.commands.CreateHabitCommand
import org.isoron.uhabits.core.commands.CreateRepetitionCommand
import org.isoron.uhabits.core.commands.DeleteHabitsCommand
import org.isoron.uhabits.core.commands.EditHabitCommand
import org.isoron.uhabits.core.commands.ReorderHabitCommand
import org.isoron.uhabits.core.commands.ReorderTarget
import org.isoron.uhabits.core.models.Entry
import org.isoron.uhabits.core.models.EntryList
import org.isoron.uhabits.core.models.Frequency
import org.isoron.uhabits.core.models.Habit
import org.isoron.uhabits.core.models.HabitList
import org.isoron.uhabits.core.models.HabitMatcher
import org.isoron.uhabits.core.models.HabitType
import org.isoron.uhabits.core.models.NumericalHabitType
import org.isoron.uhabits.core.models.PaletteColor
import org.isoron.uhabits.core.models.ScoreList
import org.isoron.uhabits.core.models.StreakList
import org.isoron.uhabits.core.models.memory.MemoryHabitList
import org.isoron.uhabits.core.models.memory.MemoryModelFactory
import kotlin.math.floor

private fun readWebHabit(row: dynamic): Habit {
    val habit = Habit(
        uuid = row.id as String,
        name = row.name as String,
        parentUuid = row.parentId as String?,
        position = row.position as Int,
        color = PaletteColor(webNearestColorIndex(row.color as String)),
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
    for ((position, row) in (rows as Array<dynamic>).withIndex()) {
        val habit = readWebHabit(webHabitData(row, position))
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
        val habits = readWebHabits(data.state.habits, recompute = false)
        val group = habits.getByUUID(data.id as String) ?: return "[]"
        return JSON.stringify(habits.getChildren(group).map { it.uuid }.toTypedArray())
    }
    val date = if (data.today == null) computeToday(0, 0) else webDate(data.today as String)
    if (data.operation == "activity") {
        val habits = readWebHabits(data.state.habits, recompute = false)
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
        val recompute = data.operation != "list" || data.filter?.hideCompleted == true || data.filter?.sort == "completion"
        val habits = readWebHabits(data.state.habits, recompute)
        if (data.operation == "list") return webHabitList(data, habits)
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
    val habits = readWebHabits(state.habits, recompute = false)
    when (data.operation as String) {
        "save" -> {
            val modified = readWebHabit(webHabitData(data.draft, habits.size()))
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
            val day = data.day as String
            val row = (state.habits as Array<dynamic>).first { it.id == habit.uuid }
            val value = data.value
            val encoded = when (value) {
                null, "skip" -> if (value == null) Entry.UNKNOWN else Entry.SKIP
                else -> {
                    require(jsTypeOf(value) == "number")
                    val number = value as Double
                    require(number.isFinite() && number >= 0)
                    require(habit.isNumerical || number == 0.0 || number == 1.0)
                    val scaled = floor(number * 1000 + 0.5)
                    require(!habit.isNumerical || scaled <= Int.MAX_VALUE)
                    if (habit.isNumerical) scaled.toInt() else if (number == 1.0) Entry.YES_MANUAL else Entry.NO
                }
            }
            val previousNote = if (row.notes != null) row.notes[day] ?: "" else ""
            val note = if (value == null) data.note ?: "" else data.note ?: previousNote
            require(jsTypeOf(note) == "string")
            CreateRepetitionCommand(habits, habit, webDate(day), encoded, note as String).run()
            val saved = habit.originalEntries.get(webDate(day))
            row.notes = row.notes ?: js("Object.create(null)")
            row.skippedDays = ((row.skippedDays as Array<String>?)?.filter { it != day }.orEmpty() +
                if (saved.value == Entry.SKIP) listOf(day) else emptyList()).toTypedArray()
            row.unknownDays = ((row.unknownDays as Array<String>?)?.filter { it != day }.orEmpty() +
                if (saved.value == Entry.UNKNOWN && saved.notes.isNotEmpty()) listOf(day) else emptyList()).toTypedArray()
            row.editedDays = ((row.editedDays as Array<String>?)?.toList().orEmpty() + day).distinct().toTypedArray()
            if (saved.value == Entry.UNKNOWN && saved.notes.isEmpty()) {
                js("delete row.entries[day]")
                js("delete row.notes[day]")
            } else {
                row.entries[day] = when {
                    saved.value == Entry.UNKNOWN || saved.value == Entry.SKIP -> 0.0
                    habit.isNumerical -> value
                    saved.value == Entry.YES_MANUAL -> 1.0
                    else -> 0.0
                }
                if (data.note != null || value == null) row.notes[day] = saved.notes
            }
        }
        "move" -> {
            val selected = habits.getByUUID(data.id as String) ?: return JSON.stringify(state)
            val direction = data.direction as Int
            require(direction == -1 || direction == 1)
            val siblings = habits.filter { it.parentUuid == selected.parentUuid }
            val target = siblings.getOrNull(siblings.indexOf(selected) + direction)
            if (target != null) {
                ReorderHabitCommand(habits, selected,
                    if (direction < 0) ReorderTarget.Before(target) else ReorderTarget.After(target), selected.category).run()
                val rows = (state.habits as Array<dynamic>).associateBy { it.id as String }
                state.habits = habits.sortedBy { it.position }.map { rows.getValue(it.uuid!!) }.toTypedArray()
            }
        }
        else -> error("Unknown habit command")
    }
    return JSON.stringify(state)
}

private fun webHabitList(data: dynamic, habits: MemoryHabitList): String {
    val filter = data.filter
    habits.primaryOrder = when (filter?.sort as String?) {
        "name" -> HabitList.Order.BY_NAME_ASC
        "color" -> HabitList.Order.BY_COLOR_ASC
        "completion" -> HabitList.Order.BY_STATUS_DESC
        else -> HabitList.Order.BY_POSITION
    }
    val collapsed = (data.state.collapsedIds as Array<String>).toSet()
    val visible = habits.filter { it.parentUuid == null }.flatMap { habit ->
        listOf(habit) + if (habit.isGroup && habit.uuid !in collapsed) habits.getChildren(habit) else emptyList()
    }
    val visibleIds = visible.map { it.uuid }.toSet()
    val matcher = HabitMatcher(
        isArchivedAllowed = filter == null || filter.showArchived == true,
        isCompletedAllowed = filter == null || filter.hideCompleted != true,
        searchQuery = (filter?.search as String?) ?: ""
    )
    val category = filter?.category as String?
    val matched = habits.getFiltered(matcher).filter {
        it.uuid in visibleIds && (category.isNullOrEmpty() || it.category == category)
    }
    val ordered = if (filter?.sort == null || filter.sort == "manual") {
        val ids = matched.map { it.uuid }.toSet()
        visible.filter { it.uuid in ids }
    } else matched
    return JSON.stringify(ordered.map { it.uuid }.toTypedArray())
}
