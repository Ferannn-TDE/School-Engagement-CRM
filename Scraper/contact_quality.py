from collections import Counter
from dataclasses import replace
import re

from helpers import (
    CONTACT_EXACT_TITLES,
    CONTACT_INVALID_NAME,
    CONTACT_INVALID_TITLE,
    CONTACT_TITLE_MAX_CHARACTERS,
    CONTACT_TITLE_MAX_WORDS,
    CONTACT_TITLE_WORDS,
    clean,
    contact_text,
    looks_like_person,
    normalize,
    normalized_role,
)


class ContactTitleNormalizer:
    @classmethod
    def normalize_title(cls, value):
        title = contact_text(value)
        if not title:
            return ""

        for pattern, replacement in CONTACT_EXACT_TITLES:
            if pattern.fullmatch(title):
                return replacement or title.replace("&", "and")

        was_upper = title.isupper()
        title = re.sub(r"\bAsst\.?\b", "Assistant", title, flags=re.I)
        title = re.sub(r"\bAssoc\.?\b", "Associate", title, flags=re.I)
        title = re.sub(r"\bMS\s*/\s*HS\b", "Middle/High School", title, flags=re.I)
        title = re.sub(r"\bH\.?\s*S\.?\b", "High School", title, flags=re.I)
        title = re.sub(r"\bJH\s*/\s*HS\b", "Junior/Senior High", title, flags=re.I)
        title = re.sub(r"\bPrin(?:cip)?\.?\b", "Principal", title, flags=re.I)
        title = re.sub(r"\bCouns\.?\b", "Counselor", title, flags=re.I)
        title = re.sub(r"\s+", " ", title).strip(" ,;:-")
        if was_upper and len(title.split()) <= 8:
            title = title.title()
            for acronym in ("BACC", "CTE", "ELL", "ES", "GS", "HS", "IEP", "JR", "MS", "SEC", "SR"):
                title = re.sub(rf"\b{acronym.title()}\b", acronym, title)
        return title.replace(" & ", " and ")

    @classmethod
    def decision(cls, contact):
        name = contact_text(contact.name)
        title = cls.normalize_title(contact.title)
        if not name or CONTACT_INVALID_NAME.search(name) or not looks_like_person(name):
            return None, "invalid_name", False
        if not title:
            return None, "missing_title", False
        if CONTACT_INVALID_TITLE.search(title):
            return None, "navigation_or_policy_text", False
        if len(title) > CONTACT_TITLE_MAX_CHARACTERS or len(title.split()) > CONTACT_TITLE_MAX_WORDS:
            return None, "title_too_long", False
        if re.match(r"^(?:and|as|contact|he|i|if|our|please|she|the|to|we)\b", title, re.I):
            return None, "sentence_not_title", False

        if "," in title:
            prefix, suffix = (part.strip() for part in title.split(",", 1))
            prefix_words = set(normalize(prefix).split())
            if looks_like_person(prefix) and not prefix_words & CONTACT_TITLE_WORDS:
                if normalize(prefix) != normalize(name):
                    return None, "different_person_in_title", False
                title = cls.normalize_title(suffix)

        title_role = normalized_role(title)
        if not title_role:
            return None, "unsupported_title", False
        changed = (
            title != clean(contact.title)
            or name != clean(contact.name)
            or title_role != contact.role
        )
        return replace(contact, name=name, title=title, role=title_role), "accepted", changed

    def process(self, results):
        reasons = Counter()
        input_count = 0
        accepted_count = 0
        normalized_count = 0

        for result in results:
            accepted = []
            for contact in result.contacts:
                input_count += 1
                updated, reason, changed = self.decision(contact)
                reasons[reason] += 1
                if updated is None:
                    continue
                accepted.append(updated)
                accepted_count += 1
                normalized_count += int(changed)
            result.contacts = accepted

        return {
            "input_contacts": input_count,
            "accepted_contacts": accepted_count,
            "normalized_titles": normalized_count,
            "rejected_contacts": input_count - accepted_count,
            "rejection_reasons": dict(sorted(reasons.items())),
        }
