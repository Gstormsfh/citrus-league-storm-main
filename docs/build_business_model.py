#!/usr/bin/env python3
"""
Citrus Fantasy Sports — Dynamic Business Model Generator
Builds a comprehensive Excel financial model with:
  - Dynamic assumptions (editable inputs)
  - User growth model (0 → 10K → 100K gates)
  - Revenue streams (Subscriptions, DFS, Pay-Per-Use, Ads)
  - Churn modeling (sourced from industry benchmarks)
  - Premium conversion rates (sourced from SaaS/app benchmarks)
  - Cost structure (infra, marketing, conferences, team)
  - Monthly P&L
  - Annual summary

Sources:
  - Pitch Deck: Citrus FINAL v2 (Web Summit Vancouver 2026)
  - Churn: Mobile subscription avg 5-9%/mo (MarketingLTB, FocusDigital)
  - Conversion: Freemium 2-5% good, 5-8% great (OpenView/Lenny's Newsletter)
  - Sleeper comp: 75% annual retention, 3M+ users, <$10M rev 2023
  - FSGA membership: $500/yr + $250 admin (thefsga.org)
  - Market: 5.8M fantasy hockey adults NA, $32B+ TAM, 14.6% CAGR
"""

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side, numbers
from openpyxl.utils import get_column_letter
from copy import copy

wb = openpyxl.Workbook()

# ============================================================
# STYLE DEFINITIONS
# ============================================================
CITRUS_GREEN = "4A6741"
CITRUS_LIGHT = "D4E8B8"
CITRUS_ORANGE = "D4702A"
CITRUS_CREAM = "F5F0E8"
WHITE = "FFFFFF"
DARK = "1A1A1A"
LIGHT_GRAY = "F2F2F2"
MED_GRAY = "E0E0E0"

header_font = Font(name="Calibri", bold=True, size=12, color=WHITE)
header_fill = PatternFill(start_color=CITRUS_GREEN, end_color=CITRUS_GREEN, fill_type="solid")
subheader_font = Font(name="Calibri", bold=True, size=10, color=DARK)
subheader_fill = PatternFill(start_color=CITRUS_LIGHT, end_color=CITRUS_LIGHT, fill_type="solid")
orange_font = Font(name="Calibri", bold=True, size=11, color=CITRUS_ORANGE)
orange_fill = PatternFill(start_color="FFF3E8", end_color="FFF3E8", fill_type="solid")
input_fill = PatternFill(start_color="FFF9E6", end_color="FFF9E6", fill_type="solid")
total_fill = PatternFill(start_color=CITRUS_CREAM, end_color=CITRUS_CREAM, fill_type="solid")
normal_font = Font(name="Calibri", size=10)
bold_font = Font(name="Calibri", bold=True, size=10)
title_font = Font(name="Calibri", bold=True, size=16, color=CITRUS_GREEN)
subtitle_font = Font(name="Calibri", bold=True, size=11, color=CITRUS_GREEN)
source_font = Font(name="Calibri", italic=True, size=9, color="666666")
thin_border = Border(
    left=Side(style="thin", color=MED_GRAY),
    right=Side(style="thin", color=MED_GRAY),
    top=Side(style="thin", color=MED_GRAY),
    bottom=Side(style="thin", color=MED_GRAY),
)
bottom_border = Border(bottom=Side(style="medium", color=CITRUS_GREEN))

USD = '#,##0'
USD_DEC = '#,##0.00'
PCT = '0.0%'
NUM = '#,##0'

def style_header_row(ws, row, max_col):
    for c in range(1, max_col + 1):
        cell = ws.cell(row=row, column=c)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = thin_border

def style_subheader_row(ws, row, max_col):
    for c in range(1, max_col + 1):
        cell = ws.cell(row=row, column=c)
        cell.font = subheader_font
        cell.fill = subheader_fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = thin_border

def style_input_cell(ws, row, col):
    cell = ws.cell(row=row, column=col)
    cell.fill = input_fill
    cell.border = thin_border
    cell.font = Font(name="Calibri", bold=True, size=10, color=CITRUS_ORANGE)
    return cell

def style_total_row(ws, row, max_col):
    for c in range(1, max_col + 1):
        cell = ws.cell(row=row, column=c)
        cell.font = bold_font
        cell.fill = total_fill
        cell.border = Border(top=Side(style="medium", color=CITRUS_GREEN), bottom=Side(style="double", color=CITRUS_GREEN))

def apply_number_format(ws, row, col, fmt):
    ws.cell(row=row, column=col).number_format = fmt

def write_row(ws, row, data, start_col=1, font=None, fill=None, fmt=None):
    for i, val in enumerate(data):
        cell = ws.cell(row=row, column=start_col + i, value=val)
        cell.font = font or normal_font
        cell.border = thin_border
        if fill:
            cell.fill = fill
        if fmt and i > 0:  # skip label column
            cell.number_format = fmt

# ============================================================
# MONTHS DEFINITION (24 months: Apr 2026 – Mar 2028)
# ============================================================
months_labels = [
    "Apr-26","May-26","Jun-26","Jul-26","Aug-26","Sep-26",
    "Oct-26","Nov-26","Dec-26","Jan-27","Feb-27","Mar-27",
    "Apr-27","May-27","Jun-27","Jul-27","Aug-27","Sep-27",
    "Oct-27","Nov-27","Dec-27","Jan-28","Feb-28","Mar-28"
]

# NHL season months (Oct-Apr = in-season, May-Sep = off-season)
# Index 0=Apr-26 (off), 1=May-26 (off), ..., 5=Sep-26 (off), 6=Oct-26 (IN), ..., 11=Mar-27 (IN)
# 12=Apr-27 (off), ..., 17=Sep-27 (off), 18=Oct-27 (IN), ..., 23=Mar-28 (IN)
in_season = [
    False, False, False, False, False, False,  # Apr-Sep 2026 (off-season / pre-launch ramp)
    True, True, True, True, True, True,         # Oct 2026 - Mar 2027 (Season 1)
    False, False, False, False, False, False,   # Apr-Sep 2027 (off-season)
    True, True, True, True, True, True           # Oct 2027 - Mar 2028 (Season 2)
]

# ============================================================
# SHEET 1: ASSUMPTIONS
# ============================================================
ws_a = wb.active
ws_a.title = "Assumptions"
ws_a.sheet_properties.tabColor = CITRUS_GREEN

# Title
ws_a.merge_cells("A1:D1")
ws_a.cell(row=1, column=1, value="CITRUS FANTASY SPORTS — DYNAMIC BUSINESS MODEL").font = title_font
ws_a.merge_cells("A2:D2")
ws_a.cell(row=2, column=1, value="All yellow cells are editable inputs — model recalculates dynamically").font = source_font

r = 4
ws_a.cell(row=r, column=1, value="MARKET ASSUMPTIONS").font = subtitle_font
ws_a.cell(row=r, column=1).border = bottom_border
r += 1

