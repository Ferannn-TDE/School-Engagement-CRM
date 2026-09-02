from dataclasses import dataclass, field


@dataclass
class Candidate:
    url: str
    label: str
    source: str
    parent: str
    depth: int
    score: float


@dataclass
class School:
    facility_key: str
    name: str
    state: str
    district_name: str = ""
    district_code: str = ""
    city: str = ""
    county: str = ""
    address: str = ""
    zipcode: str = ""
    phone: str = ""
    grades: str = ""
    website: str = ""
    district_website: str = ""
    administrator: str = ""
    administrator_title: str = ""
    directory_email: str = ""
    nces_id: str = ""
    state_id: str = ""
    enrollment: int | None = None
    data_source: str = ""
    peer_names: tuple[str, ...] = ()
    alternate_seeds: tuple[str, ...] = ()

    @property
    def seeds(self):
        from helpers import canonical_url

        values = [self.website, self.district_website, *self.alternate_seeds]
        urls = []
        for value in values:
            url = canonical_url(value)
            if url and url not in urls:
                urls.append(url)
        return urls


@dataclass
class Page:
    requested_url: str
    url: str
    status: int = 0
    text: str = ""
    content_type: str = ""
    error: str = ""
    rendered: bool = False

    @property
    def ok(self):
        return 200 <= self.status < 400 and bool(self.text)


@dataclass
class PageDecision:
    accepted: bool
    scope: str
    identity_score: float
    route_score: float
    authority_score: float
    platform: str = "generic"
    reasons: list[str] = field(default_factory=list)


@dataclass
class Resolution:
    status: str
    seed_url: str = ""
    fallback_url: str = ""
    resolved_url: str = ""
    method: str = ""
    identity_score: float = 0.0
    route_score: float = 0.0
    authority_score: float = 0.0
    platform: str = "unknown"
    authority_url: str = ""
    reason: str = ""
    trace: list[dict] = field(default_factory=list)

    @property
    def resolved(self):
        return self.status == "resolved" and bool(self.resolved_url)


@dataclass
class Contact:
    name: str
    title: str
    role: str
    email: str = ""
    phone: str = ""
    extension: str = ""
    department: str = ""
    source_url: str = ""
    method: str = ""
    extraction_score: float = 0.0
    assignment_score: float = 0.0
    score: float = 0.0
    assignment_reason: str = ""


@dataclass
class Event:
    title: str
    start: str
    end: str = ""
    location: str = ""
    description: str = ""
    category: str = ""
    source_url: str = ""
    method: str = ""
    score: float = 0.0


@dataclass
class SchoolResult:
    school: School
    resolution: Resolution
    contacts: list[Contact] = field(default_factory=list)
    events: list[Event] = field(default_factory=list)
    contact_pages: list[str] = field(default_factory=list)
    calendar_pages: list[str] = field(default_factory=list)
    error: str = ""
