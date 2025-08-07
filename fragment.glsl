precision highp float;

varying vec3 vNormal;

void main() {
  // simple lighting for glow effect
  float intensity = dot(normalize(vNormal), vec3(0, 0, 1));
  vec3 baseColor = vec3(1.0, 0.6, 0.0);
  vec3 color = baseColor * intensity;
  gl_FragColor = vec4(color, 1.0);
}