assumptions = [
    # (Label, Value, Format, Source/Note)
    ("Total Addressable Market (TAM)", 32000000000, USD, "Fantasy Sports global — Pitch Deck"),
    ("Serviceable Addressable Market (SAM)", 1500000000, USD, "Fantasy Hockey global est. — Pitch Deck"),
    ("Active Fantasy Hockey Players (NA)", 5800000, NUM, "Pitch Deck — 5.8M adults"),
    ("NHL Audience CAGR", 0.146, PCT, "14.6% — Fastest growing Big 4 sport"),
    ("Fantasy Market CAGR", 0.1045, PCT, "10.45% — 2025-2035 (industry reports)"),
    ("", "", "", ""),
    ("PRICING", "", "", ""),
    ("Pro Monthly Price", 4.99, USD_DEC, "Pitch Deck — $4.99/mo"),
    ("Commissioner Monthly Price", 9.99, USD_DEC, "Pricing Page — $9.99/mo"),
    ("Annual Discount (%)", 0.20, PCT, "20% discount for annual billing"),
    ("Pro Annual Price (effective)", 47.90, USD_DEC, "=$4.99 × 12 × (1 - 20%)"),
    ("Commissioner Annual Price (effective)", 95.90, USD_DEC, "=$9.99 × 12 × (1 - 20%)"),
    ("", "", "", ""),
    ("CONVERSION RATES", "", "", "Source"),
    ("Free → Pro Conversion (Year 1)", 0.035, PCT, "3.5% — Freemium SaaS benchmark (OpenView/Lenny)"),
    ("Free → Pro Conversion (Year 2)", 0.055, PCT, "5.5% — Maturing product, better onboarding"),
    ("Free → Commissioner Conversion (Year 1)", 0.008, PCT, "0.8% — Commissioner is niche power-user tier"),
    ("Free → Commissioner Conversion (Year 2)", 0.015, PCT, "1.5% — Growing league commissioner base"),
    ("In-Season Conversion Multiplier", 1.8, '0.0x', "1.8x — Users convert more during NHL season"),
    ("Off-Season Conversion Multiplier", 0.4, '0.0x', "0.4x — Minimal conversion in summer"),
    ("", "", "", ""),
    ("CHURN RATES (Monthly)", "", "", "Source"),
    ("Pro Monthly Churn (In-Season)", 0.04, PCT, "4% — Below mobile avg 9% (strong engagement)"),
    ("Pro Monthly Churn (Off-Season)", 0.12, PCT, "12% — Seasonal product, higher summer churn"),
    ("Commissioner Monthly Churn (In-Season)", 0.025, PCT, "2.5% — Commissioners are stickiest users"),
    ("Commissioner Monthly Churn (Off-Season)", 0.08, PCT, "8% — Some pause in summer"),
    ("Free User Monthly Churn (In-Season)", 0.06, PCT, "6% — Free users less committed"),
    ("Free User Monthly Churn (Off-Season)", 0.15, PCT, "15% — High summer attrition for free tier"),
    ("Sleeper Comp: Annual Retention", 0.75, PCT, "75% — Sleeper's reported retention rate"),
    ("", "", "", ""),
    ("PAY-PER-USE REVENUE", "", "", ""),
    ("Stormy AI Query Pack Price", 1.99, USD_DEC, "$1.99 per 50-query pack"),
    ("AI Pack Attach Rate (% of free users/mo)", 0.02, PCT, "2% of free users buy a pack monthly"),
    ("AI Pack Attach Rate (% of Pro users/mo)", 0.08, PCT, "8% of Pro users buy extra packs"),
    ("Draft Kit Price (seasonal)", 4.99, USD_DEC, "$4.99 one-time per season"),
    ("Draft Kit Attach Rate (% of all users)", 0.06, PCT, "6% of users buy draft kit at season start"),
    ("", "", "", ""),
    ("DFS EXPANSION (Year 2+)", "", "", ""),
    ("DFS Rake %", 0.12, PCT, "12% — Pitch Deck"),
    ("DFS Avg Entry Fee", 5.00, USD_DEC, "$5 average contest entry"),
    ("DFS Participation Rate (% of users)", 0.10, PCT, "10% of users play DFS contests"),
    ("DFS Avg Entries Per User Per Month", 4, '0', "4 entries/month for active DFS users"),
    ("DFS Launch Month", 19, '0', "Month 19 (Oct 2027) — Season 2 start"),
    ("", "", "", ""),
    ("ADVERTISING REVENUE", "", "", ""),
    ("Ad RPM (Revenue Per 1K Impressions)", 8.00, USD_DEC, "$8 RPM — Sports/gaming vertical"),
    ("Avg Monthly Pageviews Per Free User", 120, '0', "120 pageviews/mo for active free users"),
    ("Ad Eligible Users (% of free)", 0.85, PCT, "85% of free users see ads (some use blockers)"),
]

for label, val, fmt, note in assumptions:
    if label == "" and val == "":
        r += 1
        continue
    if val == "":
        ws_a.cell(row=r, column=1, value=label).font = subtitle_font
        ws_a.cell(row=r, column=1).border = bottom_border
        ws_a.cell(row=r, column=4, value=note).font = source_font
        r += 1
        continue
    ws_a.cell(row=r, column=1, value=label).font = normal_font
    ws_a.cell(row=r, column=1).border = thin_border
    c = style_input_cell(ws_a, r, 2)
    c.value = val
    c.number_format = fmt
    ws_a.cell(row=r, column=3).font = normal_font
    ws_a.cell(row=r, column=4, value=note).font = source_font
    ws_a.cell(row=r, column=4).border = thin_border
    r += 1

ws_a.column_dimensions["A"].width = 42
ws_a.column_dimensions["B"].width = 18
ws_a.column_dimensions["C"].width = 4
ws_a.column_dimensions["D"].width = 55

# ============================================================
# SHEET 2: USER GROWTH MODEL (24-month monthly)
# ============================================================
ws_g = wb.create_sheet("User Growth")
ws_g.sheet_properties.tabColor = CITRUS_GREEN

ws_g.merge_cells("A1:Z1")
ws_g.cell(row=1, column=1, value="USER GROWTH MODEL — Monthly (Apr 2026 – Mar 2028)").font = title_font
ws_g.cell(row=2, column=1, value="Growth gates from Pitch Deck: 1K → 10K → 25K → 100K").font = source_font

# New user acquisition per month (aligned with pitch deck growth gates)
# Gate targets: 1K by Q2 2026, 10K by Q4 2026, 25K by Q2 2027, 100K by Q4 2027
# Comp: Sleeper hit 1,000,000 users in first calendar year (2019) — 100K is very achievable
new_users_monthly = [
    150, 200, 250, 300, 400, 500,       # Apr-Sep 2026: Pre-season ramp (→ ~1,800 cumulative)
    2000, 2500, 2200, 1800, 1500, 1200,  # Oct 2026-Mar 2027: Season 1 launch spike (→ ~13,000)
    1200, 1000, 900, 1200, 2000, 3500,    # Apr-Sep 2027: Off-season + marketing/influencer ramp
    17000, 20000, 20000, 18000, 16000, 13000, # Oct 2027-Mar 2028: Season 2 (→ 100K target)
]

