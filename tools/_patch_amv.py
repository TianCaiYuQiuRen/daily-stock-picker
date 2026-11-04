# -*- coding: utf-8 -*-
import io

p = r"E:\DS工作区\每日选股\web\app.js"
s = io.open(p, encoding="utf-8").read()
start = s.index("  function renderAmv(d) {")
end = s.index("  function amvToday() {", start)
new = '''  function renderAmv(d) {
    const card = $("amvCard");
    if (!card) return;
    card.hidden = false;
    const rows = d.series || [];
    let tactic = "ok";
    for (let i = 1; i < rows.length; i++) {
      const c = Number(rows[i].chg || 0);
      const p = Number(rows[i - 1].chg || 0);
      if (c <= -2.3) tactic = "cut";
      else if (c >= 4 || c + p >= 4) tactic = "ok";
    }
    const ruleEl = $("amvRuleStatus");
    if (!ruleEl) return;
    if (rows.length < 2) {
      ruleEl.textContent = "少妇战法：需至少 2 天官方数据";
      ruleEl.className = "amv-rule-status na";
    } else {
      ruleEl.textContent = (tactic === "cut" ? "少妇战法：逐步减仓" : "少妇战法：适用期") +
        (d.source === "manual" ? "" : "（代理）");
      ruleEl.className = "amv-rule-status " + tactic;
    }
  }

'''
s = s[:start] + new + s[end:]
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("replaced", len(new))
