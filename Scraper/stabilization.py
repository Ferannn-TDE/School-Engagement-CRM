"""Validation for explicitly requested resumes of interrupted scraper runs."""
from helpers import json_value, school_result_from_dict


def restore_checkpoint(saved, schools):
    if not isinstance(saved, dict) or saved.get("version") != 1:
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