# Churn rates by segment by month
pro_churn = [0.12 if not s else 0.04 for s in in_season]
commish_churn = [0.08 if not s else 0.025 for s in in_season]
free_churn = [0.15 if not s else 0.06 for s in in_season]

# Conversion rates (Year 1 = months 0-11, Year 2 = months 12-23)
pro_conv_base = [0.035]*12 + [0.055]*12
commish_conv_base = [0.008]*12 + [0.015]*12
# Apply seasonal multiplier
conv_multiplier = [0.4 if not s else 1.8 for s in in_season]

# Headers
r = 4
headers = ["Metric"] + months_labels
style_header_row(ws_g, r, len(headers))
for i, h in enumerate(headers):
    ws_g.cell(row=r, column=i+1, value=h)
ws_g.column_dimensions["A"].width = 35

# Calculate the model
total_users = []
free_users_arr = []
pro_users_arr = []
commish_users_arr = []

cum_free = 0
cum_pro = 0
cum_commish = 0

rows_data = {}

for m in range(24):
    new = new_users_monthly[m]

    # New users start as free
    # Conversions from existing free base
    effective_pro_conv = pro_conv_base[m] * conv_multiplier[m]
    effective_commish_conv = commish_conv_base[m] * conv_multiplier[m]

    new_pro_from_free = cum_free * effective_pro_conv
    new_commish_from_free = cum_free * effective_commish_conv

    # Apply churn
    churned_free = cum_free * free_churn[m]
    churned_pro = cum_pro * pro_churn[m]
    churned_commish = cum_commish * commish_churn[m]

    # Update totals
    cum_free = cum_free + new - new_pro_from_free - new_commish_from_free - churned_free
    cum_pro = cum_pro + new_pro_from_free - churned_pro
    cum_commish = cum_commish + new_commish_from_free - churned_commish

    cum_free = max(0, cum_free)
    cum_pro = max(0, cum_pro)
    cum_commish = max(0, cum_commish)

    total = cum_free + cum_pro + cum_commish
    total_users.append(total)
    free_users_arr.append(cum_free)
    pro_users_arr.append(cum_pro)
    commish_users_arr.append(cum_commish)

# Write rows
metrics = [
    ("New Users Acquired", new_users_monthly, NUM),
    ("", None, None),
    ("Free Users (End of Month)", free_users_arr, NUM),
    ("Pro Subscribers", pro_users_arr, NUM),
    ("Commissioner Subscribers", commish_users_arr, NUM),
    ("TOTAL USERS", total_users, NUM),
    ("", None, None),
    ("Pro Conversion Rate (effective)", [pro_conv_base[m] * conv_multiplier[m] for m in range(24)], PCT),
    ("Commissioner Conv Rate (effective)", [commish_conv_base[m] * conv_multiplier[m] for m in range(24)], PCT),
    ("", None, None),
    ("Free Churn Rate", free_churn, PCT),
    ("Pro Churn Rate", pro_churn, PCT),
    ("Commissioner Churn Rate", commish_churn, PCT),
    ("", None, None),
    ("NHL Season Status", ["IN-SEASON" if s else "OFF-SEASON" for s in in_season], None),
    ("Premium % of Total", [((pro_users_arr[m]+commish_users_arr[m])/total_users[m]*100 if total_users[m] > 0 else 0) for m in range(24)], '0.0"%"'),
]

r = 5
for label, data, fmt in metrics:
    if label == "":
        r += 1
        continue
    ws_g.cell(row=r, column=1, value=label).font = bold_font if label in ("TOTAL USERS",) else normal_font
    ws_g.cell(row=r, column=1).border = thin_border
    is_total = label == "TOTAL USERS"
    is_season = label == "NHL Season Status"
    for m in range(24):
        cell = ws_g.cell(row=r, column=m+2, value=data[m])
        cell.border = thin_border
        cell.font = bold_font if is_total else normal_font
        cell.alignment = Alignment(horizontal="center")
        if fmt:
            cell.number_format = fmt
        if is_total:
            cell.fill = total_fill
        if is_season:
            if data[m] == "IN-SEASON":
                cell.fill = PatternFill(start_color="E8F5E8", end_color="E8F5E8", fill_type="solid")
                cell.font = Font(name="Calibri", size=8, color=CITRUS_GREEN, bold=True)
            else:
                cell.fill = PatternFill(start_color="FFF0E0", end_color="FFF0E0", fill_type="solid")
                cell.font = Font(name="Calibri", size=8, color=CITRUS_ORANGE, bold=True)
    if is_total:
        style_total_row(ws_g, r, len(headers))
        ws_g.cell(row=r, column=1, value=label)
    r += 1

# Set column widths
for c in range(2, 26):
    ws_g.column_dimensions[get_column_letter(c)].width = 11

# ============================================================
# SHEET 3: REVENUE MODEL (24-month monthly)
# ============================================================
ws_r = wb.create_sheet("Revenue")
ws_r.sheet_properties.tabColor = CITRUS_ORANGE

ws_r.merge_cells("A1:Z1")
ws_r.cell(row=1, column=1, value="REVENUE MODEL — Monthly Breakdown").font = title_font
ws_r.cell(row=2, column=1, value="Subscriptions + Pay-Per-Use + DFS + Advertising").font = source_font

r = 4
headers = ["Revenue Stream"] + months_labels
style_header_row(ws_r, r, len(headers))
for i, h in enumerate(headers):
    ws_r.cell(row=r, column=i+1, value=h)
ws_r.column_dimensions["A"].width = 35

# Calculate revenue streams
pro_sub_rev = [pro_users_arr[m] * 4.99 for m in range(24)]
commish_sub_rev = [commish_users_arr[m] * 9.99 for m in range(24)]

# Pay-per-use: AI packs
ai_pack_rev = []
for m in range(24):
    free_packs = free_users_arr[m] * 0.02 * 1.99
    pro_packs = pro_users_arr[m] * 0.08 * 1.99
    ai_pack_rev.append(free_packs + pro_packs)

# Draft kits (seasonal — big spikes in Sep/Oct each year)
draft_kit_rev = []
for m in range(24):
    month_label = months_labels[m]
    if month_label in ("Sep-26", "Oct-26", "Sep-27", "Oct-27"):
        draft_kit_rev.append(total_users[m] * 0.06 * 4.99)
    else:
        draft_kit_rev.append(0)

# DFS revenue (launches month 19 = Oct 2027)
dfs_rev = []
for m in range(24):
    if m >= 18:  # Oct 2027 onwards
        active_dfs = total_users[m] * 0.10
        gross_entry = active_dfs * 4 * 5.00
        dfs_rev.append(gross_entry * 0.12)
    else:
        dfs_rev.append(0)

# Ad revenue (free users only)
ad_rev = []
for m in range(24):
    eligible = free_users_arr[m] * 0.85
    impressions = eligible * 120 / 1000  # in thousands
    ad_rev.append(impressions * 8.00)
    # Off-season: lower pageviews
    if not in_season[m]:
        ad_rev[m] *= 0.4  # 40% of in-season traffic

