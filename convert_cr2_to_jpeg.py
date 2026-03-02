"""Convert CR2 raw images to high-quality JPEG files."""

import os
import rawpy
from PIL import Image

INPUT_DIR = r"" #file origin
OUTPUT_DIR = r"" #file destination

os.makedirs(OUTPUT_DIR, exist_ok=True)

cr2_files = [f for f in os.listdir(INPUT_DIR) if f.lower().endswith(".cr2")]
print(f"Found {len(cr2_files)} CR2 files")

for filename in cr2_files:
    input_path = os.path.join(INPUT_DIR, filename)
    output_path = os.path.join(OUTPUT_DIR, os.path.splitext(filename)[0] + ".jpg")

    print(f"Converting: {filename}")
    with rawpy.imread(input_path) as raw:
        rgb = raw.postprocess(use_camera_wb=True, no_auto_bright=False)
    img = Image.fromarray(rgb)
    img.save(output_path, "JPEG", quality=95, subsampling=0)

print("Done!")
