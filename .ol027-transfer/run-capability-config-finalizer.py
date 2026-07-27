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

config = Path("packages/contracts/src/codex-hook-configuration.ts")
text = config.read_text(encoding="utf-8")
old_pattern = 'const CONTROL_CHARACTER_PATTERN = /[\\u0000-\\u001f\\u007f]/u;\n'
new_function = '''function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
'''
if text.count(old_pattern) != 1:
    raise SystemExit("control-character declaration precondition failed")
text = text.replace(old_pattern, new_function)
if text.count("CONTROL_CHARACTER_PATTERN.test(key)") != 1:
    raise SystemExit("control-character key precondition failed")
text = text.replace("CONTROL_CHARACTER_PATTERN.test(key)", "containsControlCharacter(key)")
if text.count("CONTROL_CHARACTER_PATTERN.test(trimmed)") != 1:
    raise SystemExit("control-character command precondition failed")
text = text.replace("CONTROL_CHARACTER_PATTERN.test(trimmed)", "containsControlCharacter(trimmed)")
config.write_text(text, encoding="utf-8")

test = Path("packages/contracts/tests/codex-hook-configuration.test.ts")
test_text = test.read_text(encoding="utf-8")
if test_text.count("  CodexHookConfigurationError,\n") != 1:
    raise SystemExit("capability error import precondition failed")
test_text = test_text.replace("  CodexHookConfigurationError,\n", "")
needle = "expect.objectContaining<CodexHookConfigurationError>("
if test_text.count(needle) != 6:
    raise SystemExit("capability error assertion precondition failed")
test_text = test_text.replace(needle, "expect.objectContaining(")
test.write_text(test_text, encoding="utf-8")
