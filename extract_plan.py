"""Extract the text field from the JSON plan file and print in chunks"""
import json
import sys
import os

plan_path = '/var/folders/53/tvz6q_8n44x5jr6sz3jklslw0000gn/T/claude-hostloop-plugins/97e2f07354f6fd0c/projects/-Users-fengyihang-Library-Application-Support-Claude-3p-local-agent-mode-sessions-fe41bac3-00000000-local-f29263fc-de40-4700-bac6-167b7561a040-outputs/c82c2f9a-9bdc-4106-9eb9-bfff3ddcbc3e/tool-results/call_00_VtzLy6U5rkFOtMPrnZrJ0291.json'

with open(plan_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

text = data[0]['text'] if isinstance(data, list) else data['text']
lines = text.split('\n')

# Save full plan
out_dir = '/Users/fengyihang/Desktop/Slipstream'
os.makedirs(out_dir, exist_ok=True)
with open(os.path.join(out_dir, 'slipstream_architecture_plan.md'), 'w', encoding='utf-8') as f:
    f.write(text)

# Print heading-based outline
print("=" * 60)
print("ARCHITECTURE PLAN OUTLINE")
print("=" * 60)
for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped.startswith('# ') or stripped.startswith('## ') or stripped.startswith('### ') or stripped.startswith('#### '):
        print(f"\n{stripped}")
    elif any(kw in stripped for kw in ['- `', '`src/', '`electron/', '`shared/']):
        print(f"  {stripped}")
    elif '->' in stripped and '**' in stripped:
        print(f"  {stripped}")

print("\n\n" + "=" * 60)
print("FILE LIST")
print("=" * 60)
for i, line in enumerate(lines):
    stripped = line.strip()
    if '`' in stripped and ('src/' in stripped or 'electron/' in stripped or 'shared/' in stripped or '/' in stripped):
        # Extract backtick paths
        parts = stripped.split('`')
        for j, p in enumerate(parts):
            if j % 2 == 1 and ('src/' in p or 'electron/' in p or 'shared/' in p or p.endswith('.ts') or p.endswith('.tsx') or p.endswith('.json') or p.endswith('.css')):
                print(f"  {p}")

print("\n\n" + "=" * 60)
print("IPC CHANNELS")
print("=" * 60)
for i, line in enumerate(lines):
    if 'ipc' in line.lower() or 'channel' in line.lower() or 'invoke' in line.lower():
        print(f"  {line.strip()}")

print("\n\n" + "=" * 60)
print("BUILD ORDER")
print("=" * 60)
in_unit = False
for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped.startswith('## ') and 'Implementation' in stripped:
        in_unit = True
    elif stripped.startswith('## ') and not 'Implementation' in stripped:
        in_unit = False
    if in_unit and (stripped.startswith('### ') or '**Unit' in stripped or 'Step' in stripped):
        print(f"  {stripped}")
