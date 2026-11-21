#!/usr/bin/env python3
"""既存の kaya-math HTML ファイルを Supabase (math_pages) へ一括移行するスクリプト。"""

from __future__ import annotations

import argparse
import html as html_lib
import os
import re
import subprocess
import unicodedata
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_ENV = ROOT_DIR.parent / "anki-studio" / ".env"

KNOWN_METADATA = {
    "夏明け12": {
        "badge": "夏明け No.12",
        "title": "三角柱の切断と立体の体積",
        "description": "三角柱 ABC-DEF を平面 DEK で切断した立体の体積を解説。切断線の把握から底面の特定、等積変形による求積プロセスを段階ごとに3D表示。",
        "tags": ["空間図形", "三角柱の切断", "ステップ解説"],
    },
    "夏明け17": {
        "badge": "夏明け No.17",
        "title": "空間内を動く球の通過領域（軌跡）",
        "description": "空間内を一定の規則で移動する球が通過する領域の立体構造（直方体・円柱・球の複合体）を、リアルタイムアニメーションとXYZ軸スライダーで体験。",
        "tags": ["空間図形", "球の通過領域", "インタラクティブ"],
    },
    "2学期中間11": {
        "badge": "２学期中間 No.11",
        "title": "立体図形の切断と体積比",
        "description": "立方体から三角錐を切り取り回転結合させた立体Vを平面で切断。切り口の面積や、手前・奥の立体の体積比を8段階の3Dステップアニメーションで視覚的に解説。",
        "tags": ["空間図形", "立体の切断", "体積比", "ステップ解説"],
    },
}


def normalize_key(filename: str) -> str:
    stem = unicodedata.normalize("NFKC", Path(filename).stem)
    stem = re.sub(r"^natsuake", "夏明け", stem, flags=re.IGNORECASE)
    return stem


def get_git_commit_dates(repo_dir: Path) -> dict[str, str]:
    """Gitログから各ファイルの最終コミット日時（ISO8601）を取得する（NFD/NFC両対応）。"""
    raw_bytes = subprocess.check_output(
        ["git", "-C", str(repo_dir), "-c", "core.quotepath=false", "log", "--name-only", "--format=__DATE__%cI"]
    ).decode("utf-8", errors="replace")
    dates: dict[str, str] = {}
    current_date = ""
    for line in raw_bytes.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("__DATE__"):
            current_date = line.removeprefix("__DATE__")
            continue
        nfc_name = unicodedata.normalize("NFC", line)
        if nfc_name not in dates and current_date:
            dates[nfc_name] = current_date
    return dates


def extract_metadata(filename_nfc: str, content: str) -> dict:
    key = normalize_key(filename_nfc)
    if key in KNOWN_METADATA:
        meta = dict(KNOWN_METADATA[key])
        return meta

    title_match = re.search(r"<title[^>]*>(.*?)</title>", content, re.IGNORECASE | re.DOTALL)
    h1_match = re.search(r"<h1[^>]*>(.*?)</h1>", content, re.IGNORECASE | re.DOTALL)

    raw_h1 = re.sub(r"<[^>]+>", "", h1_match.group(1)).strip() if h1_match else ""
    raw_title = re.sub(r"<[^>]+>", "", title_match.group(1)).strip() if title_match else ""
    title = html_lib.unescape(raw_h1 or raw_title or Path(filename_nfc).stem)
    title = re.sub(r"^[📐✏️📏🔺●○◆◇\s]+", "", title).strip()
    title = re.sub(r"\s*解説アニメーション.*$", "", title).strip()

    desc = ""
    meta_desc = re.search(
        r'<meta\s+name=["\']description["\']\s+content=["\'](.*?)["\']',
        content,
        re.IGNORECASE | re.DOTALL,
    )
    if meta_desc:
        desc = html_lib.unescape(meta_desc.group(1).strip())
    else:
        for p_match in re.finditer(r"<p[^>]*>(.*?)</p>", content, re.IGNORECASE | re.DOTALL):
            clean = html_lib.unescape(re.sub(r"<[^>]+>", "", p_match.group(1)).strip())
            if len(clean) >= 12 and "アニメーション解説" not in clean:
                desc = clean
                break
    if not desc:
        desc = f"{title}のインタラクティブ解説コンテンツです。"

    norm_stem = unicodedata.normalize("NFKC", Path(filename_nfc).stem)
    badge = ""
    tags: list[str] = []

    if "プリント作図問題" in norm_stem:
        m = re.search(r"プリント作図問題(\d+)(.*)", norm_stem)
        if m:
            badge = f"作図プリント No.{m.group(1)}{m.group(2)}"
        else:
            badge = "作図プリント"
        tags = ["作図", "プリント問題"]
    elif "作図" in norm_stem:
        badge = "基本作図"
        tags = ["作図", "定規とコンパス"]
    else:
        tags = ["数学"]

    if re.search(r"\bthree(?:\.min)?\.js\b|\bTHREE\.", content, re.IGNORECASE) or "OrbitControls" in content:
        if "空間図形" not in tags:
            tags.append("空間図形")
        tags.append("3D")

    return {
        "badge": badge,
        "title": title,
        "description": desc,
        "tags": tags,
    }


