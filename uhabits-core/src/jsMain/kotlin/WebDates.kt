@file:OptIn(ExperimentalJsExport::class)

import org.isoron.platform.time.LocalDate
import org.isoron.uhabits.core.preferences.Preferences
import kotlin.js.Date

@JsExport
fun calculateWebHabitDate(timestamp: Double, extended: Boolean): String {
    require(timestamp.isFinite())
    val now = Date(timestamp)
    require(now.getTime().isFinite())
    val date = LocalDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
    return (if (extended && now.getHours() < Preferences.MIDNIGHT_DELAY_HOURS) date.minus(1) else date).toCSVString()
}
