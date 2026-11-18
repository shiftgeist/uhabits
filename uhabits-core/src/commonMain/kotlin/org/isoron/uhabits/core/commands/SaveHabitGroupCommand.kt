package org.isoron.uhabits.core.commands

import org.isoron.uhabits.core.models.HabitList

data class SaveHabitGroupCommand(
    val saveHabit: Command,
    val habitList: HabitList,
    val groupUuid: String,
    val childIds: Set<Long>
) : Command {
    override fun run() {
        require(childIds.all { habitList.getById(it)?.isGroup == false })
        saveHabit.run()
        val group = requireNotNull(habitList.getByUUID(groupUuid))
        require(group.isGroup)
        val changed = habitList.filter { it.parentUuid == groupUuid || it.id in childIds }
        for (child in changed) {
            child.parentUuid = if (child.id in childIds) groupUuid else null
        }
        habitList.update(changed)
        habitList.recomputeGroups()
    }
}
