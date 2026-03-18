#!/usr/bin/env python3
"""
Citrus Fantasy Sports — Finance-Grade 24-Month Business Model
Generates a professional Excel workbook with 9 tabs.
"""

import os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side, numbers
from openpyxl.utils import get_column_letter

# ── Brand Colors ──────────────────────────────────────────────────────────────
GREEN = "4A6741"
ORANGE = "D4702A"
CREAM = "F5F0E8"
LIGHT_GREEN = "D4E8B8"
INPUT_YELLOW = "FFF9E6"
RED = "CC0000"
WHITE = "FFFFFF"
LIGHT_ORANGE = "FFE8CC"

# ── Reusable Styles ──────────────────────────────────────────────────────────
header_font = Font(bold=True, color=WHITE, size=11)
header_fill = PatternFill("solid", fgColor=GREEN)
input_fill = PatternFill("solid", fgColor=INPUT_YELLOW)
input_font = Font(bold=True, color=ORANGE)
total_fill = PatternFill("solid", fgColor=CREAM)
total_border_top = Border(top=Side(style="double"))
neg_font = Font(color=RED)
pos_font = Font(color=GREEN)
section_font = Font(bold=True, size=11, color=GREEN)
subsection_font = Font(bold=True, size=10)
in_season_fill = PatternFill("solid", fgColor=LIGHT_GREEN)
off_season_fill = PatternFill("solid", fgColor=LIGHT_ORANGE)
pct_fmt = "0.0%"
usd_fmt = '#,##0'
usd_cents_fmt = '#,##0.00'
num_fmt = '#,##0'
neg_usd_fmt = '#,##0;[Red]-#,##0'

# ── Month labels ─────────────────────────────────────────────────────────────
MONTHS = [
    "Apr-26","May-26","Jun-26","Jul-26","Aug-26","Sep-26",
    "Oct-26","Nov-26","Dec-26","Jan-27","Feb-27","Mar-27",
    "Apr-27","May-27","Jun-27","Jul-27","Aug-27","Sep-27",
    "Oct-27","Nov-27","Dec-27","Jan-28","Feb-28","Mar-28",
]
# True = in-season (Oct-Mar)
IS_IN_SEASON = [
    False, False, False, False, False, False,
    True,  True,  True,  True,  True,  True,
    False, False, False, False, False, False,
    True,  True,  True,  True,  True,  True,
]

NEW_USERS = [
    150, 200, 250, 300, 400, 500,
    2000, 2500, 2200, 1800, 1500, 1200,
    1200, 1000, 900, 1200, 2000, 3500,
    17000, 20000, 20000, 18000, 16000, 13000,
]

# Conference costs by month index (0-based)
CONFERENCE_COSTS = {
    0: 750,    # Apr 2026 FSGA membership
    3: 4500,   # Jul 2026 FSGA Summer
    5: 3500,   # Sep 2026 Sports Tech
    7: 5000,   # Nov 2026 Web Summit
    10: 4000,  # Feb 2027 FSGA Winter
    11: 5000,  # Mar 2027 MIT Sloan
    12: 500,   # Apr 2027 FSGA renewal
    14: 6000,  # Jun 2027 Sports Analytics
    15: 6000,  # Jul 2027 FSGA Summer booth
    17: 5000,  # Sep 2027 Sports Tech
    19: 8000,  # Nov 2027 Web Summit premium
    22: 5000,  # Feb 2028 FSGA Winter
    23: 6000,  # Mar 2028 MIT Sloan
}

# Team costs per month
def team_cost(m):
    if m < 6:
        return 0
    elif m < 12:
        return 1500
    elif m < 18:
        return 3000
    else:
        return 6000

# Legal/Accounting per month
def legal_cost(m):
    return 200 if m < 12 else 500


# ── Helper: write a header row across cols ────────────────────────────────────
def write_header_row(ws, row, headers, start_col=1):
    for i, h in enumerate(headers):
        c = ws.cell(row=row, column=start_col + i, value=h)
        c.font = header_font
        c.fill = header_fill
        c.alignment = Alignment(horizontal="center", wrap_text=True)


def write_section_label(ws, row, col, text):
    c = ws.cell(row=row, column=col, value=text)
    c.font = section_font


def write_subsection_label(ws, row, col, text):
    c = ws.cell(row=row, column=col, value=text)
    c.font = subsection_font


def write_total_row(ws, row, start_col, end_col):
    for col in range(start_col, end_col + 1):
        ws.cell(row=row, column=col).fill = total_fill
        ws.cell(row=row, column=col).border = total_border_top


def set_col_widths(ws, widths):
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


def apply_number_format(ws, row, start_col, end_col, fmt):
    for col in range(start_col, end_col + 1):
        ws.cell(row=row, column=col).number_format = fmt


def apply_neg_color(ws, row, start_col, end_col):
    for col in range(start_col, end_col + 1):
        cell = ws.cell(row=row, column=col)
        if cell.value is not None and isinstance(cell.value, (int, float)) and cell.value < 0:
            cell.font = neg_font


def apply_pos_color(ws, row, start_col, end_col):
    for col in range(start_col, end_col + 1):
        cell = ws.cell(row=row, column=col)
        if cell.value is not None and isinstance(cell.value, (int, float)) and cell.value > 0:
            cell.font = pos_font


# ══════════════════════════════════════════════════════════════════════════════
# CORE MODEL COMPUTATION
# ══════════════════════════════════════════════════════════════════════════════

