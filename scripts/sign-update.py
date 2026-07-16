import argparse
import base64
import os
from pathlib import Path

from nacl.signing import SigningKey


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("signature", type=Path)
    parser.add_argument("--public-key", type=Path, required=True)
    args = parser.parse_args()

    encoded = os.environ.get("CSBIP_UPDATE_SIGNING_KEY", "").strip()
    if not encoded:
        raise SystemExit("CSBIP_UPDATE_SIGNING_KEY is required")
    seed = base64.b64decode(encoded, validate=True)
    if len(seed) != 32:
        raise SystemExit("CSBIP_UPDATE_SIGNING_KEY must decode to 32 bytes")

    signing_key = SigningKey(seed)
    expected_public = args.public_key.read_text(encoding="ascii").strip()
    actual_public = base64.b64encode(bytes(signing_key.verify_key)).decode("ascii")
    if actual_public != expected_public:
        raise SystemExit("Signing secret does not match the embedded update public key")

    signature = signing_key.sign(args.manifest.read_bytes()).signature
    args.signature.write_text(base64.b64encode(signature).decode("ascii") + "\n", encoding="ascii")


if __name__ == "__main__":
    main()
