attribute vec3 position;
attribute vec3 normal;

uniform mat4 uProjectionMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uModelMatrix;

varying vec3 vNormal;

void main() {
  vNormal = normal;
  gl_Position = uProjectionMatrix * uViewMatrix * uModelMatrix * vec4(position, 1.0);
}