def compute_model():
    """Run the full 24-month model and return all data series."""

    # ── Assumptions ───────────────────────────────────────────────────────
    pro_price = 4.99
    comm_price = 9.99
    annual_discount = 0.20
    annual_billing_pct = 0.30
    monthly_billing_pct = 0.70

    conv_pro_y1 = 0.035
    conv_pro_y2 = 0.055
    conv_comm_y1 = 0.008
    conv_comm_y2 = 0.015
    in_season_mult = 1.8
    off_season_mult = 0.4

    churn_pro_in = 0.04
    churn_pro_off = 0.12
    churn_comm_in = 0.025
    churn_comm_off = 0.08
    churn_free_in = 0.06
    churn_free_off = 0.15

    dfs_rake_pct = 0.12
    dfs_avg_entry = 5.0
    dfs_participation = 0.10
    dfs_entries_per_user = 5
    dfs_launch_month = 18  # index 18 = Oct 2027

    ecpm = 6.0
    pageviews_in = 100
    pageviews_off = 50
    ad_eligible_pct = 0.80

    supabase_pro = 25
    supabase_team = 599
    supabase_threshold = 50000
    firebase_base = 5  # minimal early on
    claude_cost_per_query = 0.0135
    claude_queries_pro = 8
    claude_queries_comm = 20
    proxy_cost = 100
    domain_misc = 20

    apple_commission = 0.15
    google_commission = 0.15
    stripe_pct = 0.029
    stripe_flat = 0.30
    ios_split = 0.60
    android_split = 0.40

    apple_dev = 99  # annual
    google_play_reg = 25  # one-time month 0

    ai_pack_price = 1.99
    ai_pack_attach_free = 0.02
    ai_pack_attach_pro = 0.10
    draft_kit_price = 4.99
    draft_kit_attach = 0.08

    # ── State arrays ──────────────────────────────────────────────────────
    free_users = []
    pro_users = []
    comm_users = []
    total_users = []

    new_users_arr = []
    churned_free_arr = []
    churned_pro_arr = []
    churned_comm_arr = []
    conv_to_pro_arr = []
    conv_to_comm_arr = []

    # Revenue arrays
    pro_monthly_rev = []
    pro_annual_rev = []
    comm_monthly_rev = []
    comm_annual_rev = []
    annual_discount_arr = []
    net_sub_rev = []
    ai_pack_free_rev = []
    ai_pack_pro_rev = []
    draft_kit_rev = []
    net_ppu_rev = []
    dfs_gross_arr = []
    dfs_rake_rev = []
    ad_impressions_arr = []
    ad_rev_arr = []
    gross_rev_arr = []
    apple_fee_arr = []
    google_fee_arr = []
    stripe_fee_arr = []
    total_platform_fees = []
    net_rev_arr = []

    # COGS
    supabase_arr = []
    firebase_arr = []
    claude_arr = []
    proxy_arr = []
    domain_arr = []
    total_cogs = []
    gross_profit_arr = []

    # OPEX
    digital_mktg = []
    content_mktg = []
    team_arr = []
    legal_arr = []
    apple_dev_arr = []
    google_reg_arr = []
    conf_arr = []
    total_opex = []
    ebitda_arr = []

    # Running state
    f, p, co = 0, 0, 0

    for m in range(24):
        in_season = IS_IN_SEASON[m]
        year = 1 if m < 12 else 2
        new = NEW_USERS[m]

        # Conversion rates
        base_conv_pro = conv_pro_y1 if year == 1 else conv_pro_y2
        base_conv_comm = conv_comm_y1 if year == 1 else conv_comm_y2
        season_mult = in_season_mult if in_season else off_season_mult
        eff_conv_pro = base_conv_pro * season_mult
        eff_conv_comm = base_conv_comm * season_mult

        # Churn rates
        ch_free = churn_free_in if in_season else churn_free_off
        ch_pro = churn_pro_in if in_season else churn_pro_off
        ch_comm = churn_comm_in if in_season else churn_comm_off

        # Churn from existing base
        c_free = int(f * ch_free)
        c_pro = int(p * ch_pro)
        c_comm = int(co * ch_comm)

        # Conversions from free base
        to_pro = int(f * eff_conv_pro)
        to_comm = int(f * eff_conv_comm)

        # Update user pools
        f = f + new - c_free - to_pro - to_comm
        if f < 0:
            f = 0
        p = p + to_pro - c_pro
        if p < 0:
            p = 0
        co = co + to_comm - c_comm
        if co < 0:
            co = 0
        tot = f + p + co

        free_users.append(f)
        pro_users.append(p)
        comm_users.append(co)
        total_users.append(tot)
        new_users_arr.append(new)
        churned_free_arr.append(c_free)
        churned_pro_arr.append(c_pro)
        churned_comm_arr.append(c_comm)
        conv_to_pro_arr.append(to_pro)
        conv_to_comm_arr.append(to_comm)

        # ── Revenue ───────────────────────────────────────────────────────
        # Subscription
        pro_mo = p * monthly_billing_pct * pro_price
        pro_an = p * annual_billing_pct * pro_price  # gross at full price
        comm_mo = co * monthly_billing_pct * comm_price
        comm_an = co * annual_billing_pct * comm_price

        gross_sub = pro_mo + pro_an + comm_mo + comm_an
        disc = (pro_an + comm_an) * annual_discount
        net_sub = gross_sub - disc

        pro_monthly_rev.append(round(pro_mo, 2))
        pro_annual_rev.append(round(pro_an, 2))
        comm_monthly_rev.append(round(comm_mo, 2))
        comm_annual_rev.append(round(comm_an, 2))
        annual_discount_arr.append(round(disc, 2))
        net_sub_rev.append(round(net_sub, 2))

        # Pay-Per-Use
        ai_free = f * ai_pack_attach_free * ai_pack_price
        ai_pro = p * ai_pack_attach_pro * ai_pack_price
        # Draft kits: Sep and Oct each year (index 5,6 and 17,18)
        is_draft_month = m in [5, 6, 17, 18]
        dk = tot * draft_kit_attach * draft_kit_price if is_draft_month else 0
        ppu = ai_free + ai_pro + dk

        ai_pack_free_rev.append(round(ai_free, 2))
        ai_pack_pro_rev.append(round(ai_pro, 2))
        draft_kit_rev.append(round(dk, 2))
        net_ppu_rev.append(round(ppu, 2))

        # DFS
        if m >= dfs_launch_month:
            dfs_gross = tot * dfs_participation * dfs_entries_per_user * dfs_avg_entry
            dfs_rake = dfs_gross * dfs_rake_pct
        else:
            dfs_gross = 0
            dfs_rake = 0
        dfs_gross_arr.append(round(dfs_gross, 2))
        dfs_rake_rev.append(round(dfs_rake, 2))

        # Advertising
        pvs = f * (pageviews_in if in_season else pageviews_off) * ad_eligible_pct
        ad_imps = pvs / 1000  # in thousands
        ad_revenue = ad_imps * ecpm
        ad_impressions_arr.append(round(pvs, 0))
        ad_rev_arr.append(round(ad_revenue, 2))

        # Gross revenue
        gross = net_sub + ppu + dfs_rake + ad_revenue
        gross_rev_arr.append(round(gross, 2))

        # Platform fees
        # Subscription revenue split: 70% mobile (60% iOS / 40% Android), 30% web (Stripe)
        mobile_sub = net_sub * 0.70
        web_sub = net_sub * 0.30
        apple_fee = mobile_sub * ios_split * apple_commission
        google_fee = mobile_sub * android_split * google_commission
        # Stripe on web subs + PPU + DFS rake
        stripe_eligible = web_sub + ppu + dfs_rake
        n_stripe_txns = max(1, (p + co) * 0.30 + (f * ai_pack_attach_free + p * ai_pack_attach_pro))
        stripe_fee = stripe_eligible * stripe_pct + n_stripe_txns * stripe_flat if stripe_eligible > 0 else 0
        total_pf = apple_fee + google_fee + stripe_fee

        apple_fee_arr.append(round(apple_fee, 2))
        google_fee_arr.append(round(google_fee, 2))
        stripe_fee_arr.append(round(stripe_fee, 2))
        total_platform_fees.append(round(total_pf, 2))
        net_rev_arr.append(round(gross - total_pf, 2))

        # ── COGS ──────────────────────────────────────────────────────────
        sb = supabase_team if tot > supabase_threshold else supabase_pro
        # Firebase scales with traffic
        fb = firebase_base + max(0, tot - 1000) * 0.001  # rough scaling
        cl = (p * claude_queries_pro + co * claude_queries_comm) * claude_cost_per_query
        pr = proxy_cost
        dm = domain_misc
        cogs = sb + fb + cl + pr + dm

        supabase_arr.append(round(sb, 2))
        firebase_arr.append(round(fb, 2))
        claude_arr.append(round(cl, 2))
        proxy_arr.append(round(pr, 2))
        domain_arr.append(round(dm, 2))
        total_cogs.append(round(cogs, 2))
        gp = (gross - total_pf) - cogs
        gross_profit_arr.append(round(gp, 2))

        # ── OPEX ──────────────────────────────────────────────────────────
        # Marketing: scale with user acquisition
        dig_mkt = new * 2.50  # ~$2.50 blended CAC target
        cont_mkt = 200 if m < 12 else 500
        tm = team_cost(m)
        lg = legal_cost(m)
        ad_fee = 99 / 12  # spread Apple Dev annual
        gr = google_play_reg if m == 0 else 0
        cf = CONFERENCE_COSTS.get(m, 0)

        sm_total = dig_mkt + cont_mkt
        ga_total = tm + lg + ad_fee + gr
        ct_total = cf
        opex = sm_total + ga_total + ct_total

        digital_mktg.append(round(dig_mkt, 2))
        content_mktg.append(round(cont_mkt, 2))
        team_arr.append(round(tm, 2))
        legal_arr.append(round(lg, 2))
        apple_dev_arr.append(round(ad_fee, 2))
        google_reg_arr.append(round(gr, 2))
        conf_arr.append(round(cf, 2))
        total_opex.append(round(opex, 2))

        ebitda = gp - opex
        ebitda_arr.append(round(ebitda, 2))

    return {
        "free": free_users, "pro": pro_users, "comm": comm_users, "total": total_users,
        "new": new_users_arr, "ch_free": churned_free_arr, "ch_pro": churned_pro_arr,
        "ch_comm": churned_comm_arr, "to_pro": conv_to_pro_arr, "to_comm": conv_to_comm_arr,
        "pro_mo_rev": pro_monthly_rev, "pro_an_rev": pro_annual_rev,
        "comm_mo_rev": comm_monthly_rev, "comm_an_rev": comm_annual_rev,
        "ann_disc": annual_discount_arr, "net_sub": net_sub_rev,
        "ai_free": ai_pack_free_rev, "ai_pro": ai_pack_pro_rev,
        "draft_kit": draft_kit_rev, "net_ppu": net_ppu_rev,
        "dfs_gross": dfs_gross_arr, "dfs_rake": dfs_rake_rev,
        "ad_imps": ad_impressions_arr, "ad_rev": ad_rev_arr,
        "gross_rev": gross_rev_arr,
        "apple_fee": apple_fee_arr, "google_fee": google_fee_arr,
        "stripe_fee": stripe_fee_arr, "total_pf": total_platform_fees,
        "net_rev": net_rev_arr,
        "supabase": supabase_arr, "firebase": firebase_arr, "claude": claude_arr,
        "proxy": proxy_arr, "domain": domain_arr, "total_cogs": total_cogs,
        "gross_profit": gross_profit_arr,
        "dig_mkt": digital_mktg, "cont_mkt": content_mktg,
        "team": team_arr, "legal": legal_arr, "apple_dev": apple_dev_arr,
        "google_reg": google_reg_arr, "conf": conf_arr,
        "total_opex": total_opex, "ebitda": ebitda_arr,
    }


