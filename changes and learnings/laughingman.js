// Example variables — adjust to taste
const canvas = document.getElementById("myCanvas");
const ctx = canvas.getContext("2d");
const spacing = 100;   // space between symbols
const faceSize = 60;   // overall diameter

// Function to draw circular text
function drawCircularText(ctx, text, centerX, centerY, radius) {
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#007BFF';
    const angleStep = (Math.PI * 2) / text.length;
    for (let i = 0; i < text.length; i++) {
        const angle = -Math.PI / 2 + (i * angleStep);
        ctx.save();
        ctx.translate(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
        ctx.rotate(angle + Math.PI / 2);
        ctx.fillText(text[i], 0, 0);
        ctx.restore();
    }
}

// Main loop to draw grid
for (let y = 50; y < canvas.height; y += spacing) {
    for (let x = 50; x < canvas.width; x += spacing) {

        // Outer ring
        ctx.strokeStyle = '#007BFF'; // Laughing Man blue
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(x, y, faceSize / 2, 0, Math.PI * 2);
        ctx.stroke();

        // Circular text
        drawCircularText(ctx, "I thought what I'd do was, I'd pretend I was one of those deaf-mutes", 
            x, y, (faceSize / 2) - 3);

        // Eyes: straight slits
        ctx.strokeStyle = '#007BFF';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 10, y - 8);
        ctx.lineTo(x - 2, y - 8);
        ctx.moveTo(x + 2, y - 8);
        ctx.lineTo(x + 10, y - 8);
        ctx.stroke();

        // Smile: wide curve
        ctx.beginPath();
        ctx.arc(x, y + 4, 14, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
    }