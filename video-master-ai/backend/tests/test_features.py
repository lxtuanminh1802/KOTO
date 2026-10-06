from app.engine.features import identity_vector, similarity


def test_same_identity_scores_high_and_strangers_low():
    a = identity_vector("P01", "cam1")
    b = identity_vector("P01", "cam2")
    c = identity_vector("P02", "cam1")
    assert similarity(a, b) >= 85  # above the alert threshold
    assert similarity(a, c) < 60  # below the search threshold


def test_vectors_are_deterministic():
    assert identity_vector("P07", "x") == identity_vector("P07", "x")