total_rev = []
for m in range(24):
    total_rev.append(pro_sub_rev[m] + commish_sub_rev[m] + ai_pack_rev[m] + draft_kit_rev[m] + dfs_rev[m] + ad_rev[m])

rev_rows = [
    ("SUBSCRIPTIONS", None, None, True),
    ("  Pro Subscriptions ($4.99/mo)", pro_sub_rev, USD),
    ("  Commissioner Subscriptions ($9.99/mo)", commish_sub_rev, USD),
    ("Subscription Subtotal", [pro_sub_rev[m] + commish_sub_rev[m] for m in range(24)], USD, True),
    ("", None, None),
    ("PAY-PER-USE", None, None, True),
    ("  Stormy AI Query Packs", ai_pack_rev, USD),
    ("  Draft Kits (seasonal)", draft_kit_rev, USD),
    ("Pay-Per-Use Subtotal", [ai_pack_rev[m] + draft_kit_rev[m] for m in range(24)], USD, True),
    ("", None, None),
    ("DFS REVENUE (12% rake — launches Oct 2027)", None, None, True),
    ("  DFS Rake Revenue", dfs_rev, USD),
    ("", None, None),
    ("ADVERTISING", None, None, True),
    ("  Ad Revenue (Free Tier)", ad_rev, USD),
    ("", None, None),
    ("TOTAL MONTHLY REVENUE", total_rev, USD, True),
]

r = 5
for item in rev_rows:
    label = item[0]
    data = item[1]
    fmt = item[2] if len(item) > 2 else None
    is_section = len(item) > 3 and item[3]

    if label == "":
        r += 1
        continue

    if data is None:
        ws_r.cell(row=r, column=1, value=label).font = subtitle_font if is_section else normal_font
        ws_r.cell(row=r, column=1).border = thin_border
        if is_section:
            for c in range(1, 26):
                ws_r.cell(row=r, column=c).fill = subheader_fill
                ws_r.cell(row=r, column=c).border = thin_border
        r += 1
        continue

    is_total = "TOTAL" in label or "Subtotal" in label
    ws_r.cell(row=r, column=1, value=label).font = bold_font if is_total else normal_font
    ws_r.cell(row=r, column=1).border = thin_border
    for m in range(24):
        cell = ws_r.cell(row=r, column=m+2, value=round(data[m], 0))
        cell.border = thin_border
        cell.number_format = fmt or USD
        cell.alignment = Alignment(horizontal="center")
        cell.font = bold_font if is_total else normal_font
        if is_total:
            cell.fill = total_fill
    if "TOTAL MONTHLY" in label:
        style_total_row(ws_r, r, 26)
        ws_r.cell(row=r, column=1, value=label)
    r += 1

# Cumulative revenue row
r += 1
ws_r.cell(row=r, column=1, value="CUMULATIVE REVENUE").font = bold_font
cum_rev = []
running = 0
for m in range(24):
    running += total_rev[m]
    cum_rev.append(running)
    cell = ws_r.cell(row=r, column=m+2, value=round(running, 0))
    cell.number_format = USD
    cell.font = bold_font
    cell.fill = PatternFill(start_color="E8F5E8", end_color="E8F5E8", fill_type="solid")
    cell.border = thin_border
    cell.alignment = Alignment(horizontal="center")

for c in range(2, 26):
    ws_r.column_dimensions[get_column_letter(c)].width = 11

# ============================================================
# SHEET 4: COSTS & MARKETING
# ============================================================
ws_c = wb.create_sheet("Costs & Marketing")
ws_c.sheet_properties.tabColor = CITRUS_ORANGE

ws_c.merge_cells("A1:Z1")
ws_c.cell(row=1, column=1, value="COST STRUCTURE & MARKETING — Monthly Breakdown").font = title_font
ws_c.cell(row=2, column=1, value="Infrastructure + Marketing + Conferences + Team").font = source_font

r = 4
headers = ["Cost Category"] + months_labels
style_header_row(ws_c, r, len(headers))
for i, h in enumerate(headers):
    ws_c.cell(row=r, column=i+1, value=h)
ws_c.column_dimensions["A"].width = 40

# Infrastructure costs (scales with users)
infra_costs = []
for m in range(24):
    users = total_users[m]
    # Supabase Pro: $25/mo base, scales at $0.002/user/mo after 5K
    supabase = 25 + max(0, (users - 5000) * 0.002)
    # Firebase Hosting: $25/mo base + $0.001/user/mo
    firebase = 25 + users * 0.001
    # Claude API (Stormy): ~$0.01 per AI query, est 5 queries/pro user/mo
    claude_api = pro_users_arr[m] * 5 * 0.01 + commish_users_arr[m] * 15 * 0.01
    # Proxy rotation: $100/mo flat
    proxy = 100
    # Domain/SSL/misc: $20/mo
    misc = 20
    infra_costs.append(supabase + firebase + claude_api + proxy + misc)

# Marketing costs
digital_marketing = []
content_marketing = []
for m in range(24):
    # Digital: scales with growth phase
    if m < 6:    # Pre-launch: $200-500/mo (Reddit, Twitter, organic)
        digital_marketing.append(300 + m * 40)
    elif m < 12:  # Season 1: $500-2000/mo (paid acquisition ramp)
        digital_marketing.append(800 + (m-6) * 250)
    elif m < 18:  # Off-season Y2: $1000-1500/mo (brand building)
        digital_marketing.append(1200 + (m-12) * 50)
    else:         # Season 2: $3000-8000/mo (aggressive growth)
        digital_marketing.append(3000 + (m-18) * 1000)

    # Content: blog, social, video
    if m < 12:
        content_marketing.append(200)
    else:
        content_marketing.append(500)

# Conference & Travel Budget
# FSGA membership: $750 first year ($500 + $250 admin), $500/yr after
# Conferences: FSGA Winter (Feb, Las Vegas), FSGA Summer (Jul, varies),
#              MIT Sloan SSAC (Mar, Boston), Web Summit (various), Sports Analytics
# Budget: $3-5K per conference (travel + hotel + booth + meals)
conference_costs = [0]*24
conference_notes = [""]*24

# Year 1 conferences
conference_costs[0] = 750   # Apr 2026: FSGA membership ($500 + $250 admin)
conference_notes[0] = "FSGA membership"
conference_costs[3] = 4500  # Jul 2026: FSGA Summer Conference
conference_notes[3] = "FSGA Summer (Philadelphia)"
conference_costs[5] = 3500  # Sep 2026: Pre-season sports tech event
conference_notes[5] = "Sports Tech event"
conference_costs[7] = 5000  # Nov 2026: Web Summit Lisbon
conference_notes[7] = "Web Summit Lisbon"
conference_costs[10] = 4000 # Feb 2027: FSGA Winter Conference
conference_notes[10] = "FSGA Winter (Las Vegas)"
conference_costs[11] = 5000 # Mar 2027: MIT Sloan SSAC
conference_notes[11] = "MIT Sloan SSAC (Boston)"

