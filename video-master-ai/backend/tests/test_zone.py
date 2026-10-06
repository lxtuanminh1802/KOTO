from app.services.analysis import _inside

SQUARE = [[10, 10], [60, 10], [60, 60], [10, 60]]
CONCAVE = [[0, 0], [100, 0], [100, 100], [50, 40], [0, 100]]  # notch from the bottom


def test_square():
    assert _inside((30, 30), SQUARE)
    assert not _inside((5, 30), SQUARE)
    assert not _inside((70, 70), SQUARE)


def test_concave_notch():
    assert _inside((20, 20), CONCAVE)
    assert not _inside((50, 80), CONCAVE)  # inside the notch, outside the polygon
    assert _inside((10, 80), CONCAVE)
