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
            // Original Earth texture (simplified)
            earth: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAACACAAAAADB3ujWAAAAwXpUWHRSYXcgcHJvZmlsZSB0eXBlIGV4aWYAAHjabVBbDsMgDPvnFDtCXqThOGztpN1gx19oglS2WcIYp7gh5Xi/nuU2QChF6mbaVMEhTRp1FwaBfjKCnDyByYtf5h0gt9h3jqNp3po+LjGA3VW9Bj2ycF8LTTLfvoIoNh4dDb1nUMsgpihgBvR4Fmiz7fqE+wErLFYZJLa2/XPefHp79f8w0cHI4Mxs0QCPpYW7C3NG/2hY7LqynL5mmA/k35wmygfiI1kaos/jWwAAASNpQ0NQSUNDIHByb2ZpbGUAAHicnZCxSsNQFIa/RtEi1UVxEIcMrl0EOzlYFYJQIdYKVqf0JsViEkOSUnwD30QfpoMg+BCOCs7+Nzo4mMULh//jcM7/33vBcWOTFIsHkKRl7vW7w8vhlbv8RpMWazjsBqbIur7fo/Z8vtKw+tK2XvVzf56lMCqMdK5KTZaX0NgXd2ZlZlnFxu2gfyR+ELthkobiJ/FOmISW7W4/iafmx9PephWlF+e2r9rG44RTfFxGTJkQU9KWpuoc02FP6pETcE+BkcZE6s00U3IjKuTkcSgaiHSbmrytKs9XykgeE3nZhDsSedo87P9+r32cVZuNzXkW5EHVWlA54zG8P8LqENafYeW6Jqv5+201M51q5p9v/AIAMFBwLBzVfgAADXppVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+Cjx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IlhNUCBDb3JlIDQuNC4wLUV4aXYyIj4KIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiAgPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIKICAgIHhtbG5zOnhtcE1NPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvbW0vIgogICAgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIKICAgIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIKICAgIHhtbG5zOkdJTVA9Imh0dHA6Ly93d3cuZ2ltcC5vcmcveG1wLyIKICAgIHhtbG5zOnRpZmY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vdGlmZi8xLjAvIgogICAgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIgogICB4bXBNTTpEb2N1bWVudElEPSJnaW1wOmRvY2lkOmdpbXA6ZDMxZGI3Y2EtNGVjMy00MjYxLWFmNmEtMzVkNmU1ZWE2OWMxIgogICB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOmZkNmI0MDE0LTIyNzMtNDhlZS1iODljLWI2YzcxNjAzZTRjZCIKICAgeG1wTU06T3JpZ2luYWxEb2N1bWVudElEPSJ4bXAuZGlkOjI1NjBkY2NjLTU3NmItNDljZC04YTQ2LTViNDEzZjUyYzUyZCIKICAgZGM6Rm9ybWF0PSJpbWFnZS9wbmciCiAgIEdJTVA6QVBJPSIyLjAiCiAgIEdJTVA6UGxhdGZvcm09Ik1hYyBPUyIKICAgR0lNUDpUaW1lU3RhbXA9IjE3ODY2MDQwNDc3Mjg4NjkiCiAgIEdJTVA6VmVyc2lvbj0iMi4xMC4zOCIKICAgdGlmZjpPcmllbnRhdGlvbj0iMSIKICAgeG1wOkNyZWF0b3JUb29sPSJHSU1QIDIuMTAiCiAgIHhtcDpNZXRhZGF0YURhdGU9IjIwMjY6MDg6MTJUMjM6NTQ6MDYtMDc6MDAiCiAgIHhtcDpNb2RpZnlEYXRlPSIyMDI2OjA4OjEyVDIzOjU0OjA2LTA3OjAwIj4KICAgPHhtcE1NOkhpc3Rvcnk+CiAgICA8cmRmOlNlcT4KICAgICA8cmRmOmxpCiAgICAgIHN0RXZ0OmFjdGlvbj0ic2F2ZWQiCiAgICAgIHN0RXZ0OmNoYW5nZWQ9Ii8iCiAgICAgIHN0RXZ0Omluc3RhbmNlSUQ9InhtcC5paWQ6NDg3OTA5NTQtZmNhNC00NWU4LThjZDktMGE0MmI0NzdhMmY1IgogICAgICBzdEV2dDpzb2Z0d2FyZUFnZW50PSJHaW1wIDIuMTAgKE1hYyBPUykiCiAgICAgIHN0RXZ0OndoZW49IjIwMjYtMDgtMTJUMjM6NTQ6MDctMDc6MDAiLz4KICAgIDwvcmRmOlNlcT4KICAgPC94bXBNTTpIaXN0b3J5PgogIDwvcmRmOkRlc2NyaXB0aW9uPgogPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgIAo8P3hwYWNrZXQgZW5kPSJ3Ij8+KIGHDgAAAAlwSFlzAAALEwAACxMBAJqcGAAAAAd0SU1FB+oIDQY2B6rkeTwAAAW8SURBVHja7V3ZcsMgDGQ9/v9f3j4ksY0NWBeETsxDO9MmBK2ulQwETL89lvQA8ADwAPDLYw2fEYkgqH1TYkpIKY0OyqBT2s9g/hei9pbqf76Tj/QA4C0GcwBEgyXovgvCapKfetk3SzchN4cFINNRTYVIvBOv4R/qZfQCAO+PwP0KUZTCpmLehddwb1lFMY6oKy0xnf6LlNjQsiPeQiE+hPbE9w8UNAEN2Hsm+7wHkSaAg39J1yN5IU4OS29mRB0AkVHQJc7uv2hOu4P4kRYMiieoZIjbDNhGQAMA8g9jTUmMErweUGsWq4YgmiOiCwCKPAOlJwQDcJgOI7jXISCDVQhOeZf9cv/RMzCYfSKxSR+yP7PktBshoFV/OAZlDGffDQhqjpCnf3xoCe12gXNp04qZ3QCQIoC2pdAFwHqGoTcE8Ly+mFMERoyXy5QC0IUFda5NcTTkXSo9TZRbwKl+OPH2tVDN9fSHz/ygryKWs3RkVPRCUK8lADp3KM4NBXnRQENexF0xfg0w6OsD6Rp/QT0zkuUvAbJL/R3snBBIBca0BFPTa4gx+j/WT+5WiSPhtPscIxCA0ALUIRneV9ELgHTJkOm/VBA1liiMrKu6kNO1sBilqdLLEEC4EO55H+SyrkPDoeR0gBr1SKddGkGarvY98yiPbC7TvECbxZhU1wqC3jYEzsUMj8EBb2KmBoQpKrK0YwAuzQx7GyQDYhMfNXY2cix3TCX5H2PxPRE3BrvJDqMnxFWdi3AyAPBrCYdgAEcwGGQBm4syYddjgLeCPHV7EI0AQqbi5sruruyF8R3CnyEAMMxGJDwAnu5btebw2TQHAXCskIOemBWxjEUAsfGEAfK/fID1EsEQ1xgSIxHmdhHdETUAKPVJ5gFAvf1EJ3+lc6GbaemoIxX5J0PMB9p1rn30eQ51PXorcPRXLAAQoHxdho0WyrUjpoGxmJzulqif+p2yhelWz+K2A7WjrirEoelJ9eHuhwwQIb96o2RWxb9ijmDzC8PlVz9WC3CBgisglxplJGINgOSxImYK5uiqvHt6Qld+soqA9lQ1WNIL82J0wIbCNW2LsPRn/rjVLn+GAJvthD4jpGG1GjygpgmUIZiuiLAAcBEfmv2z84ovBuC4Ubv2NBve5Cd4RI7c7APizKL1+3LBQfjVI9kiwD0XkiH5dUkmBC7qpTvqK7dIIIhfrJr1ZVRAUhgE9gMue2cxPoqcNvbQsK+lCCoNz2jDWIZqIh6qXdHGnhYC0H1uLwDUTJD7bwTja2NjQyyAL30zS+5wLhU+YTHKAl7bBGBegDdl15qFQ06NcQ914IeGwHxu8pumrgeAx3IbDtN7wWbY6McR4eX2DGfxFBj12SNa/igEIOLc54XBbcezyF92gbu9R9OcfO4XA85noBlYf81SCLfmYaigRiLHLwKwl7gM+Cgrk+UA+du7xNpMxM5h/Ok9zkCXFgnaBWGc8gcRHDcAzDowKRwBl5oRCQBlJuxAIPoRAWL3CUqvc/Ec2UCkDjHCBVi0Bw5eNMbGAIG9hzW65+GSS2lRDI9pTLOawKDL1KySAPjCyrowMPtWNna1i2HX6WHOEPAf7hPETADEpG9MhMDyBU1iJhsoNURQ2MsfUbxgxit8lzvsseWjgCNDCKGEDLdL1i7Nmyhas5NLLOmbh/amyDGs3n02GS7sYgGI7oAOgQDRMaB0cyYmRgCxMSBFnOL6r6QwbNf1SBNAB0yZ/hMEmNqo/pcJ/M/b5fm7AGD6CYdo/+dd4IctIHyDxvro7BnPeMYzfor7hYTU8dsFe7WooBCVxaOywzqKfSBAlM0VO9fo4AboDQDtM3U92dAH1MvV2gMonNmUGQ/q5eb+qQluPwBmeWan+eoRBIEyFQCSy+1a7z1fXSM52jj0HmkXBuwzLdJ0CCTRN5xFoYDf/Nrdw+1+z/cOPwA8ADwAPAA8ADwA/Oz4AxNy4igjb2q4AAAAAElFTkSuQmCC",
            // Laughing Man logo
            laughingMan: "assets/laughingman.png",
            
            smiley: createSmileyTexture(),
            text: createTextTexture('HELLO WORLD!').toDataURL()
      };

export { createTextTexture };