def collect_pages(repo_dir: Path) -> list[dict]:
    commit_dates = get_git_commit_dates(repo_dir)
    groups: dict[str, list[Path]] = {}
    for p in sorted(repo_dir.glob("*.html")):
        if p.name in ("index.html", "view.html"):
            continue
        key = normalize_key(p.name)
        groups.setdefault(key, []).append(p)

    pages: list[dict] = []
    for _key, files in groups.items():
        ascii_candidates = [f for f in files if f.name.isascii()]
        chosen = ascii_candidates[0] if ascii_candidates else files[0]
        slug = unicodedata.normalize("NFC", chosen.name)
        content = chosen.read_text(encoding="utf-8")
        meta = extract_metadata(slug, content)
        published_at = commit_dates.get(slug) or "2026-11-01T00:00:00+09:00"
        pages.append(
            {
                "slug": slug,
                "title": meta["title"],
                "badge": meta["badge"],
                "description": meta["description"],
                "tags": meta["tags"],
                "html_content": content,
                "file_size": len(content.encode("utf-8")),
                "published_at": published_at,
            }
        )

    pages.sort(key=lambda x: x["published_at"], reverse=True)
    return pages


def main() -> None:
    parser = argparse.ArgumentParser(description="kaya-math の既存HTMLを Supabase に移行する")
    parser.add_argument("--dry-run", action="store_true", help="DBには書き込まず内容のみ表示")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV, help=".env ファイルのパス")
    parser.add_argument("--seed-emails", nargs="*", help="許可アップロード先に追加するメールアドレス")
    args = parser.parse_args()

    pages = collect_pages(ROOT_DIR)
    print(f"検出コンテンツ数: {len(pages)} 件")
    for item in pages:
        print(
            f"  - {item['published_at'][:10]} | {item['slug']} | "
            f"[{item['badge']}] {item['title']} ({item['file_size'] // 1024} KB) tags={item['tags']}"
        )

    if args.dry_run:
        print("\n[dry-run] Supabase への書き込みはスキップしました。")
        return

    if args.env_file.exists():
        load_dotenv(args.env_file)

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("ERROR: SUPABASE_URL と SUPABASE_SECRET_KEY を設定してください。")

    sb = create_client(url, key)

    if args.seed_emails:
        rows = [{"email": e.strip().lower(), "label": "authorized"} for e in args.seed_emails if e.strip()]
        if rows:
            sb.table("math_allowed_uploaders").upsert(rows, on_conflict="email").execute()
            print(f"許可メールアドレスを {len(rows)} 件登録しました。")

    for item in pages:
        sb.table("math_pages").upsert(item, on_conflict="slug").execute()
    print(f"\n✅ {len(pages)} 件の移行が完了しました。")


if __name__ == "__main__":
    main()
