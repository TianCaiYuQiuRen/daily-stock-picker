# -*- coding: utf-8 -*-
"""选股战法定义。

三个战法对应三个选项：
  1. 砖形图战法   —— 黄白线 + 砖型图
  2. 补票战法     —— 补票指标四线（规则草案，待补充）
  3. 少妇战法     —— 黄白线 + KDJ + 14:45 涨跌幅

新增/修改战法只需在这里加一个 Strategy 子类并注册，引擎和界面无需改动。
"""


class Strategy:
    key = "base"
    name = "基础策略"
    short = "基础"
    description = ""
    params = {}

    def match(self, f):
        """返回 (是否命中, 评分, 标签列表)。"""
        raise NotImplementedError

    def param_chips(self):
        return []

    def block_name(self, prefix="智选"):
        # 通达信板块名尽量只用中文/数字，避免个别版本对特殊字符不兼容
        return ("%s%s" % (prefix, self.short))[:8]

    def meta(self):
        return {
            "key": self.key,
            "name": self.name,
            "short": self.short,
            "description": self.description,
            "chips": self.param_chips(),
            "block_name": self.block_name(),
            "params": self.params,
        }


class ZhuanXing(Strategy):
    key = "zhuanxing"
    name = "砖形图战法"
    short = "砖形图"
    description = ("股价在黄线上，且距离白线或黄线小于 5%；砖型图由绿转红"
                   "（红砖前两根内至少有一根绿砖），红砖实体 ≥ 最近一根绿砖的 2/3。"
                   "每天只保留当日选出的股票。")
    params = {
        "max_distance": 5.0,
        "body_ratio": 2.0 / 3.0,
    }

    def param_chips(self):
        return ["股价在黄线上", "距白/黄线 <5%", "红砖前 2 根内有绿砖", "红砖 ≥ 绿砖 2/3"]

    def match(self, f):
        p = self.params
        if not f["yellow"]:
            return False, 0.0, []
        if not f["above_yellow"]:
            return False, 0.0, []
        dist = min(f["dist_white"], f["dist_yellow"])
        if dist >= p["max_distance"]:
            return False, 0.0, []
        if not f["brick_ok"]:
            return False, 0.0, []

        tags = ["黄线上", "贴近白/黄线", "红砖强于绿砖"]
        score = 10.0 + (p["max_distance"] - dist) * 2.0 + min(f["brick_red_body"], 20.0) * 0.3
        return True, round(score, 2), tags


class FourTypes(Strategy):
    key = "fourtypes"
    name = "四类型好图"
    short = "四类型"
    description = ("J<13；相比前期高点的放量，今天极致缩量；小涨小跌（主板 -2%~1.8%，创业/科创 -3.5%~1.8%）；"
                   "振幅（主板 ≤4%、创业/科创 ≤7%）；白线在黄线上；回踩白线或黄线。"
                   "覆盖四种形态：N 型上涨、长洗盘、横盘箱体、高位缩量。")
    params = {
        "j_max": 13.0,
        "pct_max": 1.8,
        "pct_min_main": -2.0,
        "pct_min_growth": -3.5,
        "amp_max_main": 4.0,
        "amp_max_growth": 7.0,
        "shrink_peak": 0.35,
        "shrink_ma5": 0.85,
        "vol_expand_min": 1.4,
        "near_line": 3.0,
    }

    def param_chips(self):
        p = self.params
        return ["KDJ J < %.0f" % p["j_max"], "极致缩量（≤前高量 35%）",
                "涨跌幅 主板 -2~1.8% / 双创 -3.5~1.8%",
                "振幅 主板 ≤4% / 双创 ≤7%", "白线在黄线上", "回踩白/黄线 ≤3%"]

    @staticmethod
    def _type(f):
        if f["range20"] < 12 and f["vol_expand"] >= 1.8:
            return "类型三·横盘箱体"
        if f["pct20"] is not None and f["pct20"] > 25:
            return "类型四·高位缩量"
        if f["max_drop20"] <= -5 and f["days_since_vol_peak"] >= 8:
            return "类型二·长洗盘"
        return "类型一·N型上涨"

    def match(self, f):
        p = self.params
        if f["kdj_j"] >= p["j_max"]:
            return False, 0.0, []
        growth = f["code"].startswith(("300", "301", "688", "689"))
        pct_min = p["pct_min_growth"] if growth else p["pct_min_main"]
        if f["pct"] < pct_min or f["pct"] > p["pct_max"]:
            return False, 0.0, []
        amp_max = p["amp_max_growth"] if growth else p["amp_max_main"]
        if f["amplitude"] > amp_max:
            return False, 0.0, []
        if not f["white_above_yellow"]:
            return False, 0.0, []
        if f["vol_ratio_peak"] > p["shrink_peak"]:
            return False, 0.0, []
        if f["vol_multiple"] > p["shrink_ma5"]:
            return False, 0.0, []
        if f["vol_expand"] < p["vol_expand_min"]:
            return False, 0.0, []
        if f["near_support"] > p["near_line"]:
            return False, 0.0, []

        tags = [self._type(f), "J=%.2f" % f["kdj_j"], "地量"]
        score = (60.0 + (p["j_max"] - f["kdj_j"]) * 1.5
                 + (p["shrink_peak"] - f["vol_ratio_peak"]) * 30.0
                 + (p["near_line"] - f["near_support"]) * 2.0)
        return True, round(score, 2), tags


