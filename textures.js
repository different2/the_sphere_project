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

        // Create a text message texture
        function createTextTexture() {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            // Flip horizontally
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
            
            // Background
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, 512, 256);
            
            // Text styling
            ctx.fillStyle = '#00ff88';
            ctx.font = 'bold 24px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // Main message
            ctx.fillText('HELLO', 256, 80);
            ctx.fillText('WORLD!', 256, 120);
            
            // Smaller decorative text
            ctx.font = '14px Arial';
            ctx.fillStyle = '#ffffff';
            ctx.fillText('Custom Globe Texture', 256, 160);
            
            // Add some stars
            ctx.fillStyle = '#ffff00';
            for (let i = 0; i < 20; i++) {
                const x = Math.random() * 512;
                const y = Math.random() * 256;
                ctx.beginPath();
                ctx.arc(x, y, 1, 0, Math.PI * 2);
                ctx.fill();
            }
            
            return canvas.toDataURL();
        }
      export  const textures = {
            // Original Earth texture (simplified)
            earth: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAACAAQAAAADMzoqnAAAAAXNSR0IArs4c6QAABA5JREFUeNrV179uHEUAx/Hf3JpbF+E2VASBsmVKTBcpKJs3SMEDcDwBiVJAAewYEBUivIHT0uUBIt0YCovKD0CRjUC4QfHYh8hYXu+P25vZ2Zm9c66gMd/GJ/tz82d3bk8GN4SrByYF2366FNTACIAkivVAAazQdnf3MvAlbNUQfOPAdQDvSAimMWhwy4I2g4SU+Kp04ISLpPBAKLxPyic3O/CCi+Y7rUJbiodcpDOFY7CgxCEXmdYD2EYK2s5lApOx5pEDDYCUwM1XdJUwBV11QQMg59kePSCaPAASQMEL2hwo6TJFgxpg+TgC2ymXPbuvc40awr3D1QCFfbH9kcoqAOkZozpQo0aqAGQRKCog/+tjkgbNFEtg2FffBvBGlSxHoAaAa1u6X4PBAwDiR8FFsrQgeUhfJTSALaB9jy5NCybJPn1SVFiWk7ywN+KzhH1aKAuydhGkbEF4lWohLXDXavlyFgHY7LBnLRdlAP6BS5Cc8RfVDXbkwN/oIvmY+6obbNeBP0JwTuMGu9gTzy1Q4RS/cWpfzszeYwd+CAFrtBW/Hur0gLbJGlD+/OjVwe/drfBxkbbg63dndEDfiEBlAd7ac0BPe1D6Jd8dfbLH+RI0OzseFB5s01/M+gMdAeluLOCAuaUA9Lezo/vSgXoCX9rtEiXnp7Q1W/CNyWcd8DXoS6jH/YZ5vAJEWY2dXFQe2TUgaFaNejCzJ98g6HnlVrsE58sDcYqg+9XY75fPqdoh/kRQWiXKg8MWlJQxUFMPjqnyujhFBE7UxIMjyszk0QwQlFsezImsyvUYYYVED2pk6m0Tg8T04Fwjk2kdAwSACqlM6gRRt3vQYAFGX0Ah7Ebx1H+MDRI5ui0QldH4j7FGcm90XdxD2Jg1AOEAVAKhEFXSn4cKUELurIAKwJ3MArypPscQaLhJFICJ0ohjDySAdH8AhDtCiTuMycH8CXzhH9jUACAO5uMhoAwA5i+T6WAKmmAqnLy80wxHqIPFYpqCwxGaYLt4Dyievg5kEoVEUAhs6pqKgFtDQYOuaXypaWKQfIuwwoGSZgfLsu/XAtI8cGN+h7Cc1A5oLOMhwlIPXuhu48AIvsSBkvtV9wsJRKCyYLfq5lTrQMFd1a262oqBck9K1V0YjQg0iEYYgpS1A9GlXQV5cykwm4A7BzVsxQqo7E+zCegO7Ma7yKgsuOcfKbMBwLC8wvVNYDsANYalEpOAa6zpWjTeMKGwEwC1CiQewJc5EKfgy7GmRAZA4vUVGwE2dPM/g0xuAInE/yG5aZ8ISxWGfYigUVbdyBElTHh2uCwGdfCkOLGgQVBh3Ewp+/QK4CDlR5Ws/Zf7yhCf8pH7vinWAvoVCQ6zz0NX5V/6GkAVV+2/5qsJ/gU8bsxpM8IeAQAAAABJRU5ErkJggg==",
            // Laughing Man logo
            laughingMan: "assets/laughingman.png",
            
            smiley: createSmileyTexture(),
            text: createTextTexture()
      };