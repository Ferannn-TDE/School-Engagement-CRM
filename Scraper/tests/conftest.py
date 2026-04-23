# tests/conftest.py
import sys
import types


def _stub_dotenv_if_missing():
    try:
        import dotenv  # noqa: F401
    except ModuleNotFoundError:
        mod = types.ModuleType("dotenv")
        mod.load_dotenv = lambda *args, **kwargs: None
        sys.modules["dotenv"] = mod


def _stub_supabase_if_missing():
    try:
        import supabase  # noqa: F401
    except ModuleNotFoundError:
        supabase_mod = types.ModuleType("supabase")
        supabase_mod.create_client = lambda *args, **kwargs: None
        supabase_mod.Client = object
        client_mod = types.ModuleType("supabase.client")

        class ClientOptions:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

        client_mod.ClientOptions = ClientOptions
        sys.modules["supabase"] = supabase_mod
        sys.modules["supabase.client"] = client_mod


def _stub_playwright_if_missing():
    try:
        import playwright.async_api  # noqa: F401
    except ModuleNotFoundError:
        playwright_mod = types.ModuleType("playwright")
        async_api_mod = types.ModuleType("playwright.async_api")

        async def async_playwright():
            raise RuntimeError("playwright not installed in this environment")

        async_api_mod.async_playwright = async_playwright
        sys.modules["playwright"] = playwright_mod
        sys.modules["playwright.async_api"] = async_api_mod


def _stub_spacy_if_missing():
    try:
        import spacy  # noqa: F401
    except ModuleNotFoundError:
        spacy_mod = types.ModuleType("spacy")

        class FakeDoc:
            ents = []

        class FakeNLP:
            def __call__(self, text):
                return FakeDoc()

        spacy_mod.load = lambda *args, **kwargs: FakeNLP()
        sys.modules["spacy"] = spacy_mod


_stub_dotenv_if_missing()
_stub_supabase_if_missing()
_stub_playwright_if_missing()
_stub_spacy_if_missing()