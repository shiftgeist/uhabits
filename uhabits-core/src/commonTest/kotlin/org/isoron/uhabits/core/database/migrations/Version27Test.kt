package org.isoron.uhabits.core.database.migrations

import kotlinx.coroutines.test.runTest
import org.isoron.platform.io.TestDatabaseHelper
import org.isoron.platform.io.migrateTo
import org.isoron.platform.io.query
import org.isoron.uhabits.core.BaseUnitTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class Version27Test : BaseUnitTest() {
    @Test
    fun testMigrationPreservesHabitsWithoutGroupMembership() = runTest {
        val db = openDatabaseResource("/databases/022.db")
        var count = 0
        db.query("SELECT id FROM Habits") { count++ }
        db.migrateTo(27) { TestDatabaseHelper.loadMigrationSQL(it) }
        var migratedCount = 0
        db.query("SELECT parent_uuid FROM Habits") {
            assertNull(it.getTextOrNull(0))
            migratedCount++
        }
        assertEquals(count, migratedCount)
        db.close()
    }
}
