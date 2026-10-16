"""Reviewed decisions for every knowledge-base file.

Each file is tagged with its audience and status. Only customer-facing,
current documents are indexed for retrieval. Rules from internal documents
that the agent must follow are encoded as policy in the app, not retrieved.
"""

# path relative to knowledge_base/ -> (audience, status, effective_date, reason)
REGISTRY = {
    "faq/customer_faq.md": ("customer", "current", "2026-03-02", "Latest dated FAQ"),
    "faq/faq_old_copy.md": ("customer", "superseded", None,
                            "Undated copy of the FAQ with older fees ($79 diag, $129 after-hours) and hours; superseded by customer_faq.md"),
    "faq/troubleshooting_before_you_call.md": ("customer", "current", None,
                                               "Undated but conflicts with nothing; pre-visit checks. Served only after safety triggers are ruled out"),
    "membership/comfort_club_overview.md": ("customer", "current", "2026-01-01", "Current membership terms; agrees with the 2026 fee schedule"),
    "archive/comfort_club_overview.md": ("customer", "superseded", None,
                                         "Archived membership terms ($149/yr, 10% off, transfer to new address); contradicts the 2026 doc"),
    "archive/warranty_terms_2023.txt": ("customer", "superseded", "2023",
                                        "2023 terms (90-day repair labor); superseded by warranty_policy.md (2025-06-15)"),
    "warranty/warranty_policy.md": ("customer", "current", "2025-06-15", "Current warranty policy"),
    "pricing/2026_fee_schedule.pdf": ("customer", "current", "2026-01-01", "Fee table; supersedes all prior fee schedules"),
    "pricing/repair_price_book_2026.csv": ("customer", "current", "2026", "Repair price ranges; agrees with the service catalog"),
    "services/service_catalog.md": ("customer", "current", "2026-02-10", "Services, price ranges, what is not offered"),
    "services/duct_cleaning.md": ("customer", "stub", None, "TODO stub with no content; catalog says duct cleaning is a partner referral"),
    "services/scheduling_guide.md": ("internal", "superseded", "2024-11",
                                     "Agent guide; its 48-hour cancellation rule conflicts with the newer FAQ and fee schedule (24 hours)"),
    "services/technician_arrival_and_etas.md": ("internal", "current", None,
                                                "Agent procedures for late technicians, including fee waivers; late-tech calls escalate"),
    "policies/escalation_and_safety.md": ("internal", "current", "2026-01",
                                          "Internal protocol; encoded as app policy (safety script, escalation list), not retrieved"),
    "policies/service_area.md": ("customer", "current", "2026-04-01",
                                 "Newest service area (adds Dripping Springs, Manor); Lakeway line contradicts '787xx all' and is escalated"),
    "policies/holiday_hours_2026.png": ("customer", "current", "2026", "Image-only; text recovered by OCR"),
    "internal/agent_discretion_notes.md": ("internal", "current", None,
                                           "Agent-only discretion rules; never read to customers. 'Pricing is not firm' is encoded as app policy"),
}


def indexed(path: str) -> bool:
    audience, status, _, _ = REGISTRY[path]
    return audience == "customer" and status == "current"