# ══════════════════════════════════════════════════════════════════════════════
# WORKBOOK BUILDER
# ══════════════════════════════════════════════════════════════════════════════

def build_workbook():
    d = compute_model()
    wb = Workbook()

    # ──────────────────────────────────────────────────────────────────────
    # TAB 1: ASSUMPTIONS
    # ──────────────────────────────────────────────────────────────────────
    ws = wb.active
    ws.title = "Assumptions"
    set_col_widths(ws, [40, 18, 14, 65])
    write_header_row(ws, 1, ["Assumption", "Value", "Unit", "Source / Citation"])

    assumptions = [
        ("MARKET", None, None, None),
        ("TAM — Fantasy Sports (2025)", "$32B+", "USD", "Mordor Intelligence Fantasy Sports Report"),
        ("SAM — Fantasy Hockey Global", "$1-2B", "USD", "Industry estimates"),
        ("Active Fantasy Hockey Players (NA)", "5,800,000", "Users", "FSGA industry data"),
        ("NHL Fantasy CAGR", "14.6%", "%", "Mordor Intelligence"),
        ("", None, None, None),
        ("PRICING", None, None, None),
        ("Free Tier", "$0.00", "USD/mo", ""),
        ("Pro Tier — Monthly", "$4.99", "USD/mo", ""),
        ("Commissioner Tier — Monthly", "$9.99", "USD/mo", ""),
        ("Annual Billing Discount", "20%", "%", "Industry standard"),
        ("", None, None, None),
        ("BILLING MIX", None, None, None),
        ("Annual Billing %", "30%", "%", "Industry benchmarks"),
        ("Monthly Billing %", "70%", "%", ""),
        ("", None, None, None),
        ("CONVERSION RATES", None, None, None),
        ("Free → Pro Y1", "3.5%", "%", "OpenView/Lenny's Newsletter freemium benchmarks"),
        ("Free → Pro Y2", "5.5%", "%", "Product maturation + mobile app"),
        ("Free → Commissioner Y1", "0.8%", "%", "Commissioner is power-user tier"),
        ("Free → Commissioner Y2", "1.5%", "%", ""),
        ("In-Season Multiplier", "1.8x", "x", "NHL engagement seasonality"),
        ("Off-Season Multiplier", "0.4x", "x", ""),
        ("Mobile Freemium Median", "2.18%", "%", "RevenueCat State of Subscription Apps 2025"),
        ("", None, None, None),
        ("CHURN RATES (Monthly)", None, None, None),
        ("Pro In-Season", "4.0%", "%", "Below mobile subscription avg 9% (MarketingLTB)"),
        ("Pro Off-Season", "12.0%", "%", "Seasonal disengagement"),
        ("Commissioner In-Season", "2.5%", "%", "Stickier due to league management"),
        ("Commissioner Off-Season", "8.0%", "%", ""),
        ("Free In-Season", "6.0%", "%", ""),
        ("Free Off-Season", "15.0%", "%", ""),
        ("Sleeper Annual Retention", "75%", "%", "Sleeper PR / Series C announcement"),
        ("", None, None, None),
        ("PAY-PER-USE", None, None, None),
        ("Stormy AI Query Pack Price", "$1.99", "USD", "Per 50-query pack"),
        ("AI Pack Attach — Free Users", "2.0%", "%/mo", ""),
        ("AI Pack Attach — Pro Users", "10.0%", "%/mo", ""),
        ("Draft Kit Price", "$4.99", "USD", "One-time per season (Sep/Oct)"),
        ("Draft Kit Attach Rate", "8.0%", "%", "All users in draft months"),
        ("", None, None, None),
        ("DFS", None, None, None),
        ("DFS Rake", "12%", "%", "DraftKings/FanDuel range 10-16%"),
        ("Average Entry Fee", "$5.00", "USD", ""),
        ("Participation Rate", "10%", "%", "Of total users"),
        ("Entries per User per Month", "5", "#", ""),
        ("DFS Launch Month", "Oct 2027", "Month 19", ""),
        ("", None, None, None),
        ("ADVERTISING", None, None, None),
        ("Blended eCPM", "$6.00", "USD", "BusinessOfApps / Appodeal CPM benchmarks"),
        ("Pageviews/Free User In-Season", "100", "#/mo", ""),
        ("Pageviews/Free User Off-Season", "50", "#/mo", ""),
        ("Ad-Eligible %", "80%", "%", "Excluding ad-blockers"),
        ("", None, None, None),
        ("INFRASTRUCTURE", None, None, None),
        ("Supabase Pro", "$25", "USD/mo", "supabase.com/pricing"),
        ("Supabase Team (>50K users)", "$599", "USD/mo", "supabase.com/pricing"),
        ("Firebase Hosting", "$0.15/GB", "USD/GB", "firebase.google.com pricing"),
        ("Claude API (Stormy) Cost/Query", "$0.0135", "USD", "Sonnet: $3/MTok in, $15/MTok out"),
        ("Claude Queries — Pro Users", "8", "#/mo", ""),
        ("Claude Queries — Commish Users", "20", "#/mo", ""),
        ("Proxy Rotation", "$100", "USD/mo", ""),
        ("Domain / SSL / Misc", "$20", "USD/mo", ""),
        ("", None, None, None),
        ("PLATFORM FEES", None, None, None),
        ("Apple App Store Commission", "15%", "%", "Small Business Program (<$1M rev)"),
        ("Google Play Commission", "15%", "%", "Reduced service fee for subs"),
        ("Stripe Processing", "2.9% + $0.30", "%+flat", "stripe.com/pricing"),
        ("Mobile Revenue Split — iOS", "60%", "%", ""),
        ("Mobile Revenue Split — Android", "40%", "%", ""),
        ("Mobile vs Web Split", "70% / 30%", "%", ""),
        ("Apple Developer Program", "$99", "USD/yr", "developer.apple.com"),
        ("Google Play Registration", "$25", "USD", "One-time"),
        ("", None, None, None),
        ("MARKETING", None, None, None),
        ("DraftKings/FanDuel CAC (comp)", "$200-350", "USD", "BusinessOfApps UA costs"),
        ("Citrus Target CAC", "$2-5", "USD", "Organic/community-driven"),
        ("NA Mobile CPI (benchmark)", "$5.28", "USD", "BusinessOfApps"),
        ("", None, None, None),
        ("TEAM", None, None, None),
        ("Months 1-6 (Solo Founder)", "$0", "USD/mo", "Bootstrapped CPA founder"),
        ("Months 7-12 (1 PT Contractor)", "$1,500", "USD/mo", ""),
        ("Months 13-18 (1-2 Contractors)", "$3,000", "USD/mo", ""),
        ("Months 19-24 (Small Team)", "$6,000", "USD/mo", ""),
        ("", None, None, None),
        ("LEGAL / ACCOUNTING", None, None, None),
        ("Year 1", "$200", "USD/mo", "Bookkeeping, tax prep"),
        ("Year 2", "$500", "USD/mo", "DFS legal compliance added"),
    ]

    for i, (label, val, unit, source) in enumerate(assumptions):
        r = i + 2
        ws.cell(row=r, column=1, value=label)
        if label and label.isupper() and val is None:
            ws.cell(row=r, column=1).font = section_font
        elif val is not None:
            ws.cell(row=r, column=1).font = Font(size=10)
            c2 = ws.cell(row=r, column=2, value=val)
            c2.fill = input_fill
            c2.font = input_font
            c2.alignment = Alignment(horizontal="center")
            ws.cell(row=r, column=3, value=unit).alignment = Alignment(horizontal="center")
            ws.cell(row=r, column=4, value=source or "")

    # ──────────────────────────────────────────────────────────────────────
    # TAB 2: USER GROWTH
    # ──────────────────────────────────────────────────────────────────────
    ws2 = wb.create_sheet("User Growth")
    set_col_widths(ws2, [32] + [13] * 24)

    headers = ["Metric"] + MONTHS
    write_header_row(ws2, 1, headers)

    # Season status row styling helper
    def write_season_row(ws, row):
        ws.cell(row=row, column=1, value="NHL Season Status")
        ws.cell(row=row, column=1).font = subsection_font
        for i in range(24):
            c = ws.cell(row=row, column=i + 2)
            if IS_IN_SEASON[i]:
                c.value = "IN-SEASON"
                c.fill = in_season_fill
            else:
                c.value = "OFF-SEASON"
                c.fill = off_season_fill
            c.alignment = Alignment(horizontal="center")
            c.font = Font(size=9)

    rows_data = [
        ("New Users Acquired", d["new"], num_fmt),
        ("Churned Free Users", d["ch_free"], num_fmt),
        ("Churned Pro Users", d["ch_pro"], num_fmt),
        ("Churned Commissioner Users", d["ch_comm"], num_fmt),
        ("Conversions to Pro", d["to_pro"], num_fmt),
        ("Conversions to Commissioner", d["to_comm"], num_fmt),
        None,  # blank
        ("End-of-Month Free Users", d["free"], num_fmt),
        ("End-of-Month Pro Users", d["pro"], num_fmt),
        ("End-of-Month Commissioner Users", d["comm"], num_fmt),
        ("End-of-Month TOTAL Users", d["total"], num_fmt),
    ]

    r = 2
    write_season_row(ws2, r)
    r += 1

    for item in rows_data:
        if item is None:
            r += 1
            continue
        label, arr, fmt = item
        ws2.cell(row=r, column=1, value=label)
        if "TOTAL" in label:
            ws2.cell(row=r, column=1).font = subsection_font
        for i, v in enumerate(arr):
            c = ws2.cell(row=r, column=i + 2, value=v)
            c.number_format = fmt
            c.alignment = Alignment(horizontal="right")
        if "TOTAL" in label:
            write_total_row(ws2, r, 1, 25)
        r += 1

    # Premium % row
    ws2.cell(row=r, column=1, value="Premium % of Total")
    for i in range(24):
        tot = d["total"][i]
        paid = d["pro"][i] + d["comm"][i]
        val = paid / tot if tot > 0 else 0
        c = ws2.cell(row=r, column=i + 2, value=round(val, 4))
        c.number_format = pct_fmt
        c.alignment = Alignment(horizontal="right")
    r += 1

    # Blended monthly churn
    ws2.cell(row=r, column=1, value="Blended Monthly Churn Rate")
    for i in range(24):
        total_churned = d["ch_free"][i] + d["ch_pro"][i] + d["ch_comm"][i]
        base = d["total"][i] + total_churned  # beginning of month approx
        val = total_churned / base if base > 0 else 0
        c = ws2.cell(row=r, column=i + 2, value=round(val, 4))
        c.number_format = pct_fmt
        c.alignment = Alignment(horizontal="right")
    r += 1

    ws2.cell(row=r, column=1, value="Monthly Retention Rate")
    for i in range(24):
        total_churned = d["ch_free"][i] + d["ch_pro"][i] + d["ch_comm"][i]
        base = d["total"][i] + total_churned
        val = 1 - (total_churned / base) if base > 0 else 1
        c = ws2.cell(row=r, column=i + 2, value=round(val, 4))
        c.number_format = pct_fmt
        c.alignment = Alignment(horizontal="right")

    # ──────────────────────────────────────────────────────────────────────
    # TAB 3: REVENUE
    # ──────────────────────────────────────────────────────────────────────
    ws3 = wb.create_sheet("Revenue")
    set_col_widths(ws3, [38] + [14] * 24)
    write_header_row(ws3, 1, ["Revenue Line"] + MONTHS)

    rev_rows = [
        ("SUBSCRIPTION REVENUE", None, None, True),
        ("  Pro Monthly Billing", d["pro_mo_rev"], usd_fmt, False),
        ("  Pro Annual Billing", d["pro_an_rev"], usd_fmt, False),
        ("  Commissioner Monthly Billing", d["comm_mo_rev"], usd_fmt, False),
        ("  Commissioner Annual Billing", d["comm_an_rev"], usd_fmt, False),
        ("  Gross Subscription Revenue", [d["pro_mo_rev"][i] + d["pro_an_rev"][i] + d["comm_mo_rev"][i] + d["comm_an_rev"][i] for i in range(24)], usd_fmt, False),
        ("  Less: Annual Billing Discount", [-d["ann_disc"][i] for i in range(24)], usd_fmt, False),
        ("  NET SUBSCRIPTION REVENUE", d["net_sub"], usd_fmt, True),
        ("", None, None, False),
        ("PAY-PER-USE REVENUE", None, None, True),
        ("  Stormy AI Query Packs (Free)", d["ai_free"], usd_fmt, False),
        ("  Stormy AI Query Packs (Pro)", d["ai_pro"], usd_fmt, False),
        ("  Draft Kits (Seasonal)", d["draft_kit"], usd_fmt, False),
        ("  NET PAY-PER-USE REVENUE", d["net_ppu"], usd_fmt, True),
        ("", None, None, False),
        ("DFS REVENUE", None, None, True),
        ("  Gross DFS Entry Fees (info)", d["dfs_gross"], usd_fmt, False),
        ("  DFS Rake Revenue (12%)", d["dfs_rake"], usd_fmt, False),
        ("  NET DFS REVENUE", d["dfs_rake"], usd_fmt, True),
        ("", None, None, False),
        ("ADVERTISING REVENUE", None, None, True),
        ("  Ad Impressions (000s)", [round(v / 1000, 1) for v in d["ad_imps"]], num_fmt, False),
        ("  Ad Revenue (eCPM $6)", d["ad_rev"], usd_fmt, False),
        ("  NET ADVERTISING REVENUE", d["ad_rev"], usd_fmt, True),
        ("", None, None, False),
        ("GROSS REVENUE", d["gross_rev"], usd_fmt, True),
        ("Less: Platform Fees", None, None, True),
        ("  Apple App Store (15%)", d["apple_fee"], usd_fmt, False),
        ("  Google Play (15%)", d["google_fee"], usd_fmt, False),
        ("  Stripe Processing", d["stripe_fee"], usd_fmt, False),
        ("  Total Platform Fees", d["total_pf"], usd_fmt, False),
        ("NET REVENUE", d["net_rev"], usd_fmt, True),
    ]

    r = 2
    for label, arr, fmt, is_section in rev_rows:
        ws3.cell(row=r, column=1, value=label)
        if is_section:
            ws3.cell(row=r, column=1).font = section_font if arr is None else subsection_font
        if arr is not None:
            for i, v in enumerate(arr):
                c = ws3.cell(row=r, column=i + 2, value=v)
                c.number_format = fmt
                c.alignment = Alignment(horizontal="right")
                if isinstance(v, (int, float)) and v < 0:
                    c.font = neg_font
        if is_section and arr is not None:
            write_total_row(ws3, r, 1, 25)
        r += 1

    # Revenue mix, MRR, ARR, Cumulative
    r += 1
    ws3.cell(row=r, column=1, value="REVENUE MIX (% of Gross)").font = section_font
    r += 1
    for mix_label, mix_arr in [
        ("  Subscription %", d["net_sub"]),
        ("  Pay-Per-Use %", d["net_ppu"]),
        ("  DFS %", d["dfs_rake"]),
        ("  Advertising %", d["ad_rev"]),
    ]:
        ws3.cell(row=r, column=1, value=mix_label)
        for i in range(24):
            gr = d["gross_rev"][i]
            val = mix_arr[i] / gr if gr > 0 else 0
            c = ws3.cell(row=r, column=i + 2, value=round(val, 4))
            c.number_format = pct_fmt
            c.alignment = Alignment(horizontal="right")
        r += 1

    r += 1
    ws3.cell(row=r, column=1, value="MRR (Subscription Only)").font = subsection_font
    for i in range(24):
        c = ws3.cell(row=r, column=i + 2, value=d["net_sub"][i])
        c.number_format = usd_fmt
        c.alignment = Alignment(horizontal="right")
    r += 1

    ws3.cell(row=r, column=1, value="ARR (= MRR x 12)").font = subsection_font
    for i in range(24):
        c = ws3.cell(row=r, column=i + 2, value=round(d["net_sub"][i] * 12, 2))
        c.number_format = usd_fmt
        c.alignment = Alignment(horizontal="right")
    r += 1

    cumulative_net = []
    running = 0
    for v in d["net_rev"]:
        running += v
        cumulative_net.append(round(running, 2))

    ws3.cell(row=r, column=1, value="Cumulative Net Revenue").font = subsection_font
    for i in range(24):
        c = ws3.cell(row=r, column=i + 2, value=cumulative_net[i])
        c.number_format = usd_fmt
        c.alignment = Alignment(horizontal="right")
    write_total_row(ws3, r, 1, 25)

    # ──────────────────────────────────────────────────────────────────────
    # TAB 4: COGS & OPEX
    # ──────────────────────────────────────────────────────────────────────
    ws4 = wb.create_sheet("COGS & Operating Expenses")
    set_col_widths(ws4, [38] + [14] * 24)
    write_header_row(ws4, 1, ["Cost Line"] + MONTHS)

    gross_margin = [round(d["gross_profit"][i] / d["net_rev"][i], 4) if d["net_rev"][i] > 0 else 0 for i in range(24)]
    ebitda_margin = [round(d["ebitda"][i] / d["net_rev"][i], 4) if d["net_rev"][i] > 0 else 0 for i in range(24)]

    sm_total = [d["dig_mkt"][i] + d["cont_mkt"][i] for i in range(24)]
    ga_total = [d["team"][i] + d["legal"][i] + d["apple_dev"][i] + d["google_reg"][i] for i in range(24)]

    cost_rows = [
        ("COST OF GOODS SOLD (COGS)", None, None, True),
        ("  Supabase (Database + Auth)", d["supabase"], usd_fmt, False),
        ("  Firebase Hosting", d["firebase"], usd_cents_fmt, False),
        ("  Claude API (Stormy AI)", d["claude"], usd_cents_fmt, False),
        ("  Proxy Rotation (Data Pipeline)", d["proxy"], usd_fmt, False),
        ("  Domain / SSL / Misc", d["domain"], usd_fmt, False),
        ("  TOTAL COGS", d["total_cogs"], usd_fmt, True),
        ("", None, None, False),
        ("GROSS PROFIT", d["gross_profit"], usd_fmt, True),
        ("GROSS MARGIN %", gross_margin, pct_fmt, False),
        ("", None, None, False),
        ("OPERATING EXPENSES (OPEX)", None, None, True),
        ("  SALES & MARKETING", None, None, True),
        ("    Digital Marketing", d["dig_mkt"], usd_fmt, False),
        ("    Content Marketing", d["cont_mkt"], usd_fmt, False),
        ("    Total Sales & Marketing", sm_total, usd_fmt, True),
        ("", None, None, False),
        ("  GENERAL & ADMINISTRATIVE", None, None, True),
        ("    Contractors / Team", d["team"], usd_fmt, False),
        ("    Legal & Accounting", d["legal"], usd_fmt, False),
        ("    Apple Developer Program", d["apple_dev"], usd_cents_fmt, False),
        ("    Google Play Registration", d["google_reg"], usd_fmt, False),
        ("    Total G&A", ga_total, usd_fmt, True),
        ("", None, None, False),
        ("  CONFERENCE & TRAVEL", None, None, True),
        ("    Conference Costs", d["conf"], usd_fmt, False),
        ("    Total Conference & Travel", d["conf"], usd_fmt, True),
        ("", None, None, False),
        ("  TOTAL OPEX", d["total_opex"], usd_fmt, True),
        ("", None, None, False),
        ("EBITDA", d["ebitda"], usd_fmt, True),
        ("EBITDA MARGIN %", ebitda_margin, pct_fmt, False),
        ("", None, None, False),
        ("NET INCOME", d["ebitda"], usd_fmt, True),
    ]

    r = 2
    for label, arr, fmt, is_section in cost_rows:
        ws4.cell(row=r, column=1, value=label)
        if is_section:
            ws4.cell(row=r, column=1).font = section_font if arr is None else subsection_font
        if arr is not None:
            for i, v in enumerate(arr):
                c = ws4.cell(row=r, column=i + 2, value=v)
                c.number_format = fmt
                c.alignment = Alignment(horizontal="right")
                if isinstance(v, (int, float)) and v < 0:
                    c.font = neg_font
                elif label in ("EBITDA", "NET INCOME", "GROSS PROFIT") and isinstance(v, (int, float)) and v > 0:
                    c.font = pos_font
        if is_section and arr is not None:
            write_total_row(ws4, r, 1, 25)
        r += 1

    # ──────────────────────────────────────────────────────────────────────
    # TAB 5: UNIT ECONOMICS
    # ──────────────────────────────────────────────────────────────────────
    ws5 = wb.create_sheet("Unit Economics")
    set_col_widths(ws5, [38] + [14] * 24)
    write_header_row(ws5, 1, ["Metric"] + MONTHS)

    paid_users = [d["pro"][i] + d["comm"][i] for i in range(24)]
    arpu_total = [round(d["net_rev"][i] / d["total"][i], 4) if d["total"][i] > 0 else 0 for i in range(24)]
    arpu_paid = [round(d["net_sub"][i] / paid_users[i], 2) if paid_users[i] > 0 else 0 for i in range(24)]
    blended_churn_paid = [
        round((d["ch_pro"][i] + d["ch_comm"][i]) / (paid_users[i] + d["ch_pro"][i] + d["ch_comm"][i]), 4)
        if (paid_users[i] + d["ch_pro"][i] + d["ch_comm"][i]) > 0 else 0
        for i in range(24)
    ]
    ltv = [round(arpu_paid[i] / blended_churn_paid[i], 2) if blended_churn_paid[i] > 0 else 0 for i in range(24)]
    cac = [round((d["dig_mkt"][i] + d["cont_mkt"][i]) / d["new"][i], 2) if d["new"][i] > 0 else 0 for i in range(24)]
    ltv_cac = [round(ltv[i] / cac[i], 1) if cac[i] > 0 else 0 for i in range(24)]
    payback = [round(cac[i] / arpu_paid[i], 1) if arpu_paid[i] > 0 else 0 for i in range(24)]
    # Team headcount: rough
    team_count = [0 if i < 6 else 1 if i < 12 else 2 if i < 18 else 3 for i in range(24)]
    rev_per_emp = [round(d["net_rev"][i] / team_count[i], 2) if team_count[i] > 0 else 0 for i in range(24)]

    ue_rows = [
        ("ARPU (Total) — Net Rev / Users", arpu_total, usd_cents_fmt),
        ("ARPU (Paid) — Sub Rev / Paid", arpu_paid, usd_cents_fmt),
        ("Paid Subscribers", paid_users, num_fmt),
        ("Blended Monthly Churn (Paid)", blended_churn_paid, pct_fmt),
        ("Implied LTV (ARPU / Churn)", ltv, usd_fmt),
        ("CAC (S&M / New Users)", cac, usd_cents_fmt),
        ("LTV:CAC Ratio", ltv_cac, "0.0x"),
        ("Payback Period (months)", payback, "0.0"),
        ("Team Size (approx)", team_count, num_fmt),
        ("Revenue Per Employee", rev_per_emp, usd_fmt),
    ]

    r = 2
    for label, arr, fmt in ue_rows:
        ws5.cell(row=r, column=1, value=label)
        ws5.cell(row=r, column=1).font = Font(size=10)
        for i, v in enumerate(arr):
            c = ws5.cell(row=r, column=i + 2, value=v)
            c.number_format = fmt
            c.alignment = Alignment(horizontal="right")
        r += 1

    # ──────────────────────────────────────────────────────────────────────
    # TAB 6: CASH FLOW & RUNWAY
    # ──────────────────────────────────────────────────────────────────────
    ws6 = wb.create_sheet("Cash Flow & Runway")
    set_col_widths(ws6, [38] + [14] * 24)
    write_header_row(ws6, 1, ["Cash Flow"] + MONTHS)

    starting_cash = 1000
    cash_position = []
    running_cash = starting_cash
    for i in range(24):
        running_cash += d["ebitda"][i]
        cash_position.append(round(running_cash, 2))

    burn_rate = [-d["ebitda"][i] if d["ebitda"][i] < 0 else 0 for i in range(24)]
    runway = [round(cash_position[i] / burn_rate[i], 1) if burn_rate[i] > 0 and cash_position[i] > 0 else 0 for i in range(24)]

    # Find cash flow positive month
    cf_positive_month = "N/A"
    for i in range(24):
        if d["ebitda"][i] > 0:
            cf_positive_month = MONTHS[i]
            break

    cf_rows = [
        ("Starting Cash", [starting_cash] + [None] * 23, usd_fmt),
        ("Monthly Net Income (EBITDA)", d["ebitda"], usd_fmt),
        ("Cumulative Cash Position", cash_position, usd_fmt),
        ("Monthly Burn Rate", burn_rate, usd_fmt),
        ("Runway (months)", runway, "0.0"),
    ]

    r = 2
    for label, arr, fmt in cf_rows:
        ws6.cell(row=r, column=1, value=label)
        ws6.cell(row=r, column=1).font = Font(size=10, bold=True) if "Cash Position" in label else Font(size=10)
        for i, v in enumerate(arr):
            if v is not None:
                c = ws6.cell(row=r, column=i + 2, value=v)
                c.number_format = fmt
                c.alignment = Alignment(horizontal="right")
                if isinstance(v, (int, float)) and v < 0:
                    c.font = neg_font
                elif label == "Cumulative Cash Position" and isinstance(v, (int, float)) and v > 0:
                    c.font = pos_font
        if "Cash Position" in label:
            write_total_row(ws6, r, 1, 25)
        r += 1

    r += 1
    ws6.cell(row=r, column=1, value="Cash Flow Positive Month:").font = subsection_font
    ws6.cell(row=r, column=2, value=cf_positive_month).font = Font(bold=True, color=GREEN)

    # ──────────────────────────────────────────────────────────────────────
    # TAB 7: ANNUAL SUMMARY
    # ──────────────────────────────────────────────────────────────────────
    ws7 = wb.create_sheet("Annual Summary")
    set_col_widths(ws7, [38, 18, 18, 18])
    write_header_row(ws7, 1, ["Metric", "Year 1 (Apr 26-Mar 27)", "Year 2 (Apr 27-Mar 28)", "YoY Growth %"])

    def y1_sum(arr): return round(sum(arr[:12]), 2)
    def y2_sum(arr): return round(sum(arr[12:]), 2)
    def yoy(a1, a2): return round((a2 - a1) / abs(a1), 4) if a1 != 0 else 0

    summary_rows = [
        ("KEY METRICS", None, None, None, True),
        ("End-of-Year Total Users", d["total"][11], d["total"][23], None, False),
        ("End-of-Year Pro Users", d["pro"][11], d["pro"][23], None, False),
        ("End-of-Year Commissioner Users", d["comm"][11], d["comm"][23], None, False),
        ("", None, None, None, False),
        ("REVENUE", None, None, None, True),
        ("Net Subscription Revenue", y1_sum(d["net_sub"]), y2_sum(d["net_sub"]), yoy(y1_sum(d["net_sub"]), y2_sum(d["net_sub"])), False),
        ("Pay-Per-Use Revenue", y1_sum(d["net_ppu"]), y2_sum(d["net_ppu"]), yoy(max(1, y1_sum(d["net_ppu"])), y2_sum(d["net_ppu"])), False),
        ("DFS Rake Revenue", y1_sum(d["dfs_rake"]), y2_sum(d["dfs_rake"]), None, False),
        ("Advertising Revenue", y1_sum(d["ad_rev"]), y2_sum(d["ad_rev"]), yoy(max(1, y1_sum(d["ad_rev"])), y2_sum(d["ad_rev"])), False),
        ("Gross Revenue", y1_sum(d["gross_rev"]), y2_sum(d["gross_rev"]), yoy(y1_sum(d["gross_rev"]), y2_sum(d["gross_rev"])), False),
        ("Platform Fees", y1_sum(d["total_pf"]), y2_sum(d["total_pf"]), None, False),
        ("Net Revenue", y1_sum(d["net_rev"]), y2_sum(d["net_rev"]), yoy(y1_sum(d["net_rev"]), y2_sum(d["net_rev"])), False),
        ("", None, None, None, False),
        ("COSTS", None, None, None, True),
        ("Total COGS", y1_sum(d["total_cogs"]), y2_sum(d["total_cogs"]), None, False),
        ("Gross Profit", y1_sum(d["gross_profit"]), y2_sum(d["gross_profit"]), yoy(y1_sum(d["gross_profit"]), y2_sum(d["gross_profit"])), False),
        ("Total OPEX", y1_sum(d["total_opex"]), y2_sum(d["total_opex"]), None, False),
        ("EBITDA / Net Income", y1_sum(d["ebitda"]), y2_sum(d["ebitda"]), None, False),
        ("", None, None, None, False),
        ("MARGINS", None, None, None, True),
        ("Gross Margin %", round(y1_sum(d["gross_profit"]) / y1_sum(d["net_rev"]), 4) if y1_sum(d["net_rev"]) != 0 else 0,
         round(y2_sum(d["gross_profit"]) / y2_sum(d["net_rev"]), 4) if y2_sum(d["net_rev"]) != 0 else 0, None, False),
        ("EBITDA Margin %", round(y1_sum(d["ebitda"]) / y1_sum(d["net_rev"]), 4) if y1_sum(d["net_rev"]) != 0 else 0,
         round(y2_sum(d["ebitda"]) / y2_sum(d["net_rev"]), 4) if y2_sum(d["net_rev"]) != 0 else 0, None, False),
    ]

    r = 2
    for label, v1, v2, growth, is_section in summary_rows:
        ws7.cell(row=r, column=1, value=label)
        if is_section:
            ws7.cell(row=r, column=1).font = section_font
        else:
            if v1 is not None:
                fmt = pct_fmt if "Margin" in label else (num_fmt if "Users" in label else usd_fmt)
                c1 = ws7.cell(row=r, column=2, value=v1)
                c1.number_format = fmt
                c1.alignment = Alignment(horizontal="right")
                c2 = ws7.cell(row=r, column=3, value=v2)
                c2.number_format = fmt
                c2.alignment = Alignment(horizontal="right")
                if isinstance(v1, (int, float)) and v1 < 0:
                    c1.font = neg_font
                if isinstance(v2, (int, float)) and v2 < 0:
                    c2.font = neg_font
                if isinstance(v2, (int, float)) and v2 > 0 and ("EBITDA" in label or "Profit" in label or "Net Income" in label):
                    c2.font = pos_font
            if growth is not None:
                c3 = ws7.cell(row=r, column=4, value=growth)
                c3.number_format = pct_fmt
                c3.alignment = Alignment(horizontal="right")
        r += 1

    # ──────────────────────────────────────────────────────────────────────
    # TAB 8: SENSITIVITY ANALYSIS
    # ──────────────────────────────────────────────────────────────────────
    ws8 = wb.create_sheet("Sensitivity Analysis")
    set_col_widths(ws8, [35, 16, 16, 16, 16, 16])

    def run_scenario_conv(conv_pro_y2_val):
        """Quick rerun varying Y2 pro conversion rate."""
        base_conv = 0.055
        ratio = conv_pro_y2_val / base_conv
        y2_sub = y2_sum(d["net_sub"]) * ratio
        y2_gross = y2_sub + y2_sum(d["net_ppu"]) + y2_sum(d["dfs_rake"]) + y2_sum(d["ad_rev"])
        return round(y2_gross, 0)

    def run_scenario_churn(churn_val):
        """Quick sensitivity on paid churn."""
        base_churn = 0.04
        retention_ratio = (1 - churn_val) / (1 - base_churn)
        factor = retention_ratio ** 6  # compounded over 6 in-season months
        y2_sub = y2_sum(d["net_sub"]) * factor
        y2_gross = y2_sub + y2_sum(d["net_ppu"]) + y2_sum(d["dfs_rake"]) + y2_sum(d["ad_rev"])
        return round(y2_gross, 0)

    # Conversion sensitivity
    r = 2
    write_section_label(ws8, r, 1, "CONVERSION RATE SENSITIVITY (Y2 Pro)")
    r += 1
    write_header_row(ws8, r, ["Conv Rate", "Y2 Gross Rev (est)", "vs Base", "", ""], 1)
    r += 1
    for cv in [0.02, 0.035, 0.055, 0.08, 0.10]:
        rev = run_scenario_conv(cv)
        base = run_scenario_conv(0.055)
        ws8.cell(row=r, column=1, value=cv).number_format = pct_fmt
        ws8.cell(row=r, column=1).fill = input_fill
        ws8.cell(row=r, column=1).font = input_font
        ws8.cell(row=r, column=2, value=rev).number_format = usd_fmt
        diff = round((rev - base) / base, 4) if base else 0
        c = ws8.cell(row=r, column=3, value=diff)
        c.number_format = pct_fmt
        if diff < 0:
            c.font = neg_font
        elif diff > 0:
            c.font = pos_font
        if cv == 0.055:
            ws8.cell(row=r, column=4, value="<-- BASE").font = Font(bold=True, color=GREEN)
        r += 1

    r += 2
    write_section_label(ws8, r, 1, "CHURN RATE SENSITIVITY (Paid In-Season)")
    r += 1
    write_header_row(ws8, r, ["Monthly Churn", "Y2 Gross Rev (est)", "vs Base", "", ""], 1)
    r += 1
    for ch in [0.02, 0.04, 0.06, 0.09, 0.12]:
        rev = run_scenario_churn(ch)
        base = run_scenario_churn(0.04)
        ws8.cell(row=r, column=1, value=ch).number_format = pct_fmt
        ws8.cell(row=r, column=1).fill = input_fill
        ws8.cell(row=r, column=1).font = input_font
        ws8.cell(row=r, column=2, value=rev).number_format = usd_fmt
        diff = round((rev - base) / base, 4) if base else 0
        c = ws8.cell(row=r, column=3, value=diff)
        c.number_format = pct_fmt
        if diff < 0:
            c.font = neg_font
        elif diff > 0:
            c.font = pos_font
        if ch == 0.04:
            ws8.cell(row=r, column=4, value="<-- BASE").font = Font(bold=True, color=GREEN)
        r += 1

    r += 2
    write_section_label(ws8, r, 1, "USER GROWTH SCENARIOS")
    r += 1
    write_header_row(ws8, r, ["Scenario", "Y2 End Users", "24-Mo Gross Rev (est)", "vs Base", ""], 1)
    r += 1
    base_total_24 = d["total"][23]
    base_gross_24 = sum(d["gross_rev"])
    for scenario, mult in [("Conservative (0.5x)", 0.5), ("Base (1x)", 1.0), ("Aggressive (2x)", 2.0), ("Hypergrowth (5x)", 5.0)]:
        end_users = round(base_total_24 * mult)
        gross_est = round(base_gross_24 * mult, 0)
        ws8.cell(row=r, column=1, value=scenario)
        if mult == 1.0:
            ws8.cell(row=r, column=1).font = Font(bold=True, color=GREEN)
        ws8.cell(row=r, column=2, value=end_users).number_format = num_fmt
        ws8.cell(row=r, column=3, value=gross_est).number_format = usd_fmt
        diff = round((gross_est - base_gross_24) / base_gross_24, 4) if base_gross_24 else 0
        c = ws8.cell(row=r, column=4, value=diff)
        c.number_format = pct_fmt
        if diff < 0:
            c.font = neg_font
        elif diff > 0:
            c.font = pos_font
        if mult == 1.0:
            ws8.cell(row=r, column=5, value="<-- BASE").font = Font(bold=True, color=GREEN)
        r += 1

    r += 2
    write_section_label(ws8, r, 1, "PRICING SENSITIVITY (Pro Tier)")
    r += 1
    write_header_row(ws8, r, ["Pro Price", "Y2 Sub Rev (est)", "vs Base", "", ""], 1)
    r += 1
    base_sub_y2 = y2_sum(d["net_sub"])
    for price in [3.99, 4.99, 6.99, 9.99]:
        ratio = price / 4.99
        # Higher price may reduce conversion slightly
        conv_adj = 1.0 if price <= 4.99 else max(0.7, 1.0 - (price - 4.99) * 0.04)
        est_rev = round(base_sub_y2 * ratio * conv_adj, 0)
        ws8.cell(row=r, column=1, value=f"${price:.2f}")
        ws8.cell(row=r, column=1).fill = input_fill
        ws8.cell(row=r, column=1).font = input_font
        ws8.cell(row=r, column=2, value=est_rev).number_format = usd_fmt
        diff = round((est_rev - base_sub_y2) / base_sub_y2, 4) if base_sub_y2 else 0
        c = ws8.cell(row=r, column=3, value=diff)
        c.number_format = pct_fmt
        if diff < 0:
            c.font = neg_font
        elif diff > 0:
            c.font = pos_font
        if price == 4.99:
            ws8.cell(row=r, column=4, value="<-- BASE").font = Font(bold=True, color=GREEN)
        r += 1

    # ──────────────────────────────────────────────────────────────────────
    # TAB 9: SOURCES & METHODOLOGY
    # ──────────────────────────────────────────────────────────────────────
    ws9 = wb.create_sheet("Sources & Methodology")
    set_col_widths(ws9, [45, 45, 75])
    write_header_row(ws9, 1, ["Assumption / Data Point", "Source Name", "URL"])

    sources = [
        ("CONVERSION RATES", "", ""),
        ("Freemium conversion benchmarks", "OpenView / Lenny's Newsletter", "https://www.lennysnewsletter.com/p/what-is-a-good-free-to-paid-conversion"),
        ("Mobile freemium median 2.18%", "RevenueCat State of Subscription Apps 2025", "https://www.revenuecat.com/state-of-subscription-apps-2025/"),
        ("", "", ""),
        ("CHURN RATES", "", ""),
        ("Subscription churn benchmarks", "MarketingLTB Subscription Statistics", "https://marketingltb.com/blog/statistics/subscription-statistics/"),
        ("Sleeper 75% annual retention", "Sleeper Series C PR", "https://www.prnewswire.com/news-releases/fantasy-sports-app-sleeper-raises-40-million-doubles-user-base-in-2021-301379179.html"),
        ("", "", ""),
        ("DFS RAKE", "", ""),
        ("DraftKings/FanDuel rake 10-16%", "Legal Sports Report", "https://www.legalsportsreport.com/15721/draftkings-fanduel-rake-increases/"),
        ("Rake comparison data", "RotoPicks", "http://www.rotopicks.com/fantasy-leagues/rake-comparison.php"),
        ("", "", ""),
        ("ADVERTISING", "", ""),
        ("Mobile ad CPM rates", "BusinessOfApps", "https://www.businessofapps.com/ads/research/mobile-app-advertising-cpm-rates/"),
        ("eCPM benchmarks by format", "Appodeal eCPM Report", "https://appodeal.com/blog/mobile-ecpm-report-app-ad-monetization-worldwide-performance/"),
        ("", "", ""),
        ("INFRASTRUCTURE", "", ""),
        ("Supabase pricing tiers", "Supabase Pricing", "https://supabase.com/pricing"),
        ("Supabase true cost analysis", "Metacto Blog", "https://www.metacto.com/blogs/the-true-cost-of-supabase-a-comprehensive-guide-to-pricing-integration-and-maintenance"),
        ("Firebase Hosting pricing", "Firebase Docs", "https://firebase.google.com/docs/hosting/usage-quotas-pricing"),
        ("Claude API pricing", "Anthropic Platform Pricing", "https://platform.claude.com/docs/en/about-claude/pricing"),
        ("", "", ""),
        ("PLATFORM FEES", "", ""),
        ("Apple Small Business Program (15%)", "Apple Developer", "https://developer.apple.com/app-store/small-business-program/"),
        ("Apple SBP implementation", "RevenueCat Engineering Blog", "https://www.revenuecat.com/blog/engineering/small-business-program/"),
        ("Google Play reduced fee (15%)", "Google Play Console", "https://play.google.com/console/about/programs/reducedservicefee/"),
        ("Stripe processing fees", "Stripe Pricing", "https://stripe.com/pricing"),
        ("Apple Developer Program $99/yr", "Apple Developer", "https://developer.apple.com/support/enrollment/"),
        ("", "", ""),
        ("MARKETING / CAC", "", ""),
        ("DraftKings/FanDuel CAC $200-350", "BusinessOfApps UA Costs", "https://www.businessofapps.com/marketplace/user-acquisition/research/user-acquisition-costs/"),
        ("NA Mobile CPI $5.28", "BusinessOfApps UA Costs", "https://www.businessofapps.com/marketplace/user-acquisition/research/user-acquisition-costs/"),
        ("", "", ""),
        ("MARKET DATA", "", ""),
        ("Fantasy sports market $32B, 14.1% CAGR", "Mordor Intelligence", "https://www.mordorintelligence.com/industry-reports/north-america-fantasy-sports-market"),
        ("Sleeper $40M Series C, 3M+ users", "PR Newswire", "https://www.prnewswire.com/news-releases/fantasy-sports-app-sleeper-raises-40-million-doubles-user-base-in-2021-301379179.html"),
        ("", "", ""),
        ("METHODOLOGY NOTES", "", ""),
        ("User growth model", "Bottom-up monthly cohort model with seasonal multipliers", ""),
        ("Conversion timing", "In-season 1.8x multiplier, off-season 0.4x", ""),
        ("Churn model", "Monthly churn with seasonal variation (in vs off-season)", ""),
        ("Revenue recognition", "Subscription recognized monthly; annual billing amortized", ""),
        ("Platform fee allocation", "70% mobile (60/40 iOS/Android), 30% web (Stripe)", ""),
        ("COGS scaling", "Supabase upgrades at 50K users; Claude API scales per-query", ""),
        ("DFS launch", "Month 19 (Oct 2027) per product roadmap", ""),
    ]

    r = 2
    for dp, source, url in sources:
        ws9.cell(row=r, column=1, value=dp)
        if dp and dp.isupper():
            ws9.cell(row=r, column=1).font = section_font
        ws9.cell(row=r, column=2, value=source)
        if url:
            ws9.cell(row=r, column=3, value=url)
            ws9.cell(row=r, column=3).font = Font(color="0563C1", underline="single")
        r += 1

    # ── Freeze panes on all monthly tabs ──────────────────────────────────
    for ws_tab in [ws2, ws3, ws4, ws5, ws6]:
        ws_tab.freeze_panes = "B2"

    ws7.freeze_panes = "B2"

    # ── Save ──────────────────────────────────────────────────────────────
    output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Citrus_Business_Model.xlsx")
    wb.save(output_path)
    return output_path, d


