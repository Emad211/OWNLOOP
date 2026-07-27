from pathlib import Path
import runpy

source = Path(".ol027-transfer/finalize-capability-config.py").read_text(encoding="utf-8")
old = '''export_anchor = '} from "./codex-capability.js";\\n'
'''
new = '''export_anchor = '  projectCodexCapabilityStatusV1,\\n} from "./codex-capability.js";\\n'
'''
if source.count(old) != 1:
    raise SystemExit("capability export anchor patch precondition failed")
patched = source.replace(old, new)
temporary = Path("/tmp/finalize-capability-config-v2.py")
temporary.write_text(patched, encoding="utf-8")
runpy.run_path(str(temporary), run_name="__main__")
