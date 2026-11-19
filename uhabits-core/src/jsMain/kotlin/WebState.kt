@file:OptIn(ExperimentalJsExport::class)

import org.isoron.platform.gui.Color
import org.isoron.uhabits.core.models.Entry
import org.isoron.uhabits.core.ui.views.LightTheme
import kotlin.js.Date
import kotlin.math.floor
import kotlin.math.roundToInt

internal fun webHabitData(row: dynamic, position: Int = 0): dynamic {
    val settings = row.settings
    val android = row.android?.habit
    val result = js("Object.assign({}, row)")
    result.position = position
    result.question = settings?.question ?: android?.question ?: ""
    result.description = settings?.description ?: android?.description ?: ""
    result.category = settings?.category ?: android?.category ?: ""
    result.archived = settings?.archived ?: (android?.archived == 1)
    result.numerator = settings?.frequencyNumerator ?: android?.freq_num ?: 1
    result.denominator = settings?.frequencyDenominator ?: android?.freq_den ?: 1
    result.targetType = settings?.targetType ?: android?.target_type ?: 0
    val originals = mutableMapOf<String, Int>()
    if (row.android?.entries != null) {
        for (entry in row.android.entries as Array<dynamic>) {
            originals[Date(entry.timestamp as Double).toISOString().take(10)] = entry.value as Int
        }
    }
    val edited = (row.editedDays as Array<String>?)?.toSet().orEmpty()
    val unknown = (row.unknownDays as Array<String>?)?.toSet().orEmpty()
    val skipped = (row.skippedDays as Array<String>?)?.toSet().orEmpty()
    result.records = (js("Object.keys(row.entries)") as Array<String>).map { date ->
        val record = js("({})")
        record.date = date
        record.notes = if (row.notes != null) row.notes[date] ?: "" else ""
        record.value = when {
            date !in edited && originals.containsKey(date) -> originals.getValue(date)
            date in unknown -> Entry.UNKNOWN
            date in skipped -> Entry.SKIP
            row.type == "number" -> floor((row.entries[date] as Double) * 1000 + 0.5).toInt()
            row.entries[date] == 1 -> Entry.YES_MANUAL
            else -> Entry.NO
        }
        record
    }.toTypedArray()
    return result
}

@JsExport
fun webNearestColorIndex(hex: String): Int {
    val actual = Color(hex.removePrefix("#").toInt(16))
    val theme = LightTheme()
    return (0 until 20).minBy { index ->
        val color = theme.color(index)
        val red = color.red - actual.red
        val green = color.green - actual.green
        val blue = color.blue - actual.blue
        red * red + green * green + blue * blue
    }
}

@JsExport
fun webPaletteColor(index: Double): String {
    val paletteIndex = if (index >= 0 && index < 20 && index == floor(index)) index.toInt() else 0
    val color = LightTheme().color(paletteIndex)
    return "#" + listOf(color.red, color.green, color.blue).joinToString("") {
        (it * 255).roundToInt().toString(16).padStart(2, '0')
    }
}
