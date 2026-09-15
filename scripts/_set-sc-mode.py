from pathlib import Path

p = Path("/home/zam/workspace/social-hub/.env")
lines = []
found = False
for line in p.read_text().splitlines():
    if line.startswith("SC_MODE="):
        lines.append("SC_MODE=cache")
        found = True
    else:
        lines.append(line)
if not found:
    lines.append("SC_MODE=cache")
p.write_text("\n".join(lines) + "\n")
print("ok")
