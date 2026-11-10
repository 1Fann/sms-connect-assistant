import importlib.util
import io
from pathlib import Path
import unittest
import tempfile
import json
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('incoming_label', Path(__file__).with_name('incoming-line-label.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class IncomingLabels(unittest.TestCase):
    def test_configured_aliases_match_gateway_and_physical_slot(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'names.json'
            path.write_text(json.dumps({'*84*': {'phone': '示例手机', 'sim': '工作卡'}}), encoding='utf-8')
            with patch.object(module, 'Path', return_value=path):
                self.assertEqual('示例手机 · 工作卡｜未知来电', module.label('2002','2','','','allowed'))
                self.assertIn('主设备 · SIM 2', module.label('2001','2','','','allowed'))

    def test_malformed_or_unsafe_aliases_fall_back_without_breaking_calls(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'names.json'
            with patch.object(module, 'Path', return_value=path):
                for text in ['{', json.dumps({'*84*': {'phone':'a\nb','sim':'x'}}), '[]']:
                    path.write_text(text, encoding='utf-8')
                    self.assertIn('从设备 · SIM 2', module.label('2002','2','','','allowed'))
    def test_actual_line_and_formatted_identity(self):
        self.assertEqual('主设备 · SIM 2｜202 555 0123', module.label('2001','2','2025550123','202 555 0123','allowed_not_screened'))
        self.assertEqual('从设备 · SIM 1｜示例联系人', module.label('2002','1','','示例联系人','allowed'))

    def test_unknown_slot_and_endpoint_never_guess(self):
        self.assertIn('SIM 未识别', module.label('2002','3','','','allowed'))
        self.assertIsNone(module.label('1001','1','','','allowed'))

    def test_privacy_and_agi_injection(self):
        self.assertEqual('主设备 · SIM 1｜匿名来电', module.label('2001','1','secret','secret','prohib_not_screened'))
        result = module.label('2001','1','','a"\nSET VARIABLE X \\bad','allowed')
        self.assertNotIn('\n', result)
        self.assertNotIn('"', result)
        self.assertNotIn('\\', result)

    def test_agi_duplicate_slot_is_unidentified(self):
        replies = '\n' + ''.join('200 result=1 ('+s+')\n' for s in ['2002','1','2','allowed','2025550123','']) + '200 result=1\n'
        output = io.StringIO()
        with patch('sys.stdin', io.StringIO(replies)), patch('sys.stdout', output):
            module.main()
        self.assertIn('从设备 · SIM 未识别｜2025550123', output.getvalue())

    def test_private_call_does_not_query_number_or_name(self):
        replies = '\n200 result=1 (2002)\n200 result=1 (2)\n200 result=0\n200 result=1 (prohib)\n200 result=1\n'
        output = io.StringIO()
        with patch('sys.stdin', io.StringIO(replies)), patch('sys.stdout', output):
            module.main()
        self.assertNotIn('${CALLERID(num)}', output.getvalue())
        self.assertNotIn('${CALLERID(name)}', output.getvalue())
        self.assertIn('从设备 · SIM 2｜匿名来电', output.getvalue())


if __name__ == '__main__':
    unittest.main()
