package org.isoron.uhabits.core.models

import org.isoron.platform.time.getToday
import org.isoron.uhabits.core.BaseUnitTest
import org.isoron.uhabits.core.commands.CreateHabitCommand
import org.isoron.uhabits.core.commands.CreateRepetitionCommand
import org.isoron.uhabits.core.commands.DeleteHabitsCommand
import org.isoron.uhabits.core.commands.EditHabitCommand
import org.isoron.uhabits.core.commands.SaveHabitGroupCommand
import org.isoron.uhabits.core.ui.screens.habits.list.ListHabitsPresenter
import org.isoron.uhabits.core.ui.views.LightTheme
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HabitGroupTest : BaseUnitTest() {
    @Test
    fun testChildrenUseAlphabeticalOrderIgnoringCase() {
        val group = addHabit("Sport", HabitType.GROUP)
        val running = addHabit("Running", HabitType.NUMERICAL, group)
        val yoga = addHabit("yoga", parent = group)
        val cycling = addHabit("cycling", parent = group)
        addHabit("Other")

        assertEquals(listOf(cycling, running, yoga), habitList.getChildren(group))
        assertEquals(
            listOf(group.id, cycling.id, running.id, yoga.id),
            state().items.take(4).map { it.id }
        )
    }

    @Test
    fun testMixedChildrenCompleteGroupWithAnyActivity() {
        val group = addHabit("Sport", HabitType.GROUP)
        val gym = addHabit("Gym", parent = group)
        val running = addHabit("Running", HabitType.NUMERICAL, group)
        running.targetValue = 30.0
        val today = getToday()

        habitList.recomputeGroups()
        assertFalse(group.isCompletedToday())
        CreateRepetitionCommand(habitList, running, today, 10000, "").run()
        assertFalse(running.isCompletedToday())
        assertTrue(group.isCompletedToday())
        assertTrue(group.originalEntries.getKnown().isEmpty())

        CreateRepetitionCommand(habitList, running, today, 0, "").run()
        assertFalse(group.isCompletedToday())
        CreateRepetitionCommand(habitList, gym, today, Entry.YES_MANUAL, "").run()
        assertTrue(group.isCompletedToday())
        CreateRepetitionCommand(habitList, gym, today, Entry.SKIP, "").run()
        assertFalse(group.isCompletedToday())
        CreateRepetitionCommand(habitList, running, today, Entry.SKIP, "").run()
        assertFalse(group.isCompletedToday())
    }

    @Test
    fun testGroupUsesOriginalEntriesNotAutomaticCompletions() {
        val group = addHabit("Sport", HabitType.GROUP)
        val gym = addHabit("Gym", parent = group)
        gym.frequency = Frequency(1, 7)
        gym.originalEntries.add(Entry(getToday().minus(1), Entry.YES_MANUAL))
        gym.recompute()
        habitList.recomputeGroups()
        assertFalse(group.isCompletedToday())
        assertTrue(group.isCompletedOn(getToday().minus(1)))
    }

    @Test
    fun testOverviewKeepsChildrenTogetherWithoutLosingFilteredChildren() {
        val running = addHabit("Running", HabitType.NUMERICAL)
        val other = addHabit("Read")
        val group = addHabit("Sport", HabitType.GROUP)
        val gym = addHabit("Gym", parent = group)
        running.parentUuid = group.uuid
        assertEquals(listOf(other.id, group.id, gym.id, running.id), state().items.map { it.id })
        val childCard = state().items.first { it.id == running.id }
        assertTrue(childCard.isChild)
        assertEquals(listOf(running.id), state(HabitMatcher(searchQuery = "Running")).items.map { it.id })
        habitList.remove(group)
        assertEquals(3, state().items.size)
        assertTrue(state().items.none { it.isChild })
    }

    @Test
    fun testSaveGroupAssignsAndRemovesChildren() {
        val gym = addHabit("Gym")
        val running = addHabit("Running", HabitType.NUMERICAL)
        val model = modelFactory.buildHabit().apply {
            name = "Sport"
            type = HabitType.GROUP
        }
        SaveHabitGroupCommand(
            CreateHabitCommand(modelFactory, habitList, model), habitList, model.uuid!!, setOf(gym.id!!)
        ).run()
        assertEquals(model.uuid, gym.parentUuid)
        assertNull(running.parentUuid)
        val group = habitList.getByUUID(model.uuid)!!
        SaveHabitGroupCommand(
            EditHabitCommand(habitList, group.id!!, group.copy()),
            habitList, group.uuid!!, setOf(running.id!!)
        ).run()
        assertNull(gym.parentUuid)
        assertEquals(group.uuid, running.parentUuid)
    }

    @Test
    fun testDeleteGroupPreservesChildrenAndClearsMembership() {
        val group = addHabit("Sport", HabitType.GROUP)
        val gym = addHabit("Gym", parent = group)
        CreateRepetitionCommand(habitList, gym, getToday(), Entry.YES_MANUAL, "Workout").run()
        DeleteHabitsCommand(habitList, listOf(group)).run()
        assertEquals(gym, habitList.getById(gym.id!!))
        assertNull(gym.parentUuid)
        assertEquals("Workout", gym.originalEntries.get(getToday()).notes)
    }

    @Test
    fun testDeleteChildUpdatesGroupCompletion() {
        val group = addHabit("Sport", HabitType.GROUP)
        val gym = addHabit("Gym", parent = group)
        CreateRepetitionCommand(habitList, gym, getToday(), Entry.YES_MANUAL, "").run()
        DeleteHabitsCommand(habitList, listOf(gym)).run()
        assertFalse(group.isCompletedToday())
    }

    @Test
    fun testGroupRejectsDirectEntries() {
        val group = addHabit("Sport", HabitType.GROUP)
        assertFailsWith<IllegalArgumentException> {
            CreateRepetitionCommand(habitList, group, getToday(), Entry.YES_MANUAL, "").run()
        }
        assertTrue(group.originalEntries.getKnown().isEmpty())
    }

    @Test
    fun testGroupRejectsNestedGroupsBeforeSave() {
        val group = addHabit("Sport", HabitType.GROUP)
        val model = modelFactory.buildHabit().apply { type = HabitType.GROUP }
        assertFailsWith<IllegalArgumentException> {
            SaveHabitGroupCommand(
                CreateHabitCommand(modelFactory, habitList, model), habitList, model.uuid!!, setOf(group.id!!)
            ).run()
        }
        assertNull(habitList.getByUUID(model.uuid))
    }

    private fun state(filter: HabitMatcher? = null) = ListHabitsPresenter.buildState(
        habitList, filter, HabitList.Order.BY_POSITION, HabitList.Order.BY_NAME_ASC, 3, LightTheme()
    )

    private fun addHabit(name: String, type: HabitType = HabitType.YES_NO, parent: Habit? = null): Habit {
        val habit = modelFactory.buildHabit().apply {
            this.name = name
            this.type = type
            position = habitList.size()
            parentUuid = parent?.uuid
        }
        habitList.add(habit)
        habit.recompute()
        return habit
    }
}
