#!/usr/bin/env python3
"""
tools/inventory.py - Read-Only Game File Inventory and Forensic Analyzer
Examines a target directory, extracts non-sensitive file metadata (sizes, extensions, sha256),
classifies candidate binaries, archives, and asset containers, and outputs an inventory JSON/CSV.
NEVER reads or extracts proprietary content into git or public repositories.
"""

import os
import sys
import json
import hashlib
import argparse
from pathlib import Path

KNOWN_CATEGORIES = {
    ".exe": "executable",
    ".dll": "native_library",
    ".asi": "sound_plugin",
    ".m3d": "miles_sound_driver",
    ".tsk": "miles_task",
    ".bik": "video_bink",
    ".mp3": "audio_music",
    ".wav": "audio_sfx",
    ".mdl": "3d_model",
    ".msh": "mesh_level_geometry",
    ".ani": "animation_track",
    ".cap": "collision_capsule",
    ".ctx": "texture_container",
    ".czx": "compressed_texture",
    ".tex": "texture_metadata",
    ".stg": "stage_definition",
    ".bin": "binary_script_or_table",
    ".cfg": "configuration",
    ".ini": "configuration",
    ".txt": "documentation",
    ".tab": "lookup_table",
    ".ary": "data_array",
    ".dat": "installer_data",
    ".msg": "installer_messages"
}

def compute_sha256(filepath, max_bytes=10*1024*1024):
    """Compute sha256 checksum of file safely, reading in chunks."""
    h = hashlib.sha256()
    try:
        with open(filepath, 'rb') as f:
            while chunk := f.read(65536):
                h.update(chunk)
        return h.hexdigest()
    except Exception as e:
        return f"error: {str(e)}"

def run_inventory(target_dir: str, output_json: str = None):
    root_path = Path(target_dir).resolve()
    if not root_path.exists() or not root_path.is_dir():
        print(f"[ERROR] Target directory '{target_dir}' does not exist or is not a directory.", file=sys.stderr)
        sys.exit(1)

    print(f"[*] Scanning read-only inventory for: {root_path}")
    files_record = []
    category_summary = {}

    for root, dirs, files in os.walk(root_path):
        for f in files:
            full_path = Path(root) / f
            try:
                rel_path = full_path.relative_to(root_path).as_posix()
                size = full_path.stat().st_size
                ext = full_path.suffix.lower()
                cat = KNOWN_CATEGORIES.get(ext, "unknown_data")

                record = {
                    "path": rel_path,
                    "extension": ext,
                    "size_bytes": size,
                    "category": cat
                }

                # Only hash if smaller than 50MB to be fast and low-impact
                if size < 50 * 1024 * 1024:
                    record["sha256"] = compute_sha256(full_path)
                else:
                    record["sha256"] = "skipped_size_exceeds_threshold"

                files_record.append(record)
                category_summary[cat] = category_summary.get(cat, 0) + 1

            except Exception as ex:
                print(f"[WARN] Failed scanning {full_path}: {ex}", file=sys.stderr)

    inventory_data = {
        "source_directory": str(root_path),
        "total_files": len(files_record),
        "total_bytes": sum(r["size_bytes"] for r in files_record),
        "categories": category_summary,
        "files": files_record
    }

    if output_json:
        out_p = Path(output_json)
        out_p.parent.mkdir(parents=True, exist_ok=True)
        with open(out_p, "w", encoding="utf-8") as out_f:
            json.dump(inventory_data, out_f, indent=2)
        print(f"[+] Inventory saved to {out_p} ({len(files_record)} files cataloged)")
    else:
        print(json.dumps({
            "total_files": inventory_data["total_files"],
            "total_bytes": inventory_data["total_bytes"],
            "categories": category_summary
        }, indent=2))

    return inventory_data

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Read-only game file inventory analyzer")
    parser.add_argument("target_dir", help="Path to installed game directory")
    parser.add_argument("--out", "-o", help="Path to save inventory JSON file", default=None)
    args = parser.parse_args()

    run_inventory(args.target_dir, args.out)
