"""Validation for explicitly requested resumes of interrupted scraper runs."""
from decimal import Decimal, InvalidOperation
from helpers import json_value, school_result_from_dict


CHECKPOINT_VERSION = 2


def score_is_weaker(proposed, stored):
    if stored is None:
        return False
    try:
        incoming = Decimal(str(proposed))
        existing = Decimal(str(stored))
    except (InvalidOperation, ValueError, TypeError):
        return True
    if not incoming.is_finite() or not existing.is_finite():
        return True
    return incoming < existing


def restore_calendar_review(saved, completed):
    if not isinstance(saved, dict) or saved.get("version") != CHECKPOINT_VERSION:
        return []
    entries = saved.get("calendar_review", [])
    if not isinstance(entries, list):
        return []
    return [dict(item) for item in entries if isinstance(item, dict)
            and isinstance(item.get("school"), str) and item["school"] in completed
            and isinstance(item.get("reason"), str)]



def restore_checkpoint(saved, schools):
    if not isinstance(saved, dict) or saved.get("version") != CHECKPOINT_VERSION:
        return {}
    if not isinstance(saved.get("calendar_review"), list):
        return {}
    entries = saved.get("completed")
    if not isinstance(entries, dict):
        return {}
    completed = {}
    for school in schools:
        value = entries.get(school.facility_key)
        if not isinstance(value, dict) or value.get("school") != json_value(school):
            continue
        try:
            result = school_result_from_dict(value)
            if result.error or not result.resolution.resolved:
                continue
            if any(not isinstance(item, dict) for key in ("contacts", "events")
                   for item in value.get(key, [])):
                continue
        except (TypeError, ValueError, AttributeError, KeyError):
            continue
        completed[school.facility_key] = value
    return completed
