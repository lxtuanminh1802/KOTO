from app.domain import analysis_label, fps_value, nearest_color, normalize_modes, plate_match, plate_norm


def test_plate_norm_strips_separators():
    assert plate_norm("29a-123.45") == "29A12345"
    assert plate_norm(" 51F 888.* ") == "51F888*"


def test_plate_exact_and_partial():
    assert plate_match("29A-123.45", "29A-123.45")
    assert plate_match("29A-123.45", "12345")  # partial number (UR-SRCH-04)
    assert not plate_match("29A-123.45", "30A")
    assert not plate_match(None, "29A")
    assert not plate_match("29A-123.45", "")


def test_plate_wildcards():
    assert plate_match("51F-888.12", "51F-888.*")
    assert plate_match("51F-888.12", "51F-888.?2")
    assert not plate_match("51G-888.12", "51F-888.*")
    assert not plate_match("51F-888.123", "51F-888.??")


def test_fps_value_caps_at_native():
    assert fps_value("all", 12) == 12
    assert fps_value("10", 6) == 6
    assert fps_value("2", 25) == 2


def test_normalize_modes_ignores_unknown_keys():
    m = normalize_modes({"person": {"face": False, "bogus": True}, "drone": {"x": True}})
    assert m["person"]["face"] is False
    assert "bogus" not in m["person"] and "drone" not in m
    assert m["vehicle"]["plate"] is True


def test_analysis_label():
    assert analysis_label("5", normalize_modes(None)) == "5 FPS · Con người, Phương tiện"
    assert analysis_label("all", {"person": {"face": True}, "vehicle": {"plate": False}}, "en") == "Every frame · People"


def test_nearest_color():
    assert nearest_color((250, 250, 250)) == "white"
    assert nearest_color((200, 40, 40)) == "red"
    assert nearest_color((40, 80, 220)) == "blue"
