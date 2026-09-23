"""tools/ask_model.py - the optional model mode (v3.61).

The two rules by hand: the number guard (accepts the evidence's numbers as written, rounded no finer,
as a percent of a share, without a sign; refuses any other number and names it); every answer carries
its evidence block. The evidence pack (a catalogue answer; every catalogue answer for a question
outside it), the prompt's rules, the dry run (nothing called), a mocked OpenAI-compatible endpoint on
localhost that is accepted when it keeps to the evidence and refused when it invents a number, the
network flag and banner for a host that is not localhost.
"""
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import ask_model as M  # noqa: E402

FIX = ROOT / "test" / "fixtures" / "run-ledger.json"


class Guard(unittest.TestCase):
    def test_numbers_by_hand(self):
        pack = {"answer": {"text": "Units wait longest at stg for putaway: 122.4 ticks over 23 waits (the longest 206).", "read": [{"view": "v_station_wait", "rows": [{"avg": 122.4, "waits": 23, "max": 206, "share": 0.65, "late": -30}]}]}}
        self.assertEqual(M.guard("stg waits 122.4 ticks over 23 waits, at most 206.", pack), {"ok": True, "offending": []})
        self.assertTrue(M.guard("about 122 ticks (23 waits); 65 % of them; 30 minutes early.", pack)["ok"])  # rounded no finer, percent of a share, without the sign
        self.assertTrue(M.guard("122,4 Ticks im Mittel", pack)["ok"])  # a decimal comma
        r = M.guard("about 120 ticks; 3 shifts; version v3.60 of the app", pack)
        self.assertEqual((r["ok"], r["offending"]), (False, ["120", "3"]))  # v3.60 is not a number of its own
        self.assertEqual(M.guard("", pack), {"ok": True, "offending": []})
        self.assertEqual(M.prose_numbers("1.50 and 2,0 and -7"), ["1.5", "2", "-7"])

    def test_evidence_numbers_forms(self):
        nums = M.evidence_numbers({"v": 0.6543, "n": 20, "t": "the longest 206"})
        for want in ("0.6543", "0.65", "0.654", "1", "65", "65.4", "20", "206"):
            self.assertIn(want, nums, want)
        self.assertNotIn("21", nums)