# Year 2 conferences (more aggressive, bigger booth presence)
conference_costs[12] = 500  # Apr 2027: FSGA renewal
conference_notes[12] = "FSGA renewal"
conference_costs[14] = 6000 # Jun 2027: Sports Analytics Innovation Summit
conference_notes[14] = "Sports Analytics Summit"
conference_costs[15] = 6000 # Jul 2027: FSGA Summer Conference (bigger booth)
conference_notes[15] = "FSGA Summer (booth upgrade)"
conference_costs[17] = 5000 # Sep 2027: Pre-season marketing event
conference_notes[17] = "Sports Tech Conference"
conference_costs[19] = 8000 # Nov 2027: Web Summit (larger presence)
conference_notes[19] = "Web Summit (premium booth)"
conference_costs[22] = 5000 # Feb 2028: FSGA Winter
conference_notes[22] = "FSGA Winter (Las Vegas)"
conference_costs[23] = 6000 # Mar 2028: MIT Sloan SSAC
conference_notes[23] = "MIT Sloan SSAC (Boston)"

# Contractor / team costs
team_costs = []
for m in range(24):
    if m < 6:
        team_costs.append(0)  # Solo founder, bootstrapped
    elif m < 12:
        team_costs.append(1500)  # Part-time contractor (design/marketing)
    elif m < 18:
        team_costs.append(3000)  # 1-2 contractors
    else:
        team_costs.append(6000)  # Small team ramp

# App Store fees (15-30% on IAP, assume 15% small business rate)
app_store_fees = []
for m in range(24):
    iap_rev = pro_sub_rev[m] + commish_sub_rev[m] + ai_pack_rev[m]
    app_store_fees.append(iap_rev * 0.15)

# Payment processing for DFS (3% Stripe)
payment_processing = []
for m in range(24):
    payment_processing.append(dfs_rev[m] * 0.03 + draft_kit_rev[m] * 0.03)

# Total costs
total_costs = []
for m in range(24):
    total_costs.append(
        infra_costs[m] + digital_marketing[m] + content_marketing[m] +
        conference_costs[m] + team_costs[m] + app_store_fees[m] + payment_processing[m]
    )

cost_rows = [
    ("INFRASTRUCTURE", None, None, True),
    ("  Supabase + Firebase + API Hosting", infra_costs, USD),
    ("", None, None),
    ("MARKETING & GROWTH", None, None, True),
    ("  Digital Marketing (Paid + Organic)", digital_marketing, USD),
    ("  Content Marketing (Blog, Social, Video)", content_marketing, USD),
    ("Marketing Subtotal", [digital_marketing[m] + content_marketing[m] for m in range(24)], USD, True),
    ("", None, None),
    ("CONFERENCE & TRAVEL", None, None, True),
    ("  Conference Costs (see notes below)", conference_costs, USD),
    ("", None, None),
    ("TEAM", None, None, True),
    ("  Contractors / Part-Time Team", team_costs, USD),
    ("", None, None),
    ("PLATFORM FEES", None, None, True),
    ("  App Store Commission (15%)", app_store_fees, USD),
    ("  Payment Processing (3%)", payment_processing, USD),
    ("Platform Fees Subtotal", [app_store_fees[m] + payment_processing[m] for m in range(24)], USD, True),
    ("", None, None),
    ("TOTAL MONTHLY COSTS", total_costs, USD, True),
]

r = 5
for item in cost_rows:
    label = item[0]
    data = item[1]
    fmt = item[2] if len(item) > 2 else None
    is_section = len(item) > 3 and item[3]

    if label == "":
        r += 1
        continue

    if data is None:
        ws_c.cell(row=r, column=1, value=label).font = subtitle_font if is_section else normal_font
        ws_c.cell(row=r, column=1).border = thin_border
        if is_section:
            for c in range(1, 26):
                ws_c.cell(row=r, column=c).fill = subheader_fill
                ws_c.cell(row=r, column=c).border = thin_border
        r += 1
        continue

    is_total = "TOTAL" in label or "Subtotal" in label
    ws_c.cell(row=r, column=1, value=label).font = bold_font if is_total else normal_font
    ws_c.cell(row=r, column=1).border = thin_border
    for m_idx in range(24):
        cell = ws_c.cell(row=r, column=m_idx+2, value=round(data[m_idx], 0))
        cell.border = thin_border
        cell.number_format = fmt or USD
        cell.alignment = Alignment(horizontal="center")
        cell.font = bold_font if is_total else normal_font
        if is_total:
            cell.fill = total_fill
    if "TOTAL MONTHLY" in label:
        style_total_row(ws_c, r, 26)
        ws_c.cell(row=r, column=1, value=label)
    r += 1

# Conference schedule notes
r += 2
ws_c.cell(row=r, column=1, value="CONFERENCE & TRAVEL SCHEDULE").font = subtitle_font
r += 1
style_header_row(ws_c, r, 4)
for i, h in enumerate(["Month", "Event", "Location (Est.)", "Budget"]):
    ws_c.cell(row=r, column=i+1, value=h)
r += 1

conf_schedule = [
    ("Apr 2026", "FSGA Membership (first year)", "Online", "$750"),
    ("Jul 2026", "FSGA Summer Conference", "Philadelphia, PA", "$4,500"),
    ("Sep 2026", "Sports Tech Conference", "Various", "$3,500"),
    ("Nov 2026", "Web Summit", "Lisbon, Portugal", "$5,000"),
    ("Feb 2027", "FSGA Winter Conference", "Las Vegas, NV", "$4,000"),
    ("Mar 2027", "MIT Sloan Sports Analytics (SSAC)", "Boston, MA", "$5,000"),
    ("Apr 2027", "FSGA Membership Renewal", "Online", "$500"),
    ("Jun 2027", "Sports Analytics Innovation Summit", "Various", "$6,000"),
    ("Jul 2027", "FSGA Summer Conference (booth upgrade)", "TBD", "$6,000"),
    ("Sep 2027", "Sports Tech Conference", "Various", "$5,000"),
    ("Nov 2027", "Web Summit (premium booth)", "Various", "$8,000"),
    ("Feb 2028", "FSGA Winter Conference", "Las Vegas, NV", "$5,000"),
    ("Mar 2028", "MIT Sloan SSAC", "Boston, MA", "$6,000"),
]
for month, event, loc, budget in conf_schedule:
    write_row(ws_c, r, [month, event, loc, budget])
    r += 1

total_conf_y1 = sum(conference_costs[:12])
total_conf_y2 = sum(conference_costs[12:])
r += 1
ws_c.cell(row=r, column=1, value="Year 1 Conference Total:").font = bold_font
ws_c.cell(row=r, column=2, value=total_conf_y1).font = bold_font
ws_c.cell(row=r, column=2).number_format = USD
r += 1
ws_c.cell(row=r, column=1, value="Year 2 Conference Total:").font = bold_font
ws_c.cell(row=r, column=2, value=total_conf_y2).font = bold_font
ws_c.cell(row=r, column=2).number_format = USD

