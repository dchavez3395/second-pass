"""
Second Pass — fill the agency's Project Accessibility Sheets template for one site.

    python export.py <site>            -> exports/<site>.xlsx  (path printed on the last line)

Reads criteria.jsonl (status + notes per criterion) and tasks.jsonl (the issue
list) and writes them into a copy of the template: the "Review WCAG V2.2" sheet
gets the site URL, a status and notes per criterion; the "Task List" sheet gets
one row per logged issue. Everything else in the template is left as it was.

The template path can be overridden with SECOND_PASS_TEMPLATE.
"""
import json
import os
import re
import shutil
import sys
from datetime import date

import openpyxl

ROOT = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.environ.get(
    "SECOND_PASS_TEMPLATE",
    r"D:\Downloads\Copy of [TEMPLATE] Project Accessibility Sheets (1).xlsx",
)


def latest(path, key):
    out = {}
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            out[key(d)] = d
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: export.py <site>")
    site = sys.argv[1]
    if not os.path.exists(TEMPLATE):
        sys.exit(f"template not found: {TEMPLATE}")

    criteria = {
        d["criterion"]: d
        for d in latest(os.path.join(ROOT, "criteria.jsonl"), lambda d: f'{d["site"]}|{d["criterion"]}').values()
        if d.get("site") == site
    }
    tasks = [
        t
        for t in latest(os.path.join(ROOT, "tasks.jsonl"), lambda d: d["id"]).values()
        if t.get("site") == site and not t.get("deleted")
    ]

    # The site's URL, from the scan record.
    url = ""
    for name in os.listdir(os.path.join(ROOT, "diagnostics")):
        if name.endswith(".json"):
            with open(os.path.join(ROOT, "diagnostics", name), encoding="utf-8") as fh:
                try:
                    rec = json.load(fh)
                except ValueError:
                    continue
            host = re.sub(r"^www\.", "", re.sub(r"^https?://", "", rec.get("url", "")).split("/")[0])
            if host == site:
                url = rec.get("url", "")
                break

    os.makedirs(os.path.join(ROOT, "exports"), exist_ok=True)
    out = os.path.join(ROOT, "exports", f"{site}.xlsx")
    shutil.copyfile(TEMPLATE, out)
    wb = openpyxl.load_workbook(out)

    # ---- Review WCAG V2.2: A2 = URL; per criterion row, D = status, E = notes
    ws = wb["Review WCAG V2.2"]
    ws["A2"] = f"{url}  (Second Pass review, {date.today().isoformat()})"
    filled = 0
    for row in ws.iter_rows(min_row=4):
        level, crit = row[0].value, row[1].value
        if level not in ("A", "AA", "AAA") or not crit:
            continue
        m = re.match(r"(\d\.\d\.\d+)", str(crit))
        if not m or m.group(1) not in criteria:
            continue
        rec = criteria[m.group(1)]
        row[3].value = rec.get("status") or "Not Evaluated"
        if rec.get("notes"):
            row[4].value = rec["notes"]
        filled += 1

    # ---- Task List: one row per issue, after the header
    tl = wb["Task List"]
    r = 2
    while tl.cell(row=r, column=3).value:  # skip any rows already holding an issue
        r += 1
    sev_by_id = {}
    for t in sorted(tasks, key=lambda t: -int(t.get("severity") or 0)):
        crit_label = ""
        for row in ws.iter_rows(min_row=4):
            if row[1].value and str(row[1].value).startswith(t.get("criterion", "") + ":"):
                crit_label = str(row[1].value)
                break
        tl.cell(row=r, column=1).value = int(t.get("severity") or 2)
        tl.cell(row=r, column=2).value = "@ _ Name"
        tl.cell(row=r, column=3).value = t.get("shortname", "")
        tl.cell(row=r, column=4).value = crit_label or t.get("criterion", "")
        tl.cell(row=r, column=5).value = t.get("status", "Not Started")
        tl.cell(row=r, column=6).value = t.get("notes", "")
        tl.cell(row=r, column=7).value = t.get("reference", "")
        r += 1

    wb.save(out)
    print(f"{filled} criteria, {len(tasks)} issues -> {out}")
    print(out)


if __name__ == "__main__":
    main()