class Bupiao(Strategy):
    key = "bupiao"
    name = "补票战法"
    short = "补票"
    description = ("白线在黄线上（黄白线双线）；补票白线与红线此前都在 75 上方，"
                   "白线跌破 75 并下探到 20 以下、期间红线始终保持在 75 以上，"
                   "随后在 1~5 个交易日内白线重新回到 75 上方。")
    params = {
        "level": 75.0,
        "deep": 20.0,
        "dip_min": 1,
        "dip_max": 5,
    }

    def param_chips(self):
        p = self.params
        return ["双线白在黄上", "白线破 75 且下探 20 以下",
                "%d~%d 日内收回 75" % (p["dip_min"], p["dip_max"]), "期间红线 ≥ 75"]

    def match(self, f):
        p = self.params
        # 条件1：黄白线（双线）白线在黄线上
        if not f["white_above_yellow"]:
            return False, 0.0, []
        # 条件2：补票白线跌破 75 -> 跌破 20 -> 1~5 日内回到 75，红线全程 ≥75
        if not (p["dip_min"] <= f["bupiao_dip_days"] <= p["dip_max"]):
            return False, 0.0, []
        if not f["bupiao_return75"]:
            return False, 0.0, []
        if f["bupiao_dip_min"] >= p["deep"]:
            return False, 0.0, []
        if not f["bupiao_long_hold75"]:
            return False, 0.0, []
        if not f["bupiao_before75"]:
            return False, 0.0, []

        tags = ["双线多头", "白线破20", "红线托底", "白线回75"]
        score = (50.0 + (p["dip_max"] + 1 - f["bupiao_dip_days"]) * 4.0
                 + (p["deep"] - f["bupiao_dip_min"]) * 0.5 + f["bupiao_long"] * 0.2)
        return True, round(score, 2), tags


class Shaofu(Strategy):
    key = "shaofu"
    name = "少妇战法"
    short = "少妇战法"
    description = ("白线在黄线上；KDJ 的 J 值 ≤ 35 且 > -20；"
                   "当天 14:45 时涨跌幅的绝对值 < 2.45%；"
                   "最近出现连续两根收盘在黄线下，以第二根最低价下 3~5 个价位为止损，"
                   "后续收盘跌破止损则淘汰；当前收盘距黄线绝对值 ≤ 7%。")
    params = {
        "j_max": 35.0,
        "j_min": -20.0,
        "pct_abs_max": 2.45,
        "stop_ticks": 4,
        "max_dist_yellow": 7.0,
        "stop_lookback": 60,
    }

    def param_chips(self):
        p = self.params
        return ["白线在黄线上", "KDJ J ∈ (%.0f, %.0f]" % (p["j_min"], p["j_max"]),
                "14:45 涨跌幅 < %.2f%%" % p["pct_abs_max"],
                "连续2日收盘<黄线", "距黄线 ≤ %.0f%%" % p["max_dist_yellow"],
                "跌破止损淘汰"]

    def match(self, f):
        p = self.params
        if not f["white_above_yellow"]:
            return False, 0.0, []
        if not (p["j_min"] < f["kdj_j"] <= p["j_max"]):
            return False, 0.0, []
        if abs(f["pct_1445"]) >= p["pct_abs_max"]:
            return False, 0.0, []
        if abs(f["dist_yellow"]) > p["max_dist_yellow"]:
            return False, 0.0, []

        closes = f.get("hist_closes") or []
        lows = f.get("hist_lows") or []
        yellows = f.get("hist_yellows") or []
        if not closes or len(closes) != len(lows) or len(closes) != len(yellows):
            return False, 0.0, []

        ticks = min(5.0, max(3.0, float(p["stop_ticks"])))
        lookback = max(5, int(p["stop_lookback"]))
        n = len(closes)
        start = max(1, n - lookback, 114)
        second = None
        # 找最近一次“由黄线上方转为黄线下方”的起点，再确认连续第二根也在黄线下
        for i in range(n - 1, start - 1, -1):
            y0, y1 = yellows[i - 1], yellows[i]
            if not y0 or not y1:
                continue
            if closes[i] < y1 and closes[i - 1] >= y0:
                if i + 1 < n and yellows[i + 1] and closes[i + 1] < yellows[i + 1]:
                    second = i + 1
                break
        if second is None:
            return False, 0.0, []

        stop = float(lows[second]) - ticks * 0.01
        if stop <= 0:
            return False, 0.0, []
        if any(closes[k] < stop for k in range(second + 1, n)):
            return False, 0.0, []

        f["stop_loss"] = round(stop, 2)
        f["stop_ticks"] = ticks
        tags = ["白上黄", "J=%.2f" % f["kdj_j"], "14:45 平稳", "止损 %.2f" % stop]
        score = (30.0 - f["kdj_j"] * 0.5
                 + max(0.0, p["pct_abs_max"] - abs(f["pct_1445"])) * 3.0
                 + max(0.0, p["max_dist_yellow"] - abs(f["dist_yellow"])) * 0.3)
        return True, round(score, 2), tags


STRATEGIES = {
    ZhuanXing.key: ZhuanXing(),
    Bupiao.key: Bupiao(),
    Shaofu.key: Shaofu(),
    FourTypes.key: FourTypes(),
}


def get_strategy(key, overrides=None):
    base = STRATEGIES.get(key) or STRATEGIES[ZhuanXing.key]
    if not overrides:
        return base
    import copy
    s = copy.copy(base)
    s.params = dict(base.params)
    for k, v in (overrides or {}).items():
        if k not in s.params:
            continue
        try:
            if isinstance(base.params[k], int) and not isinstance(base.params[k], bool):
                s.params[k] = int(v)
            else:
                s.params[k] = float(v)
        except (TypeError, ValueError):
            continue
    return s