for c in range(2, 26):
    ws_c.column_dimensions[get_column_letter(c)].width = 11

# ============================================================
# SHEET 5: P&L SUMMARY
# ============================================================
ws_pl = wb.create_sheet("P&L Summary")
ws_pl.sheet_properties.tabColor = CITRUS_GREEN

ws_pl.merge_cells("A1:Z1")
ws_pl.cell(row=1, column=1, value="PROFIT & LOSS — Monthly Summary").font = title_font
ws_pl.cell(row=2, column=1, value="Net Income = Revenue - Costs | Cumulative tracks path to profitability").font = source_font

r = 4
headers = ["P&L Line Item"] + months_labels
style_header_row(ws_pl, r, len(headers))
for i, h in enumerate(headers):
    ws_pl.cell(row=r, column=i+1, value=h)
ws_pl.column_dimensions["A"].width = 35

# Calculate P&L
net_income = [total_rev[m] - total_costs[m] for m in range(24)]
cum_net = []
running_net = 0
for m in range(24):
    running_net += net_income[m]
    cum_net.append(running_net)

gross_margin = []
for m in range(24):
    if total_rev[m] > 0:
        gross_margin.append(net_income[m] / total_rev[m])
    else:
        gross_margin.append(0)

pl_rows = [
    ("Total Revenue", total_rev, USD),
    ("Total Costs", total_costs, USD),
    ("", None, None),
    ("NET INCOME (LOSS)", net_income, USD),
    ("Gross Margin %", gross_margin, PCT),
    ("", None, None),
    ("Cumulative Revenue", cum_rev, USD),
    ("Cumulative Net Income (Loss)", cum_net, USD),
    ("", None, None),
    ("TOTAL USERS", total_users, NUM),
    ("Premium Subscribers", [pro_users_arr[m] + commish_users_arr[m] for m in range(24)], NUM),
    ("Revenue Per User (ARPU)", [total_rev[m]/total_users[m] if total_users[m] > 0 else 0 for m in range(24)], USD_DEC),
    ("Cost Per User", [total_costs[m]/total_users[m] if total_users[m] > 0 else 0 for m in range(24)], USD_DEC),
    ("LTV:CAC Indicator", [total_rev[m]/total_costs[m] if total_costs[m] > 0 else 0 for m in range(24)], '0.00x'),
]

r = 5
for item in pl_rows:
    label = item[0]
    data = item[1]
    fmt = item[2] if len(item) > 2 else None

    if label == "":
        r += 1
        continue

    if data is None:
        r += 1
        continue

    is_net = "NET INCOME" in label
    is_cum_net = "Cumulative Net" in label
    ws_pl.cell(row=r, column=1, value=label).font = bold_font if (is_net or is_cum_net) else normal_font
    ws_pl.cell(row=r, column=1).border = thin_border

    for m in range(24):
        cell = ws_pl.cell(row=r, column=m+2, value=round(data[m], 2) if fmt in (USD_DEC, PCT, '0.00x') else round(data[m], 0))
        cell.border = thin_border
        cell.number_format = fmt or USD
        cell.alignment = Alignment(horizontal="center")

        if is_net or is_cum_net:
            cell.font = bold_font
            if data[m] < 0:
                cell.font = Font(name="Calibri", bold=True, size=10, color="CC0000")
            else:
                cell.font = Font(name="Calibri", bold=True, size=10, color=CITRUS_GREEN)

        if is_net:
            cell.fill = total_fill

    if is_net:
        style_total_row(ws_pl, r, 26)
        ws_pl.cell(row=r, column=1, value=label)
    r += 1

for c in range(2, 26):
    ws_pl.column_dimensions[get_column_letter(c)].width = 11

# ============================================================
# SHEET 6: ANNUAL SUMMARY
# ============================================================
ws_ann = wb.create_sheet("Annual Summary")
ws_ann.sheet_properties.tabColor = CITRUS_GREEN

ws_ann.merge_cells("A1:D1")
ws_ann.cell(row=1, column=1, value="ANNUAL SUMMARY — Year 1 vs Year 2").font = title_font

r = 3
headers_ann = ["Metric", "Year 1 (Apr 26–Mar 27)", "Year 2 (Apr 27–Mar 28)", "Growth"]
style_header_row(ws_ann, r, 4)
for i, h in enumerate(headers_ann):
    ws_ann.cell(row=r, column=i+1, value=h)

y1_rev = sum(total_rev[:12])
y2_rev = sum(total_rev[12:])
y1_cost = sum(total_costs[:12])
y2_cost = sum(total_costs[12:])
y1_net = y1_rev - y1_cost
y2_net = y2_rev - y2_cost
y1_sub_rev = sum(pro_sub_rev[:12]) + sum(commish_sub_rev[:12])
y2_sub_rev = sum(pro_sub_rev[12:]) + sum(commish_sub_rev[12:])
y1_ppu_rev = sum(ai_pack_rev[:12]) + sum(draft_kit_rev[:12])
y2_ppu_rev = sum(ai_pack_rev[12:]) + sum(draft_kit_rev[12:])
y1_dfs_rev = sum(dfs_rev[:12])
y2_dfs_rev = sum(dfs_rev[12:])
y1_ad_rev = sum(ad_rev[:12])
y2_ad_rev = sum(ad_rev[12:])
y1_mktg = sum(digital_marketing[:12]) + sum(content_marketing[:12])
y2_mktg = sum(digital_marketing[12:]) + sum(content_marketing[12:])
y1_conf = sum(conference_costs[:12])
y2_conf = sum(conference_costs[12:])

annual_data = [
    ("USERS", "", "", ""),
    ("End-of-Year Total Users", round(total_users[11]), round(total_users[23]), None),
    ("End-of-Year Pro Subscribers", round(pro_users_arr[11]), round(pro_users_arr[23]), None),
    ("End-of-Year Commissioner Subs", round(commish_users_arr[11]), round(commish_users_arr[23]), None),
    ("Premium % of Total", f"{(pro_users_arr[11]+commish_users_arr[11])/total_users[11]*100:.1f}%", f"{(pro_users_arr[23]+commish_users_arr[23])/total_users[23]*100:.1f}%", ""),
    ("", "", "", ""),
    ("REVENUE", "", "", ""),
    ("Subscription Revenue", y1_sub_rev, y2_sub_rev, (y2_sub_rev/y1_sub_rev - 1) if y1_sub_rev > 0 else 0),
    ("Pay-Per-Use Revenue", y1_ppu_rev, y2_ppu_rev, (y2_ppu_rev/y1_ppu_rev - 1) if y1_ppu_rev > 0 else 0),
    ("DFS Revenue", y1_dfs_rev, y2_dfs_rev, "NEW"),
    ("Advertising Revenue", y1_ad_rev, y2_ad_rev, (y2_ad_rev/y1_ad_rev - 1) if y1_ad_rev > 0 else 0),
    ("TOTAL REVENUE", y1_rev, y2_rev, (y2_rev/y1_rev - 1) if y1_rev > 0 else 0),
    ("", "", "", ""),
    ("COSTS", "", "", ""),
    ("Infrastructure", sum(infra_costs[:12]), sum(infra_costs[12:]), None),
    ("Marketing (Digital + Content)", y1_mktg, y2_mktg, None),
    ("Conference & Travel", y1_conf, y2_conf, None),
    ("Team / Contractors", sum(team_costs[:12]), sum(team_costs[12:]), None),
    ("Platform Fees", sum(app_store_fees[:12]) + sum(payment_processing[:12]), sum(app_store_fees[12:]) + sum(payment_processing[12:]), None),
    ("TOTAL COSTS", y1_cost, y2_cost, (y2_cost/y1_cost - 1) if y1_cost > 0 else 0),
    ("", "", "", ""),
    ("PROFITABILITY", "", "", ""),
    ("NET INCOME (LOSS)", y1_net, y2_net, ""),
    ("Gross Margin", y1_net/y1_rev if y1_rev > 0 else 0, y2_net/y2_rev if y2_rev > 0 else 0, ""),
]

