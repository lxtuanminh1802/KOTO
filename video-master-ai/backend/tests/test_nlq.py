from app.services.nlq import parse


def test_vietnamese_with_accents():
    r = parse("Tìm nam mặc áo khoác đen, quần jean xanh dương, đeo khẩu trang")
    f = r["filters"]
    assert f["gender"] == ["m"]
    assert f["top"] == ["long"]
    assert f["bottom"] == ["pants"]
    assert f["mask"] == ["yes"]
    assert set(f["color"]) >= {"black", "blue"}
    assert not r["empty"]


def test_vietnamese_without_accents_and_negated_mask():
    f = parse("co gai vay hong khong deo khau trang, co ba lo")["filters"]
    assert f["gender"] == ["f"]
    assert f["bottom"] == ["skirt"]
    assert f["mask"] == ["no"]
    assert f["acc"] == ["bag"]
    assert "pink" in f["color"]


def test_vehicle_query():
    r = parse("xe ô tô màu trắng")
    assert r["vehicle"] is True
    assert r["filters"]["color"] == ["white"]


def test_english():
    f = parse("woman with a red hat")["filters"]
    assert f["gender"] == ["f"] and f["acc"] == ["hat"] and f["color"] == ["red"]


def test_nonsense_is_empty():
    assert parse("hôm nay trời đẹp")["empty"]
