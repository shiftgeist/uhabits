@file:OptIn(ExperimentalJsExport::class)

import org.isoron.platform.time.DayOfWeek
import org.isoron.platform.time.LocalDate
import org.isoron.platform.time.resetFirstWeekday
import org.isoron.platform.time.resetToday
import org.isoron.platform.time.setFirstWeekday
import org.isoron.platform.time.setToday
import org.isoron.uhabits.core.ui.screens.habits.show.views.BarCardPresenter
import org.isoron.uhabits.core.ui.screens.habits.show.views.OverviewCardPresenter
import org.isoron.uhabits.core.ui.screens.habits.show.views.ScoreCardPresenter
import org.isoron.uhabits.core.ui.screens.habits.show.views.TargetCardPresenter
import org.isoron.uhabits.core.ui.views.LightTheme

internal fun webDate(value: String): LocalDate {
  val parts = value.split('-').map { it.toInt() }
  return LocalDate(parts[0], parts[1], parts[2])
}

@JsExport
fun calculateWebMetrics(input: String): String {
  val data = JSON.parse<dynamic>(input)
  val firstWeekday = data.firstWeekday as Int
  require(firstWeekday in 1..7)
  setToday(webDate(data.today as String))
  setFirstWeekday(DayOfWeek.entries[firstWeekday - 1])
  try {
    val habits = readWebHabits(data.state.habits)
    val output = js("Object.create(null)")
    val theme = LightTheme()
    for (habit in habits) {
      val metrics = js("({})")
      val entries = js("Object.create(null)")
      for (entry in habit.computedEntries.getKnown()) {
        val item = js("({})")
        item.value = entry.value
        item.completed = entry.completed
        entries[entry.date.toCSVString()] = item
      }
      metrics.entries = entries
      val overview = OverviewCardPresenter.buildState(habit, theme)
      val summary = js("({})")
      summary.strength = overview.scoreToday
      summary.monthDifference = overview.scoreMonthDiff
      summary.yearDifference = overview.scoreYearDiff
      summary.total = overview.totalCount.toDouble()
      metrics.overview = summary
      metrics.scores = ScoreCardPresenter.buildState(habit, firstWeekday, data.scoreBucket as Int, theme).scores.map {
        val item = js("({})")
        item.date = it.date.toCSVString()
        item.value = it.value
        item
      }.toTypedArray()
      metrics.streaks = habit.streaks.getBest(10).map {
        val item = js("({})")
        item.start = it.start.toCSVString()
        item.end = it.end.toCSVString()
        item.length = it.length
        item
      }.toTypedArray()
      metrics.frequency = habit.originalEntries.computeWeekdayFrequency(habit.isNumerical).map { (date, values) ->
        val item = js("({})")
        item.date = date.toCSVString()
        item.values = values
        item
      }.toTypedArray()
      metrics.totals = BarCardPresenter.buildState(
        habit,
        firstWeekday,
        data.totalBucket as Int,
        data.booleanTotalBucket as Int,
        theme
      ).entries.map {
        val item = js("({})")
        item.date = it.date.toCSVString()
        item.value = if (habit.isNumerical) it.value / 1000.0 else it.value.toDouble()
        item
      }.toTypedArray()
      if (habit.isNumerical) {
        val target = TargetCardPresenter.buildState(habit, firstWeekday, theme)
        val item = js("({})")
        item.values = target.values.toTypedArray()
        item.targets = target.targets.toTypedArray()
        item.intervals = target.intervals.toTypedArray()
        metrics.targets = item
      }
      output[habit.uuid] = metrics
    }
    return JSON.stringify(output)
  } finally {
    resetToday()
    resetFirstWeekday()
  }
}