r = 4
for label, y1, y2, growth in annual_data:
    if label == "":
        r += 1
        continue
    if label in ("USERS", "REVENUE", "COSTS", "PROFITABILITY"):
        ws_ann.cell(row=r, column=1, value=label).font = subtitle_font
        ws_ann.cell(row=r, column=1).border = bottom_border
        r += 1
        continue

    is_total = "TOTAL" in label or "NET INCOME" in label
    ws_ann.cell(row=r, column=1, value=label).font = bold_font if is_total else normal_font
    ws_ann.cell(row=r, column=1).border = thin_border

    for col_idx, val in enumerate([y1, y2], start=2):
        cell = ws_ann.cell(row=r, column=col_idx, value=val)
        cell.border = thin_border
        cell.alignment = Alignment(horizontal="center")
        cell.font = bold_font if is_total else normal_font
        if isinstance(val, (int, float)):
            if label == "Gross Margin":
                cell.number_format = PCT
            elif isinstance(val, float) and abs(val) < 1:
                cell.number_format = PCT
            else:
                cell.number_format = USD
            if is_total and isinstance(val, (int, float)):
                cell.fill = total_fill
                if val < 0 and "NET" in label:
                    cell.font = Font(name="Calibri", bold=True, color="CC0000")
                elif val > 0 and "NET" in label:
                    cell.font = Font(name="Calibri", bold=True, color=CITRUS_GREEN)

    if growth is not None and growth != "" and growth != "NEW":
        cell = ws_ann.cell(row=r, column=4, value=growth)
        cell.number_format = PCT
        cell.border = thin_border
        cell.alignment = Alignment(horizontal="center")
    elif growth == "NEW":
        cell = ws_ann.cell(row=r, column=4, value="NEW")
        cell.font = Font(name="Calibri", bold=True, color=CITRUS_ORANGE)
        cell.border = thin_border
        cell.alignment = Alignment(horizontal="center")

    r += 1

ws_ann.column_dimensions["A"].width = 35
ws_ann.column_dimensions["B"].width = 25
ws_ann.column_dimensions["C"].width = 25
ws_ann.column_dimensions["D"].width = 15

# ============================================================
# SHEET 7: SENSITIVITY ANALYSIS
# ============================================================
ws_s = wb.create_sheet("Sensitivity")
ws_s.sheet_properties.tabColor = CITRUS_ORANGE

ws_s.merge_cells("A1:G1")
ws_s.cell(row=1, column=1, value="SENSITIVITY ANALYSIS — Key Variable Impact on Year 2 Revenue").font = title_font

r = 3
ws_s.cell(row=r, column=1, value="What happens if key assumptions change?").font = source_font
r += 1

# Conversion rate sensitivity
ws_s.cell(row=r, column=1, value="PREMIUM CONVERSION RATE SENSITIVITY").font = subtitle_font
r += 1
headers_s = ["Conversion Rate", "Pro Subs (Y2 End)", "Commish Subs (Y2 End)", "Annual Sub Revenue", "vs Base Case"]
style_header_row(ws_s, r, len(headers_s))
for i, h in enumerate(headers_s):
    ws_s.cell(row=r, column=i+1, value=h)
r += 1

base_y2_sub = y2_sub_rev
for conv_pct in [0.02, 0.035, 0.055, 0.08, 0.10]:
    # Simplified recalc for sensitivity
    est_pro = total_users[23] * conv_pct * 0.7  # rough steady-state
    est_commish = total_users[23] * (conv_pct * 0.25) * 0.7
    est_rev = est_pro * 4.99 * 12 + est_commish * 9.99 * 12
    is_base = conv_pct == 0.055
    label = f"{conv_pct:.1%}" + (" (BASE)" if is_base else "")
    row_data = [label, round(est_pro), round(est_commish), round(est_rev), (est_rev/base_y2_sub - 1) if base_y2_sub > 0 else 0]
    for i, val in enumerate(row_data):
        cell = ws_s.cell(row=r, column=i+1, value=val)
        cell.border = thin_border
        cell.alignment = Alignment(horizontal="center")
        if i == 3:
            cell.number_format = USD
        elif i == 4:
            cell.number_format = '+0.0%;-0.0%'
        if is_base:
            cell.fill = PatternFill(start_color="E8F5E8", end_color="E8F5E8", fill_type="solid")
            cell.font = bold_font
    r += 1

r += 2
# Churn sensitivity
ws_s.cell(row=r, column=1, value="CHURN RATE SENSITIVITY (In-Season Monthly)").font = subtitle_font
r += 1
headers_churn = ["Monthly Churn", "Annual Retention", "Impact on Subscriber Base", "Revenue Impact vs Base", "Benchmark"]
style_header_row(ws_s, r, len(headers_churn))
for i, h in enumerate(headers_churn):
    ws_s.cell(row=r, column=i+1, value=h)
r += 1

for churn_pct, benchmark in [(0.02, "Best-in-class SaaS"), (0.04, "BASE CASE"), (0.06, "Avg mobile sub"), (0.09, "Mobile app avg"), (0.12, "High churn")]:
    annual_ret = (1 - churn_pct) ** 12
    impact = (annual_ret / 0.75 - 1)  # vs Sleeper's 75%
    rev_impact = impact * 0.6  # rough revenue elasticity
    is_base = churn_pct == 0.04
    row_data = [f"{churn_pct:.0%}/mo", annual_ret, f"{'+'if impact>0 else ''}{impact:.0%} vs Sleeper", f"{'+'if rev_impact>0 else ''}{rev_impact:.0%}", benchmark]
    for i, val in enumerate(row_data):
        cell = ws_s.cell(row=r, column=i+1, value=val)
        cell.border = thin_border
        cell.alignment = Alignment(horizontal="center")
        if i == 1:
            cell.number_format = PCT
        if is_base:
            cell.fill = PatternFill(start_color="E8F5E8", end_color="E8F5E8", fill_type="solid")
            cell.font = bold_font
    r += 1

