from PIL import Image

input_path = "laughingman.gif"
output_path = "laughingman-60.gif"

SOURCE_FRAME_COUNT = 240
TARGET_FRAME_COUNT = 60

image = Image.open(input_path)

frames = []
durations = []

for i in range(SOURCE_FRAME_COUNT):
    image.seek(i)

    # Keep every 4th frame: 0, 4, 8, 12, ...
    if i % 4 == 0:
        frames.append(image.convert("RGBA").copy())

        original_duration = image.info.get("duration", 100)

        # Four original frames are being represented by one frame.
        durations.append(original_duration * 4)

frames[0].save(
    output_path,
    save_all=True,
    append_images=frames[1:],
    duration=durations,
    loop=0,
    disposal=2,
)

print(f"Created {output_path}")
print(f"Frames: {len(frames)}")
print(f"Original frames: {SOURCE_FRAME_COUNT}")
print(f"Frame reduction: {SOURCE_FRAME_COUNT / len(frames):.1f}x")