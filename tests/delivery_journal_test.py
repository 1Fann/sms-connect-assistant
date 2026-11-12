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

class PeerPresenceWriteTest(unittest.TestCase):
    def test_metadata_changes_are_immediate_but_identical_heartbeats_are_coalesced(self):
        registry=(SRC/'modules/iphone/DeviceRegistry.kt').read_text(encoding='utf-8')
        update=re.search(r'"""(\s*UPDATE devices SET last_seen=.*?)"""',HUB,re.S)[1]
        with closing(sqlite3.connect(':memory:')) as db:
            db.execute(sql(registry,'CREATE TABLE devices('))
            db.execute("INSERT INTO devices(device,label,model,push_after) VALUES('peer','fixture','old',0)")
            def sync(now, model='test', sms_send=1):
                return db.execute(update,(now,3,model,'15',1,sms_send,0,0,0,'','peer',now-30_000)).rowcount
            self.assertEqual(sync(100_000),1)
            for now in range(105_000,130_000,5_000):
                self.assertEqual(sync(now),0)
            self.assertEqual(sync(130_000),1)
            self.assertEqual(sync(131_000,model='',sms_send=0),1)
            self.assertEqual(sync(132_000,model='',sms_send=0),0)
            self.assertEqual(sync(90_000,model='',sms_send=0),1) # Wall-clock correction.
            self.assertEqual(db.execute("SELECT last_seen,model,sms_send FROM devices").fetchone(),(90_000,'test',0))

class SimConfirmationTest(unittest.TestCase):
    def test_same_subscription_returns_while_replacement_or_move_requires_review(self):
        registry=(SRC/'modules/iphone/DeviceRegistry.kt').read_text(encoding='utf-8')
        with closing(sqlite3.connect(':memory:')) as db:
            db.execute(sql(registry,'CREATE TABLE lines('))
            db.execute("INSERT INTO lines(line_id,alias,device,slot,sub,name,present,confirmed) VALUES('a',1,'peer',1,4,'SIM',1,1)")
            absent=sql(registry,'UPDATE lines SET present=0')
            changed=sql(registry,'UPDATE lines SET confirmed=0 WHERE device=')
            present=sql(registry,'UPDATE lines SET present=1,confirmed=')
            def restore(slot,sub):
                db.execute(changed,('peer',slot,sub))
                db.execute(present,(slot,slot,'peer',sub))
            def state():
                return db.execute("SELECT present,confirmed FROM lines WHERE line_id='a'").fetchone()
            db.execute(absent,('peer',))
            self.assertEqual(state(),(0,1))
            restore(1,4)
            self.assertEqual(state(),(1,1))
            db.execute(absent,('peer',))
            db.execute(changed,('peer',1,5))
            restore(1,4)
            self.assertEqual(state(),(1,0))
            db.execute("UPDATE lines SET confirmed=1 WHERE line_id='a'")
            restore(2,4)
            self.assertEqual(state(),(1,0))

    def test_takeover_uses_new_subscription_without_rebinding_queued_requests(self):
        registry=(SRC/'modules/iphone/DeviceRegistry.kt').read_text(encoding='utf-8')
        with closing(sqlite3.connect(':memory:')) as db:
            db.execute(sql(registry,'CREATE TABLE lines('))
            db.execute(sql(registry,'CREATE TABLE line_preferences('))
            db.execute(sql(registry,'CREATE TABLE sms_bindings('))
            db.executemany("INSERT INTO lines VALUES(?,?,?,?,?,?,?,?,?,?)",[
                ('old',1,'peer',2,4,'work',0,0,1,7),('replacement',2,'peer',2,8,'generic',1,0,1,0)])
            db.execute("INSERT INTO line_preferences VALUES('takeover:peer:2','old')")
            db.execute("INSERT INTO sms_bindings VALUES('queued',2,4)")
            db.execute(sql(registry,'UPDATE lines SET name=?,enabled=?,sort_order=?,confirmed=1'),('work',1,7,'replacement'))
            db.execute(sql(registry,'UPDATE line_preferences SET line_id=? WHERE name=?'),('replacement','takeover:peer:2'))
            self.assertEqual(db.execute("SELECT sub,name,confirmed,sort_order FROM lines WHERE present=1").fetchone(),(8,'work',1,7))
            self.assertEqual(db.execute("SELECT slot,sub FROM sms_bindings WHERE request_id='queued'").fetchone(),(2,4))

