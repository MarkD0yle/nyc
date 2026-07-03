from .config import puma_table


def load_lookup() -> dict[str, dict]:
    """5-digit PUMA -> {'borough', 'neighborhood'} for all NYC PUMAs."""
    return dict(puma_table())