def print_summary(d):
    """Print key metrics to console."""
    print("=" * 70)
    print("CITRUS FANTASY SPORTS -- 24-MONTH BUSINESS MODEL SUMMARY")
    print("=" * 70)

    y1_end = d["total"][11]
    y2_end = d["total"][23]
    y1_rev = sum(d["gross_rev"][:12])
    y2_rev = sum(d["gross_rev"][12:])
    total_rev = y1_rev + y2_rev
    y1_net = sum(d["net_rev"][:12])
    y2_net = sum(d["net_rev"][12:])
    y1_ebitda = sum(d["ebitda"][:12])
    y2_ebitda = sum(d["ebitda"][12:])
    y1_cogs = sum(d["total_cogs"][:12])
    y2_cogs = sum(d["total_cogs"][12:])
    y1_opex = sum(d["total_opex"][:12])
    y2_opex = sum(d["total_opex"][12:])

    print(f"\nUSERS")
    print(f"  Y1 End (Mar 2027):   {y1_end:>10,}")
    print(f"  Y2 End (Mar 2028):   {y2_end:>10,}")
    print(f"  Pro (Y2 End):        {d['pro'][23]:>10,}")
    print(f"  Commissioner (Y2):   {d['comm'][23]:>10,}")

    print(f"\nREVENUE (24-Month)")
    print(f"  Gross Revenue:       ${total_rev:>12,.2f}")
    print(f"    Y1:                ${y1_rev:>12,.2f}")
    print(f"    Y2:                ${y2_rev:>12,.2f}")
    print(f"  Net Revenue (total): ${y1_net + y2_net:>12,.2f}")

    print(f"\nREVENUE STREAMS (24-Mo Totals)")
    print(f"  Subscriptions:       ${sum(d['net_sub']):>12,.2f}")
    print(f"  Pay-Per-Use:         ${sum(d['net_ppu']):>12,.2f}")
    print(f"  DFS Rake:            ${sum(d['dfs_rake']):>12,.2f}")
    print(f"  Advertising:         ${sum(d['ad_rev']):>12,.2f}")

    print(f"\nCOSTS")
    print(f"  Total COGS (24-Mo):  ${y1_cogs + y2_cogs:>12,.2f}")
    print(f"  Total OPEX (24-Mo):  ${y1_opex + y2_opex:>12,.2f}")

    print(f"\nPROFITABILITY")
    print(f"  EBITDA Y1:           ${y1_ebitda:>12,.2f}")
    print(f"  EBITDA Y2:           ${y2_ebitda:>12,.2f}")
    print(f"  EBITDA Total:        ${y1_ebitda + y2_ebitda:>12,.2f}")

    gm_y2 = sum(d["gross_profit"][12:]) / y2_net * 100 if y2_net else 0
    em_y2 = y2_ebitda / y2_net * 100 if y2_net else 0
    print(f"  Gross Margin (Y2):   {gm_y2:>11.1f}%")
    print(f"  EBITDA Margin (Y2):  {em_y2:>11.1f}%")

    # Cash
    starting = 1000
    ending = starting + y1_ebitda + y2_ebitda
    print(f"\nCASH")
    print(f"  Starting Cash:       ${starting:>12,}")
    print(f"  Ending Cash (M24):   ${ending:>12,.2f}")

    # Find breakeven
    cf_month = "Never (within 24 mo)"
    for i in range(24):
        if d["ebitda"][i] > 0:
            cf_month = MONTHS[i]
            break
    print(f"  First Profitable Mo: {cf_month}")

    print(f"\n{'=' * 70}")
    print(f"24-Month Gross Revenue: ${total_rev:,.0f}")
    target_met = "YES" if total_rev >= 1_000_000 else f"NO (${total_rev:,.0f})"
    print(f"Meets $1M+ target:     {target_met}")
    print(f"Y2 End Users ~100K:    {'YES' if abs(y2_end - 100_000) < 20_000 else f'NO ({y2_end:,})'}")
    print(f"{'=' * 70}")


if __name__ == "__main__":
    path, data = build_workbook()
    print(f"\nWorkbook saved to: {path}\n")
    print_summary(data)