class DeliveryJournalTest(unittest.TestCase):
    def hub(self, seed=None):
        db=sqlite3.connect(':memory:')
        for table in ('sends','history','push_events'):db.execute(sql(HUB,'CREATE TABLE '+table+'('))
        if seed:
            seed(db)
        for statement in re.findall(r'db\.execSQL\("([^"\n]+)"\)', HUB.split('private fun upgradeRegistry',1)[1].split('private fun scalar',1)[0]):
            db.execute(statement)
        return db

    def test_upgrade_keeps_history_cursor_inflight_send_and_push(self):
        def seed(db):
            db.execute("INSERT INTO history VALUES(73,?)",(json.dumps({'id':'xia:73','sim':102}),))
            db.execute("INSERT INTO sends VALUES('ambiguous','{}',8,'offered',81)")
            db.execute("INSERT INTO push_events VALUES('73','fixture')")
        db=self.hub(seed)
        self.assertEqual(db.execute("SELECT seq,device,source_id FROM history").fetchone(),(73,'peer',73))
        self.assertEqual(json.loads(db.execute("SELECT row FROM history").fetchone()[0])['id'],'xia:73')
        self.assertEqual(db.execute("SELECT device,sub,phase,checked FROM sends").fetchone(),('peer',8,'offered',81))
        self.assertEqual(db.execute("SELECT device,id FROM push_events").fetchone(),('peer','73'))
        for device in ('other-a','other-b'):
            db.execute(sql(HUB,'INSERT INTO history(device,source_id,row,address)'), (device,73,'{}','fixture'))
        self.assertEqual(db.execute("SELECT COUNT(DISTINCT seq) FROM history").fetchone()[0],3)
        self.assertEqual(db.execute("SELECT row FROM history WHERE seq<73").fetchall(),[])

    def test_peer_cannot_receive_inspect_ack_or_finish_another_peers_job(self):
        db=self.hub()
        db.execute(sql(HUB,"INSERT INTO sends(id,row,sub,phase,device,slot,address)"),('task','{}',8,'a',1,'fixture'))
        offer=sql(HUB,"SELECT row FROM sends WHERE phase IN ('offered','queued')")
        self.assertIsNone(db.execute(offer,('b',)).fetchone())
        db.execute("UPDATE sends SET phase='offered' WHERE id='task'")
        self.assertFalse(db.execute(sql(HUB,"SELECT row FROM sends WHERE phase IN ('handed','offered','sent')"),('b',)).fetchall())
        db.execute(sql(HUB,"UPDATE sends SET phase='handed'"),('b','task'))
        db.execute(sql(HUB,"UPDATE sends SET row=?,phase=? WHERE device=?"),('bad','done','b','task'))
        self.assertEqual(db.execute("SELECT device,phase,row FROM sends").fetchone(),('a','offered','{}'))
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
        db.execute('INSERT INTO sends(id,row,sub,phase,device) VALUES(?,?,?,?,?)',('job',row,1,'offered','peer'))
        db.commit() # Persisted response is lost before the peer receives it.
        offer=sql(HUB,"SELECT row FROM sends WHERE phase IN ('offered','queued')")
        self.assertIsNotNone(db.execute(offer,("peer",)).fetchone())
        db.execute(sql(HUB,"UPDATE sends SET phase='handed'"),('peer','job'))
        self.assertIsNone(db.execute(offer,("peer",)).fetchone())
        # The acknowledgement itself can be replayed after a lost HTTP reply.
        db.execute(sql(HUB,"UPDATE sends SET phase='handed'"),('peer','job'))
        self.assertEqual(db.execute("SELECT phase FROM sends").fetchone(),('handed',))
    def test_legacy_jobs_are_never_reoffered(self):
        db=self.hub()
        db.execute('INSERT INTO sends(id,row,sub,phase,device) VALUES(?,?,?,?,?)',('legacy','{}',1,'handed','peer'))
        self.assertIsNone(db.execute(sql(HUB,"SELECT row FROM sends WHERE phase IN ('offered','queued')"),('peer',)).fetchone())
    def test_sent_remains_inspected_and_old_rows_are_not_starved(self):
        db=self.hub()
        for i in range(150):db.execute('INSERT INTO sends(id,row,sub,phase,device) VALUES(?,?,?,?,?)',(str(i),json.dumps({'id':str(i)}),1,'sent','peer'))
        query=sql(HUB,"SELECT row FROM sends WHERE phase IN ('handed','offered','sent')")
        first=[json.loads(row[0])['id'] for row in db.execute(query,('peer',))]
        for i in first:db.execute(sql(HUB,'UPDATE sends SET checked='),(100,'peer',i))
        second=[json.loads(row[0])['id'] for row in db.execute(query,('peer',))]
        self.assertEqual(len(set(first+second)),150)
    def test_new_shared_inbox_push_is_durable_and_deduplicated(self):
        db=self.hub()
        insert=sql(HUB,'INSERT OR IGNORE INTO push_events')
        db.execute(insert,('peer','10','fixture'));db.commit()
        db.execute(insert,('peer','10','fixture'))
        self.assertEqual(db.execute('SELECT count(*) FROM push_events').fetchone(),(1,))
        db.execute('DELETE FROM push_events WHERE id=?',('10',))
        self.assertEqual(db.execute('SELECT count(*) FROM push_events').fetchone(),(0,))
    def test_peer_receipt_survives_restart_until_server_ack(self):
        db=sqlite3.connect(':memory:');db.execute(sql(PRIVATE,'CREATE TABLE peer_receipts('))
        statement=sql(PRIVATE,'INSERT OR IGNORE INTO peer_receipts')
        db.execute(statement,('job',));db.commit();db.execute(statement,('job',))
        self.assertEqual(db.execute('SELECT count(*) FROM peer_receipts').fetchone(),(1,))

if __name__=='__main__':unittest.main()