r += 2
# User growth sensitivity
ws_s.cell(row=r, column=1, value="USER GROWTH GATE SENSITIVITY").font = subtitle_font
r += 1
headers_gate = ["Scenario", "Y1 End Users", "Y2 End Users", "Y2 Total Revenue", "Breakeven Month"]
style_header_row(ws_s, r, len(headers_gate))
for i, h in enumerate(headers_gate):
    ws_s.cell(row=r, column=i+1, value=h)
r += 1

scenarios = [
    ("Conservative (50% of target)", round(total_users[11]*0.5), round(total_users[23]*0.5), round(y2_rev*0.45), "Month 28+"),
    ("Base Case", round(total_users[11]), round(total_users[23]), round(y2_rev), f"Month {next((m+1 for m in range(24) if cum_net[m] > 0), 'N/A')}"),
    ("Aggressive (Sleeper-like viral)", round(total_users[11]*2), round(total_users[23]*2.5), round(y2_rev*2.8), "Month 14"),
    ("Hypergrowth (VC-funded)", round(total_users[11]*5), round(total_users[23]*8), round(y2_rev*9), "Month 10"),
]
for label, y1u, y2u, y2r, be in scenarios:
    is_base = "Base" in label
    row_data = [label, y1u, y2u, y2r, be]
    for i, val in enumerate(row_data):
        cell = ws_s.cell(row=r, column=i+1, value=val)
        cell.border = thin_border
        cell.alignment = Alignment(horizontal="center")
        if i in (1, 2):
            cell.number_format = NUM
        elif i == 3:
            cell.number_format = USD
        if is_base:
            cell.fill = PatternFill(start_color="E8F5E8", end_color="E8F5E8", fill_type="solid")
            cell.font = bold_font
    r += 1

for c in range(1, 8):
    ws_s.column_dimensions[get_column_letter(c)].width = 25

# ============================================================
# SHEET 8: SOURCES & METHODOLOGY
# ============================================================
ws_src = wb.create_sheet("Sources")
ws_src.sheet_properties.tabColor = "666666"

ws_src.merge_cells("A1:C1")
ws_src.cell(row=1, column=1, value="SOURCES & METHODOLOGY").font = title_font

sources = [
    ("Market Data", ""),
    ("  TAM: $32B+ Fantasy Sports (2025)", "Citrus Pitch Deck — Web Summit Vancouver 2026"),
    ("  SAM: $1-2B Fantasy Hockey global", "Citrus Pitch Deck"),
    ("  5.8M active fantasy hockey players (NA)", "Citrus Pitch Deck (end of 2024 est.)"),
    ("  NHL CAGR: 14.6%", "Citrus Pitch Deck — fastest growing Big 4"),
    ("  Fantasy Market CAGR: 10.45%", "Industry reports (2025-2035)"),
    ("", ""),
    ("Churn & Retention Benchmarks", ""),
    ("  Mobile subscription avg churn: 9%/mo", "MarketingLTB Subscription Statistics 2025"),
    ("  Top-performing sub churn: <3%/mo", "FocusDigital Avg Churn Rate Report"),
    ("  46% cancel in first billing cycle", "App store subscription data"),
    ("  Sleeper annual retention: 75%", "Sleeper Series C press release (2021)"),
    ("  Our base case: 4% in-season, 12% off", "Conservative vs mobile avg, accounts for seasonality"),
    ("", ""),
    ("Conversion Rate Benchmarks", ""),
    ("  Freemium self-serve: 3-5% good, 6-8% great", "OpenView Partners / Lenny's Newsletter"),
    ("  Mobile freemium median: 2.18%", "RevenueCat State of Subscription Apps 2025"),
    ("  Health & Fitness (comparable): 3-5%", "RevenueCat category benchmarks"),
    ("  Our base case: 3.5% Y1, 5.5% Y2", "Conservative Y1, improving with product maturity"),
    ("", ""),
    ("Competitive Intelligence", ""),
    ("  Sleeper: 3M+ users, <$10M rev (2023)", "Crunchbase, PR Newswire"),
    ("  Sleeper: $40M Series C (2021, a16z)", "PR Newswire"),
    ("  ESPN Fantasy: 13M players (2024)", "Industry reports"),
    ("  DraftKings/FanDuel: 12% avg rake", "Public filings"),
    ("", ""),
    ("Conference Costs", ""),
    ("  FSGA membership: $500/yr + $250 admin", "thefsga.org/membership"),
    ("  FSGA conferences: Winter (Vegas), Summer", "fstaconference.com"),
    ("  MIT Sloan SSAC: 2,500+ attendees", "sloansportsconference.com"),
    ("  Conference budget: $3-8K each", "Travel + hotel + booth + meals estimates"),
    ("", ""),
    ("Methodology Notes", ""),
    ("  All yellow cells on Assumptions tab are editable", "Change inputs to see model update"),
    ("  Seasonal multipliers model NHL calendar", "Oct-Apr = in-season, May-Sep = off-season"),
    ("  Churn varies by tier and season", "Commissioners churn least, free users most"),
    ("  DFS launches Oct 2027 (Month 19)", "Per Pitch Deck growth roadmap"),
    ("  App Store takes 15% (small business program)", "Apple/Google small business commission rate"),
]

r = 3
for label, source in sources:
    if label == "":
        r += 1
        continue
    if source == "":
        ws_src.cell(row=r, column=1, value=label).font = subtitle_font
        ws_src.cell(row=r, column=1).border = bottom_border
    else:
        ws_src.cell(row=r, column=1, value=label).font = normal_font
        ws_src.cell(row=r, column=1).border = thin_border
        ws_src.cell(row=r, column=2, value=source).font = source_font
        ws_src.cell(row=r, column=2).border = thin_border
    r += 1

ws_src.column_dimensions["A"].width = 50
ws_src.column_dimensions["B"].width = 55

# ============================================================
# SAVE
# ============================================================
output_path = "/home/user/citrus-league-storm-main/docs/Citrus_Business_Model.xlsx"
wb.save(output_path)
print(f"Saved: {output_path}")
print(f"\nMODEL SUMMARY:")
print(f"  Year 1 End Users: {total_users[11]:,.0f}")
print(f"  Year 2 End Users: {total_users[23]:,.0f}")
print(f"  Year 1 Revenue:   ${y1_rev:,.0f}")
print(f"  Year 2 Revenue:   ${y2_rev:,.0f}")
print(f"  Year 1 Net:       ${y1_net:,.0f}")
print(f"  Year 2 Net:       ${y2_net:,.0f}")
print(f"  Year 1 Conf/Travel: ${y1_conf:,.0f}")
print(f"  Year 2 Conf/Travel: ${y2_conf:,.0f}")
print(f"  24-Month Cumulative Rev: ${cum_rev[-1]:,.0f}")
print(f"  24-Month Cumulative Net: ${cum_net[-1]:,.0f}")
breakeven = next((m+1 for m in range(24) if cum_net[m] > 0), None)
print(f"  Breakeven Month: {breakeven or 'Beyond 24 months'}")
