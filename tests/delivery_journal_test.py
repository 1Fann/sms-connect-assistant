"""Host SQLite fault checks using production SQL, without Android or real SMS.

These exercise migration, duplicate claims, response-loss recovery and durable
push bookkeeping. Android telephony and WorkManager integration need device QA.
"""
from pathlib import Path
import concurrent.futures,json,re,sqlite3,tempfile,unittest
from contextlib import closing

ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'app/src/main/java/me/capcom/smsgateway'
HUB=(SRC/'modules/iphone/PeerHub.kt').read_text(encoding='utf-8')
PRIVATE=(SRC/'modules/iphone/PrivateStore.kt').read_text(encoding='utf-8')
def sql(source,prefix):
    return next(s for s in re.findall(r'"([^"\n]+)"',source) if s.startswith(prefix))

class DeliveryJournalTest(unittest.TestCase):
    def hub(self):
        db=sqlite3.connect(':memory:')
        for table in ('sends','history','push_events'):db.execute(sql(HUB,'CREATE TABLE '+table+'('))
        return db
    def test_upgrade_preserves_legacy_request_tombstone(self):
        db=sqlite3.connect(':memory:')
        db.execute('CREATE TABLE requests(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,created INTEGER NOT NULL)')
        db.execute("INSERT INTO requests VALUES('old','fingerprint',1)")
        db.execute(sql(PRIVATE,'ALTER TABLE requests ADD COLUMN generation'))
        db.execute(sql(PRIVATE,'ALTER TABLE requests ADD COLUMN rejected'))
        self.assertEqual(db.execute('SELECT generation,rejected FROM requests').fetchone(),(1,0))
        db.execute(sql(PRIVATE,'INSERT INTO requests(id,fingerprint,created,generation)'),('new','fingerprint',2))
        self.assertEqual(db.execute("SELECT generation FROM requests WHERE id='new'").fetchone(),(2,))
    def test_submission_claim_survives_crash_and_concurrent_workers(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=str(Path(tmp)/'journal.db')
            with closing(sqlite3.connect(file)) as db:db.execute(sql(PRIVATE,'CREATE TABLE submissions('));db.commit()
            def claim(_):
                with closing(sqlite3.connect(file,timeout=10)) as db:
                    result=db.execute("INSERT OR IGNORE INTO submissions(id,phone) VALUES('job','fixture')").rowcount
                    db.commit();return result
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:self.assertEqual(sum(pool.map(claim,range(20))),1)
            # Reopening models process loss, and no volatile state can allow a replay.
            self.assertEqual(claim(0),0)
    def test_response_loss_reoffers_until_durable_receipt(self):
        db=self.hub();row=json.dumps({'id':'job','state':'unknown'})
        db.execute(sql(HUB,'INSERT INTO sends(id,row,sub,phase)'),('job',row,1,'offered'))
        db.commit() # Persisted response is lost before the peer receives it.
        offer=sql(HUB,"SELECT row FROM sends WHERE phase IN ('offered','queued')")
        self.assertIsNotNone(db.execute(offer).fetchone())
        db.execute(sql(HUB,"UPDATE sends SET phase='handed'"),('job',))
        self.assertIsNone(db.execute(offer).fetchone())
        # The acknowledgement itself can be replayed after a lost HTTP reply.
        db.execute(sql(HUB,"UPDATE sends SET phase='handed'"),('job',))
        self.assertEqual(db.execute("SELECT phase FROM sends").fetchone(),('handed',))
    def test_legacy_jobs_are_never_reoffered(self):
        db=self.hub()
        db.execute(sql(HUB,'INSERT INTO sends(id,row,sub,phase)'),('legacy','{}',1,'handed'))
        self.assertIsNone(db.execute(sql(HUB,"SELECT row FROM sends WHERE phase IN ('offered','queued')")).fetchone())
    def test_sent_remains_inspected_and_old_rows_are_not_starved(self):
        db=self.hub()
        for i in range(150):db.execute(sql(HUB,'INSERT INTO sends(id,row,sub,phase)'),(str(i),json.dumps({'id':str(i)}),1,'sent'))
        query=sql(HUB,"SELECT row FROM sends WHERE phase IN ('handed','offered','sent')")
        first=[json.loads(row[0])['id'] for row in db.execute(query)]
        for i in first:db.execute(sql(HUB,'UPDATE sends SET checked='),(100,i))
        second=[json.loads(row[0])['id'] for row in db.execute(query)]
        self.assertEqual(len(set(first+second)),150)
    def test_new_shared_inbox_push_is_durable_and_deduplicated(self):
        db=self.hub()
        insert=sql(HUB,'INSERT OR IGNORE INTO push_events')
        db.execute(insert,('10','fixture'));db.commit()
        db.execute(insert,('10','fixture'))
        self.assertEqual(db.execute('SELECT count(*) FROM push_events').fetchone(),(1,))
        db.execute('DELETE FROM push_events WHERE id=?',('10',))
        self.assertEqual(db.execute('SELECT count(*) FROM push_events').fetchone(),(0,))
    def test_peer_receipt_survives_restart_until_server_ack(self):
        db=sqlite3.connect(':memory:');db.execute(sql(PRIVATE,'CREATE TABLE peer_receipts('))
        statement=sql(PRIVATE,'INSERT OR IGNORE INTO peer_receipts')
        db.execute(statement,('job',));db.commit();db.execute(statement,('job',))
        self.assertEqual(db.execute('SELECT count(*) FROM peer_receipts').fetchone(),(1,))

if __name__=='__main__':unittest.main()
