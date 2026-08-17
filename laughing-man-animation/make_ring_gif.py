from PIL import Image
import os

# ==============================
# SETTINGS
# ==============================

RING_FILE = "laughing-man-text.png"
BOTTOM_FILE = "laughing-man-bottom.png"
TOP_FILE = "laughing-man-top.png"

OUTPUT_FILE = "laughing-man.gif"

FRAME_COUNT = 240
ROTATION = 360

# Milliseconds per frame
FRAME_DURATION = 200

# ==============================
# LOAD IMAGES
# ==============================

ring = Image.open(RING_FILE).convert("RGBA")
bottom = Image.open(BOTTOM_FILE).convert("RGBA")
top = Image.open(TOP_FILE).convert("RGBA")

# ==============================
# DETERMINE CANVAS SIZE
# ==============================

size = max(
    ring.width,
    ring.height,
    bottom.width,
    bottom.height,
    top.width,
    top.height
)

# Make sure the canvas is square
size = max(size, bottom.width, bottom.height, top.width, top.height)

# ==============================
# CENTER IMAGE ON CANVAS
# ==============================

def center_on_canvas(image):
    canvas = Image.new(
        "RGBA",
        (size, size),
        (0, 0, 0, 0)
    )

    x = (size - image.width) // 2
    y = (size - image.height) // 2

    canvas.alpha_composite(image, (x, y))

    return canvas


bottom = center_on_canvas(bottom)
top = center_on_canvas(top)
ring = center_on_canvas(ring)

# ==============================
# FIND ACTUAL RING CENTER
# ==============================

alpha = ring.getchannel("A")
bbox = alpha.getbbox()

if bbox is None:
    raise ValueError("laughing-man-text2.png appears to be completely transparent.")

left, top_edge, right, bottom_edge = bbox

ring_center_x = (left + right) / 2
ring_center_y = (top_edge + bottom_edge) / 2

canvas_center_x = 307.5
canvas_center_y = 333

print(f"Ring visible bounding box: {bbox}")
print(
    f"Ring center:   "
    f"({ring_center_x:.2f}, {ring_center_y:.2f})"
)
print(
    f"Canvas center: "
    f"({canvas_center_x:.2f}, {canvas_center_y:.2f})"
)

# ==============================
# MOVE RING TO EXACT CENTER
# ==============================

shift_x = round(canvas_center_x - ring_center_x)
shift_y = round(canvas_center_y - ring_center_y)

# Manual adjustment
shift_x += 0
shift_y += 0

centered_ring = Image.new(
    "RGBA",
    (size, size),
    (0, 0, 0, 0)
)

centered_ring.alpha_composite(
    ring,
    (shift_x, shift_y)
)

ring = centered_ring

# ==============================
# GENERATE ANIMATION
# ==============================

frames = []

degrees_per_frame = ROTATION / FRAME_COUNT

for i in range(FRAME_COUNT):

    angle = degrees_per_frame * i

    # Rotate around the exact center of the canvas
    rotated_ring = ring.rotate(
        angle,
        resample=Image.Resampling.BICUBIC,
        expand=False,
        center=(canvas_center_x, canvas_center_y)
    )

    # --------------------------
    # COMPOSITE THE THREE LAYERS
    # --------------------------

    # Bottom layer
    frame = bottom.copy()

    # Rotating ring/text
    frame.alpha_composite(rotated_ring)

    # Top layer
    frame.alpha_composite(top)

    # Convert to RGB for GIF
    frame = frame.convert("RGB")

    frames.append(frame)

    print(
        f"Frame {i + 1}/{FRAME_COUNT}: "
        f"{angle:.2f}°"
    )

# ==============================
# SAVE GIF
# ==============================

frames[0].save(
    OUTPUT_FILE,
    save_all=True,
    append_images=frames[1:],
    duration=FRAME_DURATION,
    loop=0,
    optimize=True
)

print()
print("Finished!")
print(f"GIF saved as: {OUTPUT_FILE}")
print(f"Frames: {FRAME_COUNT}")
print(f"Duration per frame: {FRAME_DURATION} ms")
print(f"Total animation length: "
      f"{FRAME_COUNT * FRAME_DURATION / 1000:.2f} seconds")