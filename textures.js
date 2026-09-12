function createSmileyTexture() {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');
            
            // Background (transparent)
            ctx.fillStyle = '#87CEEB'; // Light blue background
            ctx.fillRect(0, 0, 512, 256);
            
            // Create a grid of smiley faces
            const faceSize = 100;
            const spacing = 128;
            
            for (let y = 20; y < 256; y += spacing) {
                for (let x = 20; x < 512; x += spacing) {
                // Outer ring
                    ctx.strokeStyle = '#007BFF'; // Laughing Man blue
                    ctx.lineWidth = 10;
                    ctx.beginPath();
                    ctx.arc(x, y, faceSize/2, 0, Math.PI * 2);
                    ctx.stroke();

                    
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
            }
            
            return canvas.toDataURL();
        }

// ============================================================
// Create a text message texture
//
// Renders arbitrary user-supplied text onto a canvas, word-wrapping
// and auto-sizing the font so it fits. Explicit line breaks in the
// input (from a textarea) each start a new paragraph, which is then
// further word-wrapped to fit the width - so a whole typed paragraph
// spreads across multiple lines automatically.
//
// Returns the CANVAS itself (not a data URL). It's always used as a
// full sphere wrap (see main.js applyCustomText, faceCount hardcoded
// to 1) - each line ends up as its own horizontal band/latitude ring
// once wrapped onto the globe, top line near the north, working down.
//
// NOTE: this canvas is NOT pre-flipped. main.js's
// generateFullWrapTexture() applies the horizontal flip a full
// equirect wrap needs for correct (non-mirrored) orientation.
// ============================================================
function createTextTexture(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Background
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#1a1a2e');
    gradient.addColorStop(1, '#0a0a16');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Stars
    ctx.fillStyle = '#ffff00';
    for (let i = 0; i < 40; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        ctx.beginPath();
        ctx.arc(x, y, Math.random() * 1.5 + 0.5, 0, Math.PI * 2);
        ctx.fill();
    }

    const raw = (text && text.trim().length > 0) ? text : 'HELLO WORLD!';
    const paragraphs = raw.split('\n');

    const maxWidth = canvas.width * 0.86;
    const maxLines = 10;
    const minFontSize = 14;
    const maxVerticalFraction = 0.82;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Breaks a single word that's wider than maxWidth all on its own
    // (only reached for pathological input - one "word" wider than the
    // whole texture) into hyphenated chunks that each fit.
    function breakLongWord(word) {
        const chunks = [];
        let current = '';
        for (const ch of word) {
            const test = current + ch;
            if (ctx.measureText(test + '-').width <= maxWidth || current === '') {
                current = test;
            } else {
                chunks.push(current + '-');
                current = ch;
            }
        }
        if (current) chunks.push(current);
        return chunks;
    }

    // Word-wraps every paragraph to fit maxWidth at the given font size.
    function wrapAtFontSize(fontSize) {
        ctx.font = `bold ${fontSize}px Arial`;
        const lines = [];
        for (const para of paragraphs) {
            if (para.trim() === '') {
                lines.push('');
                continue;
            }
            const words = para.split(/\s+/).filter(Boolean);
            let currentLine = '';
            for (const word of words) {
                const wordFits = ctx.measureText(word).width <= maxWidth;
                const test = currentLine ? currentLine + ' ' + word : word;
                if (ctx.measureText(test).width <= maxWidth) {
                    currentLine = test;
                } else {
                    if (currentLine) lines.push(currentLine);
                    if (wordFits) {
                        currentLine = word;
                    } else {
                        const pieces = breakLongWord(word);
                        for (let i = 0; i < pieces.length - 1; i++) lines.push(pieces[i]);
                        currentLine = pieces[pieces.length - 1] || '';
                    }
                }
            }
            if (currentLine) lines.push(currentLine);
        }
        return lines;
    }

    // Wraps AND truncates to maxLines together, so the fit-check below
    // always sizes against what will actually be shown - otherwise a
    // paragraph with many short lines would shrink the font to fit its
    // full untruncated line count, then get truncated anyway, leaving
    // needlessly tiny text for what's really a short, capped block.
    function computeAtSize(fontSize) {
        let lines = wrapAtFontSize(fontSize);
        let truncated = false;
        if (lines.length > maxLines) {
            lines = lines.slice(0, maxLines);
            truncated = true;
        }
        return { lines, truncated };
    }

    let fontSize = 160;
    let { lines, truncated } = computeAtSize(fontSize);

    while (fontSize > minFontSize) {
        const lineHeight = fontSize * 1.2;
        const totalHeight = lines.length * lineHeight;
        const maxLineWidth = lines.length ?
            Math.max(...lines.map(l => ctx.measureText(l).width)) : 0;

        if (
            totalHeight <= canvas.height * maxVerticalFraction &&
            maxLineWidth <= maxWidth
        ) break;

        fontSize -= 4;
        ({ lines, truncated } = computeAtSize(fontSize));
    }

    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    const startY = canvas.height / 2 - totalHeight / 2 + lineHeight / 2;

    ctx.font = `bold ${fontSize}px Arial`;
    ctx.fillStyle = '#00ff88';
    ctx.shadowColor = 'rgba(0, 255, 136, 0.5)';
    ctx.shadowBlur = 16;

    lines.forEach((line, i) => {
        let displayLine = line;
        if (truncated && i === lines.length - 1) {
            displayLine = line.replace(/\s+\S*$/, '') + ' \u2026';
        }
        ctx.fillText(displayLine, canvas.width / 2, startY + i * lineHeight);
    });

    ctx.shadowBlur = 0;

    return canvas;
}

      export  const textures = {
            // Earth texture - full 8k equirect map from assets/
            // (originally a tiny base64 "simplified" map; swapped for
            // the detailed asset, baked as a single wrap like any
            // uploaded equirect image).
            earth: "assets/8k_earth_daymap.jpg",
            // Laughing Man logo
            laughingMan: "assets/laughingman.png",
            // Animated version (text ring already spinning, baked into
            // its frames) - see main.js loadLaughingMan(). Falls back to
            // the static PNG above if this file isn't present.
            laughingManGif: "assets/laughingman.gif",
            
            smiley: createSmileyTexture(),
            text: createTextTexture('HELLO WORLD!').toDataURL()
      };

export { createTextTexture };
