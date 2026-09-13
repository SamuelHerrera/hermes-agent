import sqlite3
from datetime import datetime, timezone

from hermes_cli.web_server import _list_cron_execution_rows_sync


def test_cron_run_history_uses_execution_ledger_for_script_only_jobs(tmp_path):
    home = tmp_path / "home"
    cron_dir = home / "cron"
    cron_dir.mkdir(parents=True)
    db_path = cron_dir / "executions.db"
    conn = sqlite3.connect(db_path)
    conn.execute(
        """CREATE TABLE executions (
             id TEXT PRIMARY KEY,
             job_id TEXT NOT NULL,
             source TEXT NOT NULL,
             process_id TEXT NOT NULL,
             pid INTEGER NOT NULL,
             process_started_at INTEGER,
             status TEXT NOT NULL,
             claimed_at TEXT NOT NULL,
             started_at TEXT,
             finished_at TEXT,
             error TEXT
           )"""
    )
    conn.execute(
        """INSERT INTO executions
           (id, job_id, source, process_id, pid, status, claimed_at, started_at, finished_at, error)
           VALUES (?, ?, 'builtin', 'proc', 123, 'completed', ?, ?, ?, NULL)""",
        (
            "exec-1",
            "job-1",
            "2026-09-13T07:00:00+00:00",
            "2026-09-13T07:00:02+00:00",
            "2026-09-13T07:00:09+00:00",
        ),
    )
    conn.commit()
    conn.close()

    output_dir = cron_dir / "output" / "job-1"
    output_dir.mkdir(parents=True)
    local_stamp = datetime.fromtimestamp(
        datetime.fromisoformat("2026-09-13T07:00:02+00:00").timestamp()
    ).strftime("%Y-%m-%d_%H-%M-%S")
    output_file = output_dir / f"{local_stamp}.md"
    output_file.write_text("done", encoding="utf-8")

    rows = _list_cron_execution_rows_sync(home=home, job_id="job-1", job_name="Hourly job", limit=20)

    assert len(rows) == 1
    assert rows[0]["id"] == "cron_exec_exec-1"
    assert rows[0]["title"].startswith("Hourly job · ")
    assert rows[0]["cron_execution_status"] == "completed"
    assert rows[0]["cron_output_path"] == str(output_file)
    assert rows[0]["message_count"] == 0
