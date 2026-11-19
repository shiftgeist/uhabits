import org.isoron.platform.time.LocalDate
import org.isoron.uhabits.core.models.Entry
import org.isoron.uhabits.core.models.Habit
import org.isoron.uhabits.core.models.HabitList

internal fun HabitList.hasActivityOn(habit: Habit, date: LocalDate): Boolean {
    if (habit.isGroup) return getChildren(habit).any { hasActivityOn(it, date) }
    val value = habit.originalEntries.get(date).value
    return if (habit.isNumerical) value > 0 && value != Entry.SKIP else value == Entry.YES_MANUAL
}
