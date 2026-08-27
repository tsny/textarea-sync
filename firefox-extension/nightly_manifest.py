#!/usr/bin/env python3

import argparse
import json
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate the Firefox Nightly extension manifest."
    )
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--destination", required=True, type=Path)
    parser.add_argument("--id", required=True)
    parser.add_argument("--version", required=True)
    return parser.parse_args()


def main():
    args = parse_args()
    manifest = json.loads(args.source.read_text())

    manifest["name"] = "Textarea Sync Nightly"
    manifest["description"] = (
        "Nightly build of Textarea Sync with local storage and GitHub Gist sharing."
    )
    manifest["version"] = args.version
    manifest["browser_specific_settings"]["gecko"]["id"] = args.id
    manifest["action"]["default_title"] = "Open latest Textarea (Nightly)"

    args.destination.write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