class Pack(unittest.TestCase):
    def test_evidence_pack_and_prompt(self):
        pack = M.evidence_pack("which step waits longest", FIX)
        self.assertEqual(pack["answer"]["id"], "wait")
        self.assertFalse(pack["answer"]["unanswered"])
        self.assertEqual(pack["answer"]["read"][0]["view"], "v_station_wait")
        self.assertNotIn("catalogue_answers", pack)
        u = M.evidence_pack("what is the meaning of life", FIX)
        self.assertTrue(u["answer"]["unanswered"])
        self.assertEqual(len(u["catalogue_answers"]), 11)
        self.assertIn("wait", u["catalogue_answers"])
        msgs = M.build_messages(pack)
        self.assertEqual([m["role"] for m in msgs], ["system", "user"])
        for rule in ("never introduce a number of your own", "Never name, guess or imply a person", "name the closest catalogue question", "at most six sentences"):
            self.assertIn(rule, msgs[0]["content"])
        self.assertIn("QUESTION: which step waits longest", msgs[1]["content"])
        self.assertIn('"v_station_wait"', msgs[1]["content"])

    def test_dry_run_calls_nothing_and_carries_the_evidence(self):
        out = M.ask("which step waits longest", FIX, None, "m", None)
        self.assertEqual((out["mode"], out["model"], out["dry_run"]), ("deterministic", None, True))
        self.assertIn("122.4", out["deterministic"]["text"])
        text = M.render(out)
        self.assertIn("(dry run: no endpoint given, nothing was called", text)
        self.assertIn("Evidence: read v_station_wait (6 rows)", text)
        self.assertEqual(out["honesty"], M.HONESTY)
        with tempfile.TemporaryDirectory() as tmp:
            outf = Path(tmp) / "a.json"
            r = subprocess.run([sys.executable, str(ROOT / "tools" / "ask_model.py"), "what does a mis-pick cost", "--export", str(FIX), "--out", str(outf)], capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("29.17 EUR", r.stdout)
            self.assertIn("Source: hf.error.mis-pick = 0.02", r.stdout)
            j = json.loads(outf.read_text(encoding="utf-8"))
            self.assertEqual((j["mode"], j["dry_run"], j["deterministic"]["id"]), ("deterministic", True, "mispick-cost"))


class MockEndpoint(unittest.TestCase):
    """An OpenAI-compatible chat endpoint on localhost whose reply the test chooses."""

    reply = ""
    seen: list = []

    @classmethod
    def setUpClass(cls):
        test = cls

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n).decode("utf-8"))
                test.seen.append({"path": self.path, "auth": self.headers.get("Authorization"), "body": body})
                data = json.dumps({"choices": [{"message": {"role": "assistant", "content": test.reply}}]}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass

        cls.server = HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.endpoint = f"http://127.0.0.1:{cls.server.server_address[1]}/v1"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_prose_within_the_evidence_is_accepted(self):
        MockEndpoint.reply = "Units wait longest at stg for put-away - 122.4 ticks on average over 23 waits, up to 206 ticks (read from v_station_wait)."
        MockEndpoint.seen.clear()
        out = M.ask("which step waits longest", FIX, self.endpoint, "test-model", None)
        self.assertEqual((out["mode"], out["model"]["refused"], out["model"]["network"], out["model"]["offending"]), ("model", False, False, []))
        self.assertEqual(out["model"]["prose"], MockEndpoint.reply)
        self.assertEqual(self.seen[0]["path"], "/v1/chat/completions")
        self.assertIsNone(self.seen[0]["auth"])
        self.assertEqual(self.seen[0]["body"]["model"], "test-model")
        self.assertEqual(self.seen[0]["body"]["temperature"], 0)
        self.assertEqual(self.seen[0]["body"]["messages"][0]["role"], "system")
        text = M.render(out)
        self.assertTrue(text.startswith(MockEndpoint.reply))
        self.assertIn("Evidence: read v_station_wait (6 rows)", text)
        self.assertNotIn("NETWORK", text)

    def test_prose_with_an_invented_number_is_refused(self):
        MockEndpoint.reply = "Roughly 120 units waited about 130 ticks at stg; 9999 shifts were affected."
        out = M.ask("which step waits longest", FIX, self.endpoint, "test-model", None)
        self.assertEqual((out["mode"], out["model"]["refused"], out["model"]["offending"]), ("deterministic", True, ["120", "130", "9999"]))
        text = M.render(out)
        self.assertIn("REFUSED the model's prose: it carried numbers that are not in the evidence (120, 130, 9999)", text)
        self.assertIn(out["deterministic"]["text"], text)
        self.assertIn("Evidence: read v_station_wait", text)

    def test_key_from_the_environment_and_the_cli(self):
        MockEndpoint.reply = "OTIF was not measured in this run; the target is 0.95 (delivery.otif.target)."
        MockEndpoint.seen.clear()
        env = dict(os.environ, WT_MODEL_KEY="secret-key-for-the-test")
        with tempfile.TemporaryDirectory() as tmp:
            outf = Path(tmp) / "a.json"
            r = subprocess.run([sys.executable, str(ROOT / "tools" / "ask_model.py"), "why did otif fall", "--export", str(FIX), "--endpoint", self.endpoint, "--model", "m", "--out", str(outf)],
                               capture_output=True, text=True, encoding="utf-8", env=env)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(self.seen[-1]["auth"], "Bearer secret-key-for-the-test")
            j = json.loads(outf.read_text(encoding="utf-8"))
            self.assertEqual((j["mode"], j["model"]["model"], j["model"]["network"]), ("model", "m", False))
            self.assertNotIn("secret-key", outf.read_text(encoding="utf-8"))
            self.assertNotIn("secret-key", r.stdout)
            self.assertTrue(r.stdout.startswith(MockEndpoint.reply))


class Network(unittest.TestCase):
    def test_flag_and_banner(self):
        self.assertFalse(M.is_network("http://localhost:11434/v1"))
        self.assertFalse(M.is_network("http://127.0.0.1:8080/v1"))
        self.assertTrue(M.is_network("https://api.example.com/v1"))
        out = {"deterministic": {"text": "t", "read": [{"view": "v_x", "rows": [1]}], "sources": [{"id": "k", "value": 1, "source": "s"}]},
               "model": {"endpoint_host": "api.example.com", "model": "m", "network": True, "prose": "the prose", "refused": False, "offending": []}}
        text = M.render(out)
        self.assertTrue(text.startswith("NETWORK: this answer was produced by api.example.com - the evidence pack left this machine."))
        self.assertIn("the prose", text)
        self.assertTrue(text.endswith("Evidence: read v_x (1 rows)\nSource: k = 1 - s"))
        self.assertIn("Off by default", M.HONESTY)
        self.assertIn("never inside it", M.HONESTY)


if __name__ == "__main__":
    unittest.main()
