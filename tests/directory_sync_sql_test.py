"""Execute the directory's production SQL against SQLite on the host, without an Android device."""
from pathlib import Path
import json
import re
import sqlite3
import tempfile
import unittest

SRC = (Path(__file__).resolve().parents[1] / "app/src/main/java/me/capcom/smsgateway/modules/directory")
SCHEMA = (SRC / "DirectoryDb.kt").read_text(encoding="utf-8")
PEER = (SRC / "PeerDirectoryAgent.kt").read_text(encoding="utf-8")
SERVICE = (SRC / "DirectoryService.kt").read_text(encoding="utf-8")


def sql_from(source, prefix):
    statements = re.findall(r'(?:execSQL|rows|rawQuery)\(\s*(?:"""(.*?)"""|"([^"\n]*)")', source, re.S)
    matches = [a or b for a, b in statements if (a or b).strip().startswith(prefix)]
    if len(matches) != 1:
        raise AssertionError((prefix, matches))
    return matches[0]


class DirectorySQL(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "commlink-directory.db"
        self.db = sqlite3.connect(self.path)
        self.db.execute("PRAGMA foreign_keys=ON")
        schema = re.findall(r'db\.execSQL\((?:"""(.*?)"""|"([^"\n]*)")\)', SCHEMA, re.S)
        for multiline, line in schema:
            self.db.execute(multiline or line)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def test_late_ack_cannot_ack_a_newer_edit_or_another_device(self):
        enqueue = sql_from(PEER, "INSERT OR REPLACE INTO observed")
        ack = sql_from(PEER, "UPDATE observed SET dirty=0")
        for device in ("A", "B"):
            self.db.execute(enqueue, (device, "contact", "1", "1", "{}", 1))
        self.db.execute(enqueue, ("A", "contact", "1", "2", '{"name":"edit"}', 2))
        self.db.commit()
        self.db.close()
        self.db = sqlite3.connect(self.path)
        self.assertEqual(self.db.execute(ack, ("A", "contact", "1", 1)).rowcount, 0)
        self.assertEqual(self.db.execute(ack, ("B", "contact", "1", 1)).rowcount, 1)
        self.assertEqual(self.db.execute("SELECT link,version FROM observed WHERE dirty=1").fetchall(), [("A", "2")])

    def test_disjoint_sources_share_number_without_primary_key_collision(self):
        phone = "+15550100001"
        self.db.execute("INSERT INTO contacts(id) VALUES('card')")
        set_grant = sql_from(SERVICE, "INSERT OR REPLACE INTO grants")
        put = sql_from(SERVICE, "INSERT OR REPLACE INTO sources")
        identities = sql_from(SERVICE, "INSERT INTO identities")
        for device in ("A", "B", "C"):
            self.db.execute(set_grant, (device, 1, 0, 0))
            self.db.execute(put, (device, "1", "card", "v1", json.dumps({"name": device})))
            self.db.execute(identities, (device, "1", phone))
        query = sql_from(SERVICE, "SELECT s.device,s.payload,s.deleted")
        self.assertEqual(len(self.db.execute(query, ("card", "0")).fetchall()), 3)
        self.db.execute(set_grant, ("A", 0, 0, 0))
        self.assertEqual([r[0] for r in self.db.execute(query, ("card", "0"))], ["B", "C"])
        self.assertEqual(self.db.execute("SELECT count(*) FROM sources").fetchone()[0], 3)

    def test_targeted_contact_offer_survives_restart_and_never_crosses_devices(self):
        edits = (SRC / "DirectoryEdits.kt").read_text(encoding="utf-8")
        create = sql_from(edits, "INSERT INTO jobs")
        offer = sql_from(SERVICE, "SELECT id,raw,expected,action,payload")
        self.db.execute(create, ("operation", "card", "B", "22", "v1", "update", "{}", 10))
        self.db.commit()
        self.db.close()
        self.db = sqlite3.connect(self.path)
        self.assertFalse(self.db.execute(offer, ("A",)).fetchall())
        result = self.db.execute(offer, ("B",)).fetchone()
        self.assertEqual(result[:4], ("operation", "22", "v1", "update"))
        self.assertEqual(self.db.execute(offer, ("B",)).fetchone(), result)
        finish = sql_from(SERVICE, "UPDATE jobs SET state=?,detail=?")
        self.assertEqual(self.db.execute(finish, ("done", "", "22", 11, "operation", "A")).rowcount, 0)
        self.assertEqual(self.db.execute(finish, ("conflict", "revision changed", "22", 12, "operation", "B")).rowcount, 1)
        self.assertFalse(self.db.execute(offer, ("B",)).fetchall())


if __name__ == "__main__":
    unittest.main()
